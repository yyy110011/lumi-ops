# Phase 2: Daemon/Client Agent Management

> Background daemon for agent persistence + multi-client support.
> TUI and VS Code extension share the same daemon.

---

## Motivation

Phase 1's PTY Pool has one critical limitation: **TUI exits → all agents die**. Phase 2 adds a background daemon that owns the agent processes, enabling:

1. **Persistence**: Agents survive TUI restarts and crashes
2. **Multi-client**: VS Code extension + TUI + CLI all observe/control the same agents
3. **External spawn**: Launch agents from VS Code, monitor from TUI (and vice versa)

---

## Architecture

```
┌─────────────────── lumi-tui-daemon ───────────────────┐
│                                                        │
│  PTY Pool (owns all agent processes)                   │
│  ├─ AgentInstance { pty, parser, status }              │
│  ├─ AgentInstance { pty, parser, status }              │
│  └─ AgentInstance { pty, parser, status }              │
│                                                        │
│  Status Detector (100ms tick → regex on screen)        │
│  Log Writer (tee PTY output → .lumi/agent.log)        │
│  agent-status.json Writer                              │
│                                                        │
│  Socket: /tmp/lumi-tui-{USER}.sock                     │
│  Wire:   LengthDelimitedCodec + JSON                   │
│                                                        │
│         ↕               ↕               ↕              │
│     TUI Client    VS Code Client    CLI Client         │
└────────────────────────────────────────────────────────┘
```

**Daemon owns ALL state.** Clients are renderers — receive snapshots, send commands.

---

## Protocol

### Messages (Client → Daemon)

```rust
enum ClientMsg {
    Handshake { version: u32 },

    // Agent lifecycle
    SpawnAgent { branch: String, worktree: String, driver: DriverName, config: AgentConfig },
    KillAgent { id: Uuid },
    
    // Terminal interaction
    AttachAgent { id: Uuid },       // start streaming screen updates for this agent
    DetachAgent,                    // stop streaming
    SendInput { data: Vec<u8> },    // keystrokes to attached agent's PTY
    
    // Queries
    ListAgents,
    GetAgentScreen { id: Uuid },    // one-shot screen snapshot
    
    Shutdown,
}
```

### Messages (Daemon → Client)

```rust
enum DaemonMsg {
    HandshakeAck { version: u32 },
    
    // Periodic broadcast (every 2s to all clients)
    AgentListUpdate(Vec<AgentSummary>),
    
    // Streaming (only to attached client, every 100ms)
    ScreenUpdate { id: Uuid, screen: ScreenSnapshot },
    
    // One-shot responses
    SpawnResult { ok: bool, id: Option<Uuid>, error: Option<String> },
    KillResult { ok: bool, error: Option<String> },
    
    // Events
    AgentExited { id: Uuid, exit_code: i32 },
    AgentStatusChanged { id: Uuid, status: AgentStatus },
}

struct AgentSummary {
    id: Uuid,
    branch: String,
    driver: DriverName,
    status: AgentStatus,
    created_at: String,
    last_activity: String,
}

struct ScreenSnapshot {
    rows: u16,
    cols: u16,
    cells: Vec<Vec<Cell>>,  // or serialized vt100 screen
}
```

---

## Daemon Lifecycle

### Auto-start

```
lumi-tui (client) starts
  → check /tmp/lumi-tui-{USER}.sock exists && responsive
  → if not: fork lumi-tui-daemon, wait for socket
  → connect via Unix socket
  → Handshake { version }
```

### Auto-stop

```
Last client disconnects
  → daemon starts 5-minute idle timer
  → if no new clients connect: graceful shutdown
  → all agents are killed, exit codes written
```

### Explicit Management

```bash
lumi-tui daemon start     # start daemon in background
lumi-tui daemon stop      # graceful shutdown
lumi-tui daemon status    # check if running, show agent count
```

---

## TUI Client Changes (from Phase 1)

| Phase 1 (Direct) | Phase 2 (Client) |
|-------------------|-------------------|
| `PtyPool` in TUI process | `PtyPool` in daemon, TUI receives snapshots |
| `parser.lock().screen()` | Receive `ScreenSnapshot` via socket |
| `pty.write_bytes()` | Send `SendInput { data }` to daemon |
| Direct regex on parser | Daemon does detection, sends `AgentStatusChanged` |
| Config read at startup | Daemon reads config; client sends spawn params |

### Migration Path

Phase 1's `PtyPool` code moves **unchanged** into the daemon. The TUI client replaces direct PTY calls with socket messages. The UI code (rendering, keybindings) stays the same.

```
Phase 1:  TUI → PtyPool → PTY
Phase 2:  TUI → Socket → Daemon → PtyPool → PTY
```

---

## VS Code Extension Integration

### Extension as Client

The VS Code extension connects to the daemon's Unix socket to:

1. **Read agent list** → show in sidebar with status icons
2. **Launch agents** → "▶ Launch Agent" button sends `SpawnAgent`
3. **Open TUI attached** → `vscode.window.createTerminal()` runs `lumi-tui --attach {branch}`
4. **View logs** → reads `.lumi/agent.log` directly (file-based, no daemon needed)

### Extension → TUI Handoff

```
User clicks "Attach" on a clone in VS Code sidebar
  → Extension runs: vscode.window.createTerminal({ shellPath: "lumi-tui", shellArgs: ["--attach", branch] })
  → TUI opens with Terminal panel focused on that agent
  → User interactively works with the agent
```

---

## Screen Streaming Strategy

The main performance challenge is streaming vt100 screen state over a Unix socket.

### Option A: Full Screen Snapshot (Simple)

Every 100ms, serialize the entire `vt100::Screen` (rows × cols cells with attributes). For a 120×40 terminal = ~19KB per frame uncompressed.

- ✅ Simple implementation
- ❌ ~190KB/s bandwidth per attached client

### Option B: Diff-based (Efficient)

Track dirty cells since last send. Only transmit changed cells.

- ✅ Much lower bandwidth (typically <1KB per frame)
- ❌ More complex; need sequence tracking

### Recommendation

Start with **Option A** (full snapshots at 100ms). If performance is an issue, optimize to Option B. Unix sockets can handle ~190KB/s trivially.

---

## Crate Dependencies (additions over Phase 1)

| Crate | Version | Purpose |
|-------|---------|---------|
| `tokio` (already) | 1 | `UnixListener`, async I/O |
| `tokio-util` | 0.7 | `LengthDelimitedCodec`, `Framed` |
| `bytes` | 1 | Serialized message buffers |
| `futures` | 0.3 | `SinkExt`, `StreamExt` for Framed |
| `sysinfo` | 0.33 | Process tree inspection (optional) |

---

## New Files

| File | Purpose |
|------|---------|
| `src/daemon/mod.rs` | Daemon main loop, socket listener |
| `src/daemon/protocol.rs` | `ClientMsg`, `DaemonMsg` types |
| `src/daemon/session.rs` | Per-client connection handler |
| `src/client/mod.rs` | Client connection, message send/recv |
| `src/client/proxy_pool.rs` | `ProxyPtyPool` — same API as `PtyPool` but via socket |

### Modified

| File | Change |
|------|--------|
| `src/main.rs` | Add `--daemon` flag; auto-start daemon; client mode |
| `src/app/mod.rs` | Use `ProxyPtyPool` instead of `PtyPool` when in client mode |
| `src/app/pty_pool.rs` | Move into daemon; keep API identical |

---

## Rollout Strategy

1. **Phase 2a**: Daemon + TUI client (daemon auto-starts, TUI is only client)
2. **Phase 2b**: CLI client (`lumi-tui daemon status`, `lumi-tui --attach`)
3. **Phase 2c**: VS Code extension client (sidebar integration, terminal handoff)

Phase 2a can be built without touching the extension. The daemon just wraps Phase 1's PtyPool behind a socket, and the TUI client replaces direct PTY calls with socket messages.

---

## Open Questions

1. **Daemon user scope**: One daemon per user? Per repo? Per user is simpler (matches Pertmux).
2. **Screen serialization format**: JSON (simple) vs bincode (fast) vs custom (optimal)?
3. **Agent resume**: If daemon restarts, can agents be reconnected? (Likely not with PTY — needs tmux fallback for true persistence.)
4. **Authentication**: Should the socket require auth? Probably not for local Unix socket (user-scoped file permissions are sufficient).

---
name: pertmux-patterns
description: Condensed reference for Pertmux daemon/client architecture patterns. Read instead of the raw .rs files.
---

# Pertmux Patterns — Condensed Reference

> Source: [rupert648/pertmux](https://github.com/rupert648/pertmux) | MIT License

## Architecture

```
┌─────────────────── pertmux daemon ───────────────────┐
│  tmux (2s)  ·  Forge APIs (60-300s)  ·  wt CLI (30s) │
│                      ↓                                │
│              DashboardSnapshot                        │
│              broadcast::channel                       │
│         ↓            ↓            ↓                   │
│     Client 1     Client 2     Client N                │
│                                                       │
│  Socket: /tmp/pertmux-{USER}.sock                     │
│  Wire:   LengthDelimitedCodec + JSON                  │
└───────────────────────────────────────────────────────┘
```

**Daemon** owns ALL state. Clients are pure renderers — receive snapshots, send commands.

## DashboardSnapshot

The single state object broadcast to every client on each tick:

```rust
pub struct DashboardSnapshot {
    pub projects: Vec<ProjectSnapshot>,       // multi-project support
    pub panes: Vec<AgentPane>,                // tmux agent panes
    pub groups: Vec<(String, Vec<usize>)>,    // panes grouped by session
    pub detail: Option<SessionDetail>,        // selected session info
    pub error: Option<String>,
    pub seconds_since_refresh: u64,
    pub default_agent_command: Option<String>,
    pub keybindings: KeybindingsConfig,
    pub pending_changes: Vec<MrChange>,       // offline-buffered notifications
    pub agent_actions: Vec<AgentActionConfig>,
}

pub struct ProjectSnapshot {
    pub name: String,
    pub local_path: String,
    pub cached_worktrees: Vec<WtWorktree>,
    pub dashboard: DashboardState,            // linked MRs (not needed for lumi-tui)
    // ... forge-specific caches omitted
}
```

## Protocol Messages

```rust
const PROTOCOL_VERSION: u32 = 2;

enum ClientMsg {                              // client → daemon
    Handshake { version: u32 },
    Refresh, Stop,
    CreateWorktree { project_idx, branch },
    RemoveWorktree { project_idx, branch },
    MergeWorktree { project_idx, worktree_path },
    AgentAction { pane_pid, session_id, prompt },
}

enum DaemonMsg {                              // daemon → client
    HandshakeAck { version: u32 },
    Snapshot(Box<DashboardSnapshot>),
    ActionResult { ok: bool, message: String },
}
```

## CodingAgent Trait

Pluggable interface for agent detection and interaction:

```rust
pub trait CodingAgent {
    fn name(&self) -> &str;                   // "claude-code", "opencode"
    fn process_name(&self) -> &str;           // match against pane_current_command
    fn query_status(&self, pane: &AgentPane) -> PaneStatus;
    fn send_prompt(&self, pane_pid: u32, session_id: &str, prompt: &str) -> Result<String>;
    fn enrich_pane(&self, _pane: &mut AgentPane) {}
    fn fetch_session_detail(&self, _session_id: &str) -> Option<SessionDetail> { None }
}

enum PaneStatus { Idle, Busy, Retry { attempt: u32, message: String }, Unknown }
```

Two-phase tmux discovery: (1) match `pane_current_command`, (2) walk child processes via `sysinfo` for interpreter-based agents (e.g. `node` → `claude`).

## Claude JSONL Parsing

Transcripts at `~/.claude/projects/{encoded-path}/{session-id}.jsonl` where path encoding replaces `/` with `-`.

```rust
// Read LAST line of most recent transcript:
fn query_status(pane: &AgentPane) -> PaneStatus {
    let entry = read_last_entry(&find_latest_transcript(&pane.pane_path)?)?;
    match entry.entry_type.as_str() {
        "user" | "tool_use"        => PaneStatus::Busy,
        "assistant" | "tool_result" => PaneStatus::Idle,
        _                          => PaneStatus::Unknown,
    }
}

struct TranscriptEntry {
    #[serde(rename = "type")]
    entry_type: String,     // "user" | "assistant" | "tool_use" | "tool_result"
    timestamp: Option<String>,
    session_id: Option<String>,
    message: Option<TranscriptMessage>,
}

struct TranscriptMessage {
    role: Option<String>,
    model: Option<String>,  // "claude-4-sonnet-20260514"
    usage: Option<TokenUsage>,
    content: Option<Value>, // String | Array of {type, text}
}
```

Enrichment extracts: session title (first user msg), model, last activity, session ID.
Prompt sending: `tmux send-keys -t {pane_id} {escaped_prompt} Enter`.

## Phase 1 vs Phase 2 Adoption

| Aspect | Phase 1 (Direct Reads) | Phase 2 (Daemon/Client) |
|--------|----------------------|------------------------|
| **State source** | Read `.lumi-metadata.json` directly | Daemon polls, broadcasts `DashboardSnapshot` |
| **Multi-client** | ✗ Single TUI process | ✓ VS Code + TUI share daemon |
| **Crate overhead** | Minimal | `tokio-util`, `bytes`, `futures` |
| **Complexity** | Simple, fast to build | Full socket protocol |
| **When to adopt** | Now — MVP | When needing background monitoring or shared state |

### Phase 1 — Borrow Now
- **CodingAgent trait** + two-phase tmux discovery
- **Claude transcript parsing** (JSONL status detection)
- **PopupState enum** with variant-carried state
- **Notification system** — `Option<(String, Instant)>`, auto-dismiss after 3s
- **Async subprocess** — `tokio::process::Command` for `lumi-ops` CLI
- **Age formatting** — `just now` / `5m ago` / `2h ago` / `3d ago`
- **Per-project selection** — independent indices per project, clamped on snapshot update

### Phase 2 — Borrow Later
- **Daemon main loop** — `tokio::select!` with multi-interval polling
- **Unix socket** — `/tmp/lumi-tui-{USER}.sock`, stale detection, `LengthDelimitedCodec`
- **Offline buffering** — queue notifications when no clients connected
- **Daemonize** — re-exec self with `--foreground`, redirect stdout to log
- **Protocol versioning** — handshake with version check

## Config Format

```toml
# ~/.config/pertmux.toml
refresh_interval = 2          # tmux poll (seconds)
worktree_interval = 30        # worktree list refresh
default_agent_command = "opencode"

[agent.claude_code]           # enable by presence
[agent.opencode]
db_path = "~/.local/share/opencode/opencode.db"

[keybindings]                 # partial override supported
refresh = 'r'
copy_branch = 'b'

[[project]]
name = "my-project"
source = "github"
project = "user/repo"
local_path = "/path/to/repo"
```

Resolution order: CLI flag → `~/.config/pertmux.toml` → `dirs::config_dir()` → defaults.
Validation collects ALL errors before reporting (not one-at-a-time).

## Key Crate Dependencies (Phase 2 Only)

| Crate | Version | Purpose |
|-------|---------|---------|
| `tokio` | 1 | `UnixListener`, `broadcast`, `mpsc`, `signal` |
| `tokio-util` | 0.7 | `LengthDelimitedCodec`, `Framed` |
| `bytes` | 1 | Serialized message buffers |
| `futures` | 0.3 | `SinkExt`, `StreamExt` for Framed |
| `sysinfo` | 0.33 | Process tree inspection (agent child detection) |
| `nucleo-matcher` | 0.3 | Fuzzy search (or use `fuzzy-matcher`) |
| `dirs` | 5 | Platform config/data directories |

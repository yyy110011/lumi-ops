# Phase 1: PTY Pool Agent Management

> TUI-hosted multi-agent management via embedded PTY pool.
> No tmux dependency. TUI is the agent host.

---

## Overview

Replace the current single-PTY terminal with a **PTY Pool** that manages multiple concurrent AI agents. Each agent runs in its own embedded PTY, and the Terminal panel acts as a switchable viewport — like VS Code terminal tabs.

```
┌─ Projects ───────┐ ┌─ File Viewer ──────────────────┐
│ lumi-ops         │ │ [MISSION] [COMPLETE] [LOG]      │
│  ├─ feat/auth    │ │─────────────────────────────────│
│  └─ fix/bug-123  │ │ # Mission: Implement Auth       │
│                  │ │ Add JWT authentication to...    │
├─ Agent List ─────┤ ├─ Terminal ─────────────────────┤
│ 🔵 feat/auth     │ │ $ gemini                        │
│   gemini Running │ │ ✻ Reading src/auth.ts...        │
│ ⚠ fix/bug-123   │ │ ⏺ Edit src/auth.ts              │
│   claude Waiting │ │                                 │
└──────────────────┘ └─────────────────────────────────┘
```

---

## Data Model

### AgentInstance

```rust
struct AgentInstance {
    id: Uuid,
    clone_branch: String,               // "feat/auth"
    worktree_path: String,
    driver: DriverName,                  // Gemini | Claude
    pty_manager: PtyManager,
    parser: Arc<Mutex<vt100::Parser>>,
    status: AgentStatus,
    created_at: DateTime<Utc>,
    last_activity: DateTime<Utc>,
}

enum DriverName { Gemini, Claude }

enum AgentStatus {
    Running,          // spinner/working indicators detected
    AwaitingInput,    // question/confirmation patterns detected
    Completed,        // completion patterns or process exited with 0
    Error,            // error patterns or process exited non-zero
    Idle,             // shell prompt detected
}
```

### PtyPool

```rust
struct PtyPool {
    agents: Vec<AgentInstance>,
    selected: usize,
}

impl PtyPool {
    /// Spawn a new agent. Writes .lumi/agent-status.json.
    fn spawn(&mut self, branch: &str, worktree: &str, driver: DriverName, config: &AgentConfig) -> Result<()>;

    /// Kill the agent at index. Writes exit code, updates agent-status.json.
    fn kill(&mut self, idx: usize) -> Result<()>;

    /// Get the selected agent's parser for Terminal panel rendering.
    fn selected_parser(&self) -> Option<&Arc<Mutex<vt100::Parser>>>;

    /// Get the selected agent ref for status display.
    fn selected_agent(&self) -> Option<&AgentInstance>;

    /// Switch which agent the Terminal panel shows.
    fn select(&mut self, idx: usize);
}
```

---

## Agent Launch Flow

```
1. User selects a clone in Projects or Agent List panel
2. Presses 'a' (Launch Agent)
3. TUI reads config for default_driver (or auto-detects: gemini → claude)
4. Builds command:
   Gemini: cd {worktree} && gemini -p "Read MISSION.md and execute the mission"
   Claude: cd {worktree} && claude -p "Read MISSION.md and execute the mission" --dangerously-skip-permissions
5. Writes .lumi/agent-status.json:
   { "driver": "gemini", "tmuxSession": "", "startedAt": "...", "status": "running", "logFile": ".lumi/agent.log" }
6. PtyPool.spawn() → PtyManager::spawn(cmd, &[], worktree, rows, cols)
7. Starts background log writer: tee PTY output → .lumi/agent.log
8. Auto-switches Terminal panel to new agent
```

### Agent Exit Handling

```
PTY reader thread detects EOF (process exited)
  → Read child exit code
  → Write .lumi/agent-exit-code
  → Update .lumi/agent-status.json: status = "completed" (0) or "failed" (non-zero)
  → Update AgentInstance.status
  → Keep PTY output in vt100 parser (user can still view last screen)
```

---

## File Viewer — Tabbed Design

Replace single-content viewer with 3 tabs:

| Tab | Source | Availability |
|-----|--------|-------------|
| MISSION | `{worktree}/MISSION.md` | Always (created by spawn) |
| COMPLETE | `{worktree}/MISSION_COMPLETE.md` | After agent writes it |
| LOG | `{worktree}/.lumi/agent.log` | After agent launched |

- Tab switching: `[` / `]` when File Viewer focused
- LOG tab auto-scrolls to bottom
- COMPLETE tab appears with a 🟣 indicator when file is created

---

## Status Detection

Read screen content directly from `vt100::Parser` (no tmux needed):

```rust
fn detect_status(parser: &vt100::Parser, driver: DriverName) -> AgentStatus {
    let text = parser.screen().contents();
    // Priority order:
    // 1. QUESTION_PATTERNS → AwaitingInput
    // 2. SPINNER / WORKING / TOOL_PATTERNS → Running
    // 3. COMPLETION_PATTERNS → Completed
    // 4. ERROR_PATTERNS → Error
    // 5. PROMPT_CHARS → Idle
    // 6. Default: Running
}
```

### Regex Pattern Categories (from Grove)

| Pattern | Examples | Detects |
|---------|----------|---------|
| Spinner | `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏` | Running |
| Working | `✻ Slithering…`, `Reading…` | Running |
| Tool use | `⏺ Read/Write/Edit/Bash` | Running |
| Questions | `(y/n)`, `Allow?`, `Enter to confirm` | AwaitingInput |
| Gemini-specific | `action required`, `waiting for confirmation` | AwaitingInput |
| Completion | `✓`, `done`, `completed successfully` | Completed |
| Error | `✗`, `Error:`, `FAILED`, `panicked at` | Error |
| Prompt | `>`, `›`, `❯`, `$`, `%` | Idle |

Detection runs every tick (100ms) for the selected agent, every 2s for background agents.

---

## Agent List Panel Rendering

```
┌─ 🤖 Agents (2 running) ─────────────┐
│ ● feat/auth         gemini  Running  │  ← selected (highlighted)
│ ⚠ fix/bug-123       claude  Waiting  │
│                                      │
│ [a]Launch [x]Kill [Enter]Attach      │  ← status bar hints
└──────────────────────────────────────┘
```

| Status | Symbol | Color |
|--------|--------|-------|
| Running | `●` | Green |
| AwaitingInput | `⚠` | Yellow bold |
| Completed | `✓` | Cyan |
| Error | `✗` | Red |
| Idle | `○` | Gray |

---

## Integration with feat/background-agents

TUI writes the same files as the CLI's `launch` command:

| File | Schema | Shared with |
|------|--------|------------|
| `.lumi/agent-status.json` | `AgentStatus` from `drivers/types.ts` | Extension sidebar |
| `.lumi/agent.log` | Raw PTY output | `lumi-ops logs` command |
| `.lumi/agent-exit-code` | Single integer | `resolveAgentStatus()` in CLI |

This means the VS Code extension sidebar will show agent status even when agents are launched from TUI.

---

## Config System

**Path**: `~/.lumi-ops/tui-config.toml`

```toml
[agent]
default_driver = "gemini"       # "gemini" | "claude"
no_permissions = true           # skip permission prompts

[agent.gemini]
sandbox = "none"                # gemini sandbox mode

[agent.claude]
max_turns = 100
max_budget_usd = 5.0

[keybindings]
launch_agent = "a"
kill_agent = "x"
settings = "S"
```

- Press `S` → settings popup with current config + path
- Config is optional — sensible defaults if file missing

---

## New/Modified Files

### New

| File | Purpose |
|------|---------|
| `src/app/pty_pool.rs` | `PtyPool` + `AgentInstance` + spawn/kill/switch |
| `src/app/status_detector.rs` | Regex-based status detection |
| `src/app/config.rs` | TOML config loader |
| `src/ui/file_tabs.rs` | Tabbed file viewer |
| `src/ui/agents.rs` | Agent list rendering (replace clone listing) |

### Modified

| File | Change |
|------|--------|
| `src/app/mod.rs` | Replace single PTY fields with PtyPool; agent keybindings |
| `src/ui/terminal.rs` | Render `pool.selected_parser()` |
| `src/main.rs` | Remove auto-spawn; add config loading |
| `Cargo.toml` | Add `toml` crate |

---

## Keybindings

| Key | Context | Action |
|-----|---------|--------|
| `a` | Projects / Agent List | Launch agent on selected clone |
| `x` | Agent List | Kill selected agent |
| `Enter` | Agent List | Switch Terminal to this agent + focus Terminal |
| `[` / `]` | File Viewer | Cycle tabs (MISSION → COMPLETE → LOG) |
| `S` | Anywhere | Show settings popup |
| `1-4` | Anywhere | Jump to panel |
| `Tab` | Anywhere | Cycle panels |
| typing | Terminal (focused) | Send to selected agent's PTY |

---

## Limitations (Phase 1)

- **No persistence**: TUI exits → all agents die. Acceptable for "dashboard always open" usage.
- **No remote agents**: All agents run locally.
- **No external spawn integration**: Agents must be launched from TUI. VS Code "attach to TUI" comes in Phase 2.

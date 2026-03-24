---
name: grove-patterns
description: Condensed reference for Grove OSS patterns (tmux, agent detection, storage, UI). Read instead of the raw .rs files.
---

# Grove Patterns — Quick Reference

> Source: [ZiiMs/Grove](https://github.com/ZiiMs/Grove) — MIT License
> Tech: Rust + ratatui 0.29 + crossterm 0.28 + tokio + tmux

---

## File Quick Reference

| File | Lines | Purpose | When to Use |
|------|-------|---------|-------------|
| `tmux_session.rs` | 217 | `TmuxSession` struct: create, capture, send keys, kill | Building `tmux/session.rs` |
| `agent_model.rs` | 403 | `Agent` struct, `AgentStatus` enum, sparkline, activity history | Building `app/` state types |
| `agent_detector.rs` | 2629 | Regex-based agent status detection (Claude/Gemini/Codex/OpenCode) | Building agent status poller |
| `agent_manager.rs` | 162 | `AgentManager` lifecycle: create, delete, attach, capture, restart | Building `cli/subprocess.rs` |
| `storage.rs` | 110 | JSON session persistence with path-hashed filenames | Building session save/restore |
| `app_state.rs` | 266 | `AppState`, `Action` enum, `InputMode`, `FocusedPanel`, `Config` | Building `app/` module |
| `ui_patterns.rs` | 336 | Terminal setup, event loop, 4-panel layout, keybind matching, ANSI rendering | Building `main.rs` + `ui/` |
| `Cargo.toml` | 50 | Grove dependency versions | Checking compatible crate versions |
| `README.md` | 50 | Extraction summary and adaptation plan | Orientation / overview |

---

## TmuxSession API

```rust
pub struct TmuxSession { pub name: String }
```

| Method | Signature | Description |
|--------|-----------|-------------|
| `new` | `(name: &str) -> Self` | Create wrapper (no tmux call) |
| `create` | `(&self, working_dir: &str, command: &str) -> Result<()>` | `new-session -d` + send command |
| `exists` | `(&self) -> bool` | `has-session -t` (graceful false on error) |
| `capture_pane` | `(&self, lines: usize) -> Result<String>` | `capture-pane -p -e -J -S -{lines}` |
| `send_keys` | `(&self, keys: &str) -> Result<()>` | Send literal text + Enter (`C-m`) |
| `send_keys_raw` | `(&self, keys: &str) -> Result<()>` | Send literal text, no Enter |
| `attach` | `(&self) -> Result<()>` | `attach-session -t` (blocks until detach) |
| `kill` | `(&self) -> Result<()>` | `kill-session -t` (graceful if not found) |
| `pane_current_command` | `(&self) -> Option<String>` | `display-message #{pane_current_command}` |
| `pane_size` | `(&self) -> Result<(u16, u16)>` | `display-message #{pane_width} #{pane_height}` |

**Standalone functions:**
- `is_tmux_available() -> bool` — checks `tmux -V`
- `list_grove_sessions() -> Result<Vec<String>>` — lists sessions prefixed `grove-`

**⚠ Adaptation:** Convert all `std::process::Command` to `tokio::process::Command`. Change prefix `grove-` → `lumi-`.

---

## AgentStatus Detection

### Architecture

```
tmux pane_current_command ──→ ForegroundProcess enum
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
  detect_status_claude()  detect_status_gemini()  (etc.)
              │               │
              ▼               ▼
       StatusDetection { status, reason, pattern }
```

### ForegroundProcess Enum

| Variant | Matches |
|---------|---------|
| `ClaudeRunning` | `node`, `claude`, `npx` |
| `GeminiRunning` | `node`, `gemini` |
| `CodexRunning` | `codex` |
| `OpencodeRunning` | `node`, `opencode`, `npx` |
| `Shell` | `bash`, `zsh`, `sh`, `fish`, `dash` |
| `OtherProcess(String)` | Any other binary (cargo, git, python…) |
| `Unknown` | tmux error or unavailable |

### Shared Regex Pattern Categories

All use `LazyLock<Regex>` for compile-once initialization.

| Pattern Group | What It Matches | Detects |
|---------------|-----------------|---------|
| `ANSI_ESCAPE` | `\x1b[...` escape codes | Strip before analysis |
| `SPINNER_CHARS` | `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏◐◓◑◒⣾⣽⣻⢿⡿⣟⣯⣷` | Running |
| `WORKING_INDICATORS` | Dingbat + `*ing…` (e.g., `✻ Slithering…`) | Running |
| `TOOL_PATTERNS` | `⏺ Read/Write/Edit/Bash/…` or `reading/writing/…` | Running |
| `QUESTION_PATTERNS` | `(y/n)`, `Allow?`, `Run this command?`, `❯ 1.`, `Enter to confirm`, etc. | AwaitingInput |
| `COMPLETION_PATTERNS` | `✓`, `done`, `completed successfully`, `all tests pass` | Completed |
| `ERROR_PATTERNS` | `✗`, `Error:`, `error[E\d+]`, `FAILED`, `panicked at` | Error |

### Agent-Specific Patterns

**Claude Code** — Uses shared patterns only. Detection priority:
1. `QUESTION_PATTERNS` → AwaitingInput
2. `SPINNER_CHARS` / `WORKING_INDICATORS` / `TOOL_PATTERNS` → Running
3. Prompt chars (`>`, `›`, `❯`, `$`, `%`, `➜`) → Idle/Completed
4. `ERROR_PATTERNS` → Error
5. Default: Running (if process alive)

**OpenCode** — Additional patterns:
| Pattern | What | Detects |
|---------|------|---------|
| `OPENCODE_PROGRESS_PATTERN` | `\.{4,}` (4+ dots) | Running |
| `OPENCODE_SPINNER_CHARS` | Braille spinners `⣾⣽⣻⢿⡿⣟⣯⣷⠁⠃⠇…` | Running |
| `"permission required"` | String match (no regex) | AwaitingInput |
| `"type your own answer"` | Plan mode panel | AwaitingInput |

**Codex** — Additional patterns:
| Pattern | What | Detects |
|---------|------|---------|
| `CODEX_WORKING_PATTERN` | `• working (\d+s` | Running |
| `"unanswered"` / `"tab to add notes"` | Question panel | AwaitingInput |

**Gemini** — Additional patterns (most complex):
| Pattern | What | Detects |
|---------|------|---------|
| `GEMINI_ACTION_REQUIRED` | `action\s+required` | AwaitingInput |
| `GEMINI_WAITING_CONFIRMATION` | `waiting\s+for\s+confirmation` | AwaitingInput |
| `GEMINI_ANSWER_QUESTIONS` | `answer\s+questions` | AwaitingInput |
| `GEMINI_KEYBOARD_HINTS` | `enter to select.*esc to cancel` | AwaitingInput |
| `GEMINI_NUMBERED_QUESTIONS` | `\s*\d+\.\s+.+\?$` | AwaitingInput |
| `GEMINI_NUMBERED_ANSWERS` | `\s*[1-4]\.\s+[^?]+$` | Suppresses question detection |
| `GEMINI_CONFIRMATION_PATTERNS` | `proceed?`, `allow this?`, `confirm?`, etc. | AwaitingInput |
| `GEMINI_ESC_CANCEL_TIMER` | `(esc to cancel, \d+s` | Running |
| `GEMINI_DOTS_SPINNER` | `⠁⠃⠇⡇⡏⡟⡿⣿` | Running |

### Checklist Progress Detection

- **Claude Code**: Task summary line (`11 tasks (9 done, …)`), collapsed counts (`+3 completed`), checkbox chars (`[✓]`, `[•]`, `☐`, `●`, etc.)
- **OpenCode**: Side-panel extraction (rightmost 60 chars) then checkbox matching
- **Codex/Gemini**: Falls back to Claude Code detection

### Detection Entry Points

```rust
// Basic (no process info):
pub fn detect_status(output: &str) -> StatusDetection

// With process ground truth (preferred):
pub fn detect_status_with_process(output: &str, fg: ForegroundProcess) -> StatusDetection

// Full agent-aware (routes to correct detector):
pub fn detect_status_for_agent(output: &str, fg: ForegroundProcess, agent: AiAgent) -> StatusDetection

// Checklist:
pub fn detect_checklist_progress(output: &str, ai_agent: AiAgent) -> Option<(u32, u32)>
```

---

## Agent Model

### Core Fields (strip Grove-specific ones for Lumi)

| Field | Type | Keep for Lumi? |
|-------|------|----------------|
| `id` | `Uuid` | ✅ |
| `name` / `branch` | `String` | ✅ |
| `worktree_path` | `String` | ✅ |
| `tmux_session` | `String` | ✅ (format: `lumi-{uuid}`) |
| `status` | `AgentStatus` | ✅ |
| `output_buffer` | `Vec<String>` | ✅ |
| `created_at` / `last_activity` | `DateTime<Utc>` | ✅ |
| `activity_history` | `VecDeque<bool>` (size 20) | ✅ (sparkline) |
| `checklist_progress` | `Option<(u32, u32)>` | ✅ |
| `git_status`, `mr_status`, `pr_status`, `pm_task_status` | Various | ❌ Skip |
| `pause_context` | `PauseContext` | ❌ Skip |

### AgentStatus Enum

| Variant | Symbol | Label | Color |
|---------|--------|-------|-------|
| `Running` | `●` | Running | Green |
| `AwaitingInput` | `⚠` | AWAITING INPUT | Yellow bold |
| `Completed` | `✓` | Completed | Cyan |
| `Idle` | `○` | Idle | Gray |
| `Error(String)` | `✗` | Error | Red |
| `Stopped` | `○` | Stopped | Gray |
| `Paused` | `⏸` | PAUSED | Blue |

### Key Patterns

- **Sparkline**: `activity_history.iter().map(|&a| if a { 1 } else { 0 }).collect::<Vec<u64>>()`
- **Activity recording**: Ring buffer (`VecDeque`, capacity 20), `pop_front` + `push_back`
- **Time formatting**: `num_seconds < 60 → "Xs ago"`, `num_minutes < 60 → "Xm ago"`, etc.
- **Output buffer**: `update_output()` appends lines, trims to `max_lines` from front

---

## Event Loop Pattern

```rust
#[tokio::main]
async fn main() -> Result<()> {
    // 1. Setup: enable_raw_mode + EnterAlternateScreen + EnableMouseCapture
    // 2. Create AppState
    // 3. Create mpsc::unbounded_channel::<Action>()
    // 4. Spawn background pollers (2s interval → send Action through channel)

    loop {
        terminal.draw(|f| ui::render(f, &app))?;     // Draw
        if poll(Duration::from_millis(50))? {          // Keyboard
            if let Event::Key(key) = event::read()? {
                // dispatch → Action
            }
        }
        while let Ok(action) = rx.try_recv() {        // Background updates
            app.apply(action);
        }
        if last_tick.elapsed() >= Duration::from_millis(100) {  // Tick
            tx.send(Action::Tick).ok();
        }
    }

    // 5. Cleanup: disable_raw_mode + LeaveAlternateScreen + DisableMouseCapture
}
```

**Key decisions**: Unbounded channel (no backpressure), 50ms poll timeout, 100ms tick, `watch::channel` for sharing state with pollers.

---

## Adaptation Notes for Lumi-TUI

| Area | Grove | Lumi-TUI Change |
|------|-------|-----------------|
| **Tmux prefix** | `grove-{uuid}` | `lumi-{uuid}` or `lumi-{branch}` |
| **Async tmux** | `std::process::Command` (sync) | `tokio::process::Command` (async) |
| **Agent creation** | Direct `git worktree add` | `lumi-ops spawn` CLI subprocess |
| **Agent deletion** | Direct worktree remove + tmux kill | `lumi-ops kill` CLI subprocess |
| **State source** | `HashMap<Uuid, Agent>` in-memory | `.lumi-metadata.json` file polling |
| **Session naming** | `list_grove_sessions()` filter | `list_lumi_sessions()` filter |
| **Layout** | Single panel | 4-panel (projects \| file/agents \| terminal) |
| **Skip entirely** | Git providers, project mgmt, dev servers, settings UI | Not needed |
| **Storage** | `~/.grove/session-{hash}.json` | `~/.lumi-ops/` (or use metadata file) |
| **Config** | TOML-based `Config` struct | Reuse pattern, change path to `~/.lumi-ops/config.toml` |

---

## Dependencies (from Grove Cargo.toml)

Key crates matching Lumi-TUI needs:

| Crate | Grove Version | Purpose |
|-------|---------------|---------|
| `ratatui` | 0.29 | TUI framework |
| `crossterm` | 0.28 | Terminal backend (features: `event-stream`, `bracketed-paste`) |
| `tokio` | 1 | Async runtime (`rt-multi-thread`, `macros`, `sync`, `time`) |
| `serde` / `serde_json` | 1 | JSON serialization |
| `anyhow` | 1 | Error handling |
| `uuid` | 1 | Agent identification |
| `regex` | 1 | Status detection patterns |
| `chrono` | 0.4 | Timestamps |
| `dirs` | 5 | Home directory resolution |
| `ansi-to-tui` | 7 | Render ANSI tmux output as ratatui styles |
| `tracing` | 0.1 | Structured logging |

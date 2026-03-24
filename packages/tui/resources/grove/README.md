# Grove Pattern Extraction

> Source: [ZiiMs/Grove](https://github.com/ZiiMs/Grove) — MIT License
> Extracted: 2026-03-24

## About Grove

Grove is a Rust TUI for managing multiple Claude Code agents using git worktree isolation. Tech stack: `ratatui 0.29` + `crossterm 0.28` + `tokio` + `rusqlite`. It provides a single-panel dashboard that monitors tmux sessions, detects agent status via regex, and persists sessions across restarts.

## Extracted Files

| File | Source | Lines | What It Contains |
|------|--------|-------|-----------------|
| `tmux_session.rs` | `src/tmux/session.rs` | 217 | Complete `TmuxSession` wrapper: `create()`, `exists()`, `capture_pane()`, `send_keys()`, `send_keys_raw()`, `attach()`, `kill()`, `pane_current_command()`, `pane_size()`. Plus `is_tmux_available()` and `list_grove_sessions()` helpers. |
| `agent_model.rs` | `src/agent/model.rs` | 403 | `Agent` struct, `AgentStatus` enum (Running/AwaitingInput/Completed/Idle/Error/Stopped/Paused), `StatusReason`, sparkline data pattern, activity history (`VecDeque<bool>`), output buffer management, time-since-activity formatting. |
| `agent_detector.rs` | `src/agent/detector.rs` | **2629** | **CRITICAL** — All regex patterns for status detection across 4 AI agents (Claude/Gemini/Codex/OpenCode). Includes: spinner chars, working indicators, tool execution patterns, question/permission prompts, completion patterns, error patterns, Gemini-specific patterns, Codex-specific patterns, OpenCode-specific patterns. Uses `LazyLock<Regex>` for compiled patterns. Includes `ForegroundProcess` enum, `detect_status_with_process()`, and `detect_checklist_progress()`. |
| `agent_manager.rs` | `src/agent/manager.rs` | 162 | `AgentManager` lifecycle: `create_agent()` (creates worktree + tmux session), `delete_agent()` (kills tmux + removes worktree), `attach_to_agent()`, `capture_output()`, `detect_status()`, `send_input()`, `restart_agent()`, `find_orphaned_sessions()`. |
| `storage.rs` | `src/storage/session.rs` | 110 | `SessionStorage` pattern: JSON-based session persistence using path hashing. `SessionData` struct with agent list + selected index. `save_session()` / `load_session()` helpers. |
| `app_state.rs` | Multiple (`app/`) | ~200 | **Curated** extraction of `Action` enum, `InputMode`, `AppState` struct, `FocusedPanel`, `AiAgent` config, `Keybind` struct. Includes Lumi-TUI adaptation notes. |
| `ui_patterns.rs` | Multiple (`ui/`, `main.rs`) | ~260 | **Curated** extraction of terminal setup/cleanup, main event loop pattern, 4-panel layout sketch, keybind matching helper, ANSI rendering notes, centered rect helper. |
| `Cargo.toml` | Root `Cargo.toml` | 50 | Full dependency reference for the Grove project. |

## Adaptation Plan for Lumi-TUI

### Direct Reuse (minimal changes)
- **`tmux_session.rs`** → Convert `std::process::Command` to `tokio::process::Command` for async. Change session prefix from `grove-` to `lumi-`.
- **`agent_detector.rs`** → Use as-is for status detection. This is the most valuable extraction — 2600+ lines of battle-tested regex patterns for Claude, Gemini, Codex, and OpenCode.
- **`storage.rs`** → Adapt storage path from `~/.grove/` to `~/.lumi-ops/`. Consider using `rusqlite` instead of JSON for better concurrent access.
- **Keybind matching** from `ui_patterns.rs` → Portable as-is.

### Adapt Significantly
- **`agent_model.rs`** → Strip Grove-specific fields (git provider status, project mgmt status). Add Lumi-specific fields (ReviewStatus from `.lumi-metadata.json`, mission file paths).
- **`agent_manager.rs`** → Replace direct git worktree calls with `lumi-ops` CLI subprocess calls. Lumi-TUI never calls git directly.
- **`app_state.rs`** → Replace `HashMap<Uuid, Agent>` with clone data from `.lumi-metadata.json`. Add `FocusedPanel` for 4-panel navigation.
- **`ui_patterns.rs`** → Replace single-panel layout with 4-panel layout. Add `tui-tree-widget` for project tree, `ansi-to-tui` for terminal panel.

### Skip (Grove-specific)
- Git provider integrations (GitLab, GitHub, Codeberg)
- Project management integrations (Asana, Notion, ClickUp, etc.)
- Dev server management
- Settings UI complexity (Grove's `state.rs` is 1797 lines mostly settings)

## Key Architecture Patterns

1. **Action Dispatch**: All events (keyboard + background) are `Action` enum variants sent through `mpsc::unbounded_channel`.
2. **Watch Channels**: `watch::channel` shares agent list/selection with background pollers without mutex contention.
3. **Process-Based Detection**: `ForegroundProcess` enum classifies the tmux pane's foreground process, then routes to agent-specific regex detection (e.g., `detect_status_gemini()`).
4. **Graceful Fallbacks**: All tmux calls return `Option<T>` or `Result<T>` with meaningful fallback behavior.
5. **Session Persistence**: JSON file with path-based hashing for per-repo session files. Auto-continues agents on restart.

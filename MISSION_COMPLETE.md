# Mission Complete: Always-On Home CLI Agent in Terminal Panel

## Summary

All requirements from the mission have been implemented. The Terminal panel now hosts a persistent home CLI agent session from TUI startup, independent of clone agents.

## What Was Done

### 1. PtyPool Architecture (`app/pty_pool.rs`)
- Added `home: Option<AgentInstance>` field, separate from `agents` vec
- Added `viewing_clone: bool` to track which PTY is displayed
- New methods: `spawn_home()`, `home_parser()`, `home_agent()`, `home_agent_mut()`, `has_home()`
- New view-routing methods: `active_parser()`, `write_to_active()`, `attach_clone()`, `detach_to_home()`, `is_viewing_clone()`, `has_any_active()`
- `kill()` now auto-detaches to home when the viewed clone agent is killed
- `spawn()` sets `viewing_clone = true` so new clone agents auto-attach
- Home PTY is never touched by `kill()` — only destroyed on TUI exit

### 2. AppState Changes (`app/mod.rs`)
- Added `Action::DetachToHome` variant
- Added `needs_agent_selection: bool` for deferred selection when both agents are available
- All key writes in Terminal mode routed through `write_to_active()` instead of `write_to_selected()`
- Esc in Terminal: if `viewing_clone` → `detach_to_home()` + return `DetachToHome`; else → jump to Projects
- `is_empty()` check replaced with `has_any_active()` so home agent also enables key forwarding
- Enter on AgentList calls `attach_clone(selected_index())` before returning `AttachAgent`

### 3. Startup Agent Detection (`main.rs`)
- `detect_agents()` checks `which gemini` / `which claude` on startup
- Single agent found → `spawn_home_agent()` called immediately
- Both found → `app.needs_agent_selection = true`, deferred to first Terminal focus
- Neither found → warning logged, terminal shows placeholder
- Deferred selection: when Terminal focused + `needs_agent_selection`, keys `1`/`2` select gemini/claude

### 4. Terminal Renderer (`ui/terminal.rs`)
- Uses `app.pty_pool.active_parser()` instead of `selected_parser()`
- Title: `"Terminal (home)"` when home is active, `"Terminal [branch]"` when clone is attached
- Shows agent selection prompt (`"Select agent: [1] gemini  [2] claude"`) when `needs_agent_selection`
- No longer shows "No agent running" when home is alive

### 5. Tests Added
- `active_parser_returns_none_when_no_home`
- `home_parser_returns_none_without_home`
- `has_any_active_false_when_empty`
- `attach_clone_noop_on_empty_agents`
- `detach_to_home_sets_viewing_clone_false`
- `write_to_active_errors_when_no_home_and_not_viewing_clone`
- `active_agent_returns_none_when_empty`

## Verification

- `cargo build` passes
- `cargo test -p lumi-tui` passes
- Existing clone agent workflows (launch/kill/attach via `a`/`x`/Enter) unchanged

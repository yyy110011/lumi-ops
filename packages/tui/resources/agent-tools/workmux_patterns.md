# workmux — Patterns

> **Repo:** https://github.com/raine/workmux
> **License:** MIT
> **Tech Stack:** Rust, ratatui 0.30, crossterm 0.29, clap 4, serde, minijinja
> **Binary:** `workmux` (v0.1.147)

## Architecture Overview

workmux is a **mature, full-featured** workflow tool that orchestrates git worktrees and terminal multiplexers. It's the most comprehensive tool in this survey — far beyond a "minimal TUI". Key areas:

- **Dashboard** (`src/command/dashboard/`) — A ratatui-based TUI with two tabs: Agents and Worktrees.
- **Multiplexer abstraction** (`src/multiplexer/`) — Trait-based abstraction over tmux, wezterm, kitty, and zellij.
- **Workflow engine** (`src/workflow/`) — High-level operations: create worktree, open in multiplexer, merge, remove.
- **Sandbox** (`src/sandbox/`) — Lima-based VM sandboxing with RPC, clipboard forwarding, toolchain management.
- **State store** (`src/state/`) — JSON-backed persistent state for settings, last selected agent, etc.
- **Agent setup** (`src/agent_setup/`) — Auto-configures Claude, Copilot, OpenCode, pi per-worktree.
- **Template engine** — Uses minijinja for prompt/config templates.

## Unique Patterns

### 1. Multiplexer Abstraction Trait

workmux defines a `Multiplexer` trait that abstracts over tmux, wezterm, kitty, and zellij. This allows the dashboard to work regardless of which terminal multiplexer the user runs.

```
src/multiplexer/
├── mod.rs          # Multiplexer trait definition
├── tmux.rs         # tmux implementation
├── wezterm.rs      # wezterm implementation
├── kitty.rs        # kitty implementation
├── zellij.rs       # zellij implementation
├── agent.rs        # AgentPane, AgentStatus types
├── types.rs        # MultiplexerType enum
├── handle.rs       # Window/pane handle abstraction
├── handshake.rs    # Initial multiplexer detection
└── util.rs         # Shared helpers
```

Key types from `agent.rs`:
- `AgentPane` — Represents a detected agent in a multiplexer pane (session, window, pane_id, worktree path, status, status_ts).
- `AgentStatus` — Enum with `Active`, `Idle`, `Waiting` variants, detected via pane content analysis.

### 2. Dashboard App Architecture (Event-Driven)

The dashboard uses an event channel pattern:

```rust
pub enum AppEvent {
    AgentList(Vec<AgentPane>),
    WorktreeList(Vec<Worktree>),
    GitLog(PathBuf, String),
    Error(String),
    // ...
}
```

- Agent list is fetched in a background thread via the Multiplexer trait.
- Worktree list is fetched in a separate background thread.
- UI renders from cached state; events update the cache.
- Atomic flags (`AtomicBool`) prevent concurrent fetches.

### 3. Agent Status Detection via Pane Content

workmux detects agent status by capturing pane content from the terminal multiplexer and pattern matching:

- Multiplexer implementations call subprocess commands (`tmux capture-pane`, etc.)
- Content is analyzed for patterns like "Waiting for input", progress indicators
- `status_ts` timestamp tracks when status last changed (used for stale detection)

### 4. Stale Agent Detection

```rust
pub fn is_stale(status_ts: Option<u64>, stale_threshold_secs: u64, now_secs: u64) -> bool {
    status_ts
        .map(|ts| now_secs.saturating_sub(ts) > stale_threshold_secs)
        .unwrap_or(false)
}
```

Configurable threshold; UI can hide stale agents with a toggle.

### 5. Stable Selection via ID Tracking

Instead of tracking selection by index (which breaks when the list changes), workmux tracks `selected_pane_id` and restores the cursor position after any list update. This prevents the selection from jumping.

### 6. Scope Filter (All vs Session)

The dashboard supports filtering agents by "All sessions" or "Current session only", persisted via the StateStore.

### 7. Diff View in TUI

Built-in diff viewer using the `similar` crate for inline diffs within the TUI, supporting patch mode for reviewing changes.

## Code Snippets Worth Borrowing

- **`src/command/dashboard/agent.rs`** — `extract_worktree_name()`, `format_duration()`, `format_age()` — pure helper functions.
- **`src/command/dashboard/app/agents.rs`** — `apply_filters()` — robust filter/sort/restore-selection logic.
- **`src/command/dashboard/app/worktrees.rs`** — `spawn_worktree_fetch()` — background fetch with `AtomicBool` guard.
- **`src/command/dashboard/ui/theme.rs`** — Theme abstraction for dark/light modes.
- **`src/multiplexer/mod.rs`** — Trait-based multiplexer abstraction.

## Relevance to Lumi TUI

| Feature | Relevance |
|---------|-----------|
| Multiplexer abstraction | **High** — We need the same tmux/zellij abstraction for our TUI |
| Event-driven dashboard | **High** — Same architecture pattern for our ratatui app |
| Stable selection tracking | **High** — Must-have for any live-updating list |
| Stale agent detection | **Medium** — Useful for long-running sessions |
| Diff view | **Medium** — Could reuse for reviewing clone changes |
| Lima sandboxing | **Low** — Our v0.6 doesn't plan VM-level isolation |

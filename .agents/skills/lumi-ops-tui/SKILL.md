---
name: lumi-ops-tui
description: Architecture, protocol types, OSS references, and development patterns for the Lumi-Ops TUI dashboard (Rust + ratatui). Use when implementing TUI panels, protocol parsers, tmux integration, modifying the event loop, adding key bindings, or working on any file under packages/tui/src/. Read this FIRST before touching any TUI source file.
---

# Lumi-Ops TUI — Development Skill

> AI Agent 指揮中心，活在你的 terminal 裡。

## Quick Facts

| Item | Value |
|------|-------|
| Language | Rust (2021 edition) |
| TUI Framework | ratatui 0.29 + crossterm 0.28 |
| Async Runtime | tokio (rt-multi-thread) |
| Package Path | `packages/tui/` |
| Binary Name | `lumi-tui` |
| Design Doc | `packages/tui/doc/design.md` |

---

## Instructions

### Step 1: Understand the Architecture

The TUI is a **pure consumer** of file-based state. It never calls git directly.

```
┌────────────────────────────────────┐
│       Data Layer (Files)           │
│  .lumi-metadata.json               │
│  MISSION.md / MISSION_COMPLETE.md  │
│  ~/.lumi-ops/.registry.json        │
└──────┬─────────────┬───────────────┘
       │             │
  ┌────▼────┐   ┌────▼────┐
  │   TUI   │   │  tmux   │
  │ (read)  │   │ (read/  │
  │         │   │  write) │
  └────┬────┘   └─────────┘
       │
  ┌────▼──────────┐
  │ lumi-ops CLI  │  ← 唯一 mutation 源
  └───────────────┘
```

For protocol types and Rust struct definitions, consult `references/protocol-types.md`.

### Step 2: Know the Layout

4-panel layout:

```
┌─────────────┬────────────────────────┬──────────────────────┐
│  Projects   │  📄 File Viewer        │  Agent Terminal      │
│  Registry   │  (MISSION.md preview)  │  (tmux capture-pane) │
│  (~20%)     ├────────────────────────┤  (~40%)              │
│             │  Active Agents Table   │                      │
│             │  (中下, ~60% height)   │  Input box at bottom │
├─────────────┴────────────────────────┴──────────────────────┤
│ [q]uit [n]ew [a]ttach [s]top [r]eview [d]iff [m]erge       │
└─────────────────────────────────────────────────────────────┘
```

### Step 3: Know the Module Structure

```
packages/tui/src/
├── main.rs                    # tokio::main, event loop, terminal setup
├── app/
│   ├── mod.rs                 # AppState, FocusedPanel enum
│   ├── actions.rs             # Action enum dispatch (keybindings → mutations)
│   └── config.rs              # User config (optional toml)
├── protocol/                  # Lumi Protocol parsers (pure, testable)
│   ├── mod.rs
│   ├── metadata.rs            # Parse .lumi-metadata.json
│   ├── registry.rs            # Parse ~/.lumi-ops/.registry.json
│   ├── mission.rs             # Read MISSION.md / MISSION_COMPLETE.md
│   └── worktree.rs            # Parse `lumi-ops list --json` output
├── tmux/
│   ├── mod.rs
│   └── session.rs             # TmuxSession: create, capture_pane, send_keys
├── cli/
│   ├── mod.rs
│   └── subprocess.rs          # Async subprocess calls to `lumi-ops` CLI
├── ui/
│   ├── mod.rs                 # Root widget draws 4 panels
│   ├── projects.rs            # Left: tui-tree-widget for repo → clones
│   ├── file_viewer.rs         # Center-top: markdown rendering
│   ├── agent_list.rs          # Center-bottom: agent table
│   ├── terminal.rs            # Right: ANSI output via ansi-to-tui
│   └── status_bar.rs          # Bottom: shortcut hints
```

### Step 4: Adding a New Panel

1. Create `ui/<panel_name>.rs` with a render function taking `&AppState` and `Frame`/`Rect`
2. Add relevant state fields to `AppState` in `app/mod.rs`
3. Add the panel's `FocusedPanel` variant to the enum
4. Wire into the root layout in `ui/mod.rs`
5. Add keyboard shortcuts in `app/actions.rs`

### Step 5: Adding a New Key Binding

1. Add a variant to the `Action` enum in `app/actions.rs`
2. Map the key in `handle_key()` (respect `FocusedPanel` for context-sensitive bindings)
3. Handle the action in the main loop or `app.apply_action()`
4. Update the status bar hints in `ui/status_bar.rs`

### Step 6: Consult Reference Material

Before writing code, consult the detailed references:

- **Protocol types & Rust structs**: `references/protocol-types.md`
- **Event loop, CLI subprocess, tmux patterns**: `references/code-patterns.md`
- **Cargo.toml dependencies & crate docs**: `references/dependencies.md`

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `q` | Quit |
| `n` | New clone (spawn dialog) |
| `a` | Attach to tmux session |
| `s` | Stop agent |
| `r` | Set needsReview / view review |
| `d` | Show diff |
| `m` | Merge clone |
| `k` | Kill clone |
| `Tab` | Cycle panel focus |
| `1-4` | Jump to panel |
| `/` | Fuzzy search |
| `?` | Help overlay |

## Important Rules

1. **Pure consumer** — TUI never writes to `.lumi-metadata.json` or git. All mutations go through `lumi-ops` CLI.
2. **Protocol compatibility** — Rust structs must exactly mirror the TypeScript types from `@lumi-ops/cli`. When CLI types change, TUI structs must update.
3. **Graceful degradation** — All file reads and tmux calls should handle "not found" / "not running" gracefully with `Option<T>`.
4. **ANSI passthrough** — Use `ansi-to-tui` to render tmux output with color codes preserved. Use `-e` flag on `capture-pane`.
5. **No blocking** — All subprocess calls must be `tokio::process::Command`, never `std::process::Command` in the event loop.

## Build & Run

```bash
cd packages/tui
cargo run                                              # Development
cargo build --release                                  # Release build
cargo run -- /path/to/repo                             # Run with specific repo
RUST_LOG=lumi_tui=debug cargo run 2>/tmp/lumi-tui.log  # Debug logging
```

## Troubleshooting

| Symptom | Cause | Solution |
|---------|-------|----------|
| No repos listed | Registry file missing or empty | Run `lumi-ops spawn` once from the target repo to auto-register |
| tmux pane shows nothing | tmux session not running | Check `tmux ls`; agent may have exited — verify with `tmux has-session -t <name>` |
| Metadata parse error | JSON format mismatch with CLI | Ensure `serde(rename_all = "camelCase")` matches CLI's JSON output; check `references/protocol-types.md` |
| ANSI colors garbled | Missing `-e` flag on capture-pane | Ensure `capture-pane` uses `-p -e -J` flags |
| Compile error on crossterm | Version mismatch with ratatui | Check `references/dependencies.md` for compatible versions |
| Stale data in UI | Polling not running | Verify the 2s polling tokio::spawn tasks are active; check for channel errors |

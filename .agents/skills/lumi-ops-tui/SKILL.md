---
name: lumi-ops-tui
description: Architecture, protocol types, OSS references, and development patterns for the Lumi-Ops TUI dashboard (Rust + ratatui). Read this FIRST before touching any TUI source file.
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
| Design Doc | [design.md](file:///packages/tui/doc/design.md) |

---

## Architecture — The TUI is a Consumer

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

**Core rules:**
1. TUI **never** calls git directly — all mutations go through `lumi-ops` CLI subprocess
2. tmux interaction: `capture-pane -p -e -J` (read) + `send-keys` (write)
3. State refresh via **2-second polling loop** reading file-based state

---

## Layout — 4 Panels

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

---

## Protocol Types (from CLI — must mirror in Rust)

### `.lumi-metadata.json` — Per-repo metadata

```json
{
  "feat/my-task": {
    "baseBranch": "main",
    "description": "Add auth module",
    "reviewStatus": "inProgress",
    "sourcePrompt": "add-auth.md"
  }
}
```

**Rust struct:**
```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloneMetadata {
    pub base_branch: Option<String>,
    pub description: Option<String>,
    pub review_status: Option<ReviewStatus>,
    pub source_prompt: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ReviewStatus {
    Todo,
    InProgress,
    Done,
    WontDo,
    NeedsReview,
    NeedsRevision,
}
```

### `~/.lumi-ops/.registry.json` — Global repo registry

```json
{
  "lumi-ops": "/Users/ryan/project_in_progress/lumi-ops",
  "lumadient": "/Users/ryan/project_in_progress/lumadient"
}
```

**Rust struct:**
```rust
pub type RepoRegistry = std::collections::HashMap<String, String>;
// key = repo name, value = absolute root path
```

### Computed: Clone directory layout

```
<repoRoot>.worktrees/
├── .lumi-metadata.json      ← centralized metadata for ALL clones
├── feat/my-task/             ← worktree directory
│   ├── .lumi/
│   │   ├── MISSION.md
│   │   ├── MISSION_COMPLETE.md
│   │   └── REVIEW_FEEDBACK.md
│   └── (source code)
└── fix/bug-123/
```

- Clone ID = relative path under `.worktrees/` (e.g., `feat/my-task`)
- Metadata path = `<repoRoot>.worktrees/.lumi-metadata.json`
- Mission path = `<worktreePath>/.lumi/MISSION.md`

---

## Cargo.toml — Recommended Dependencies

Based on Grove (MIT) reference + design requirements:

```toml
[package]
name = "lumi-tui"
version = "0.1.0"
edition = "2021"

[dependencies]
# TUI
ratatui = "0.29"
crossterm = { version = "0.28", features = ["event-stream"] }
ansi-to-tui = "7"          # Render ANSI from tmux capture-pane

# Async
tokio = { version = "1", features = ["rt-multi-thread", "macros", "sync", "time", "process"] }

# Serialization
serde = { version = "1", features = ["derive"] }
serde_json = "1"

# Error handling
anyhow = "1"

# Logging
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter"] }

# Time
chrono = { version = "0.4", features = ["serde"] }

# Markdown rendering
pulldown-cmark = "0.12"

# Tree widget
tui-tree-widget = "0.22"

# Text input
tui-textarea = "0.7"

# Fuzzy search
fuzzy-matcher = "0.3"

# Dirs
dirs = "5"

# UUID (for agent tracking)
uuid = { version = "1", features = ["v4", "serde"] }

# Regex (for agent status detection)
regex = "1"
```

> **Note:** `git2` is optional — TUI reads file state directly. Only needed if we want branch listing without `lumi-ops list --json`.

---

## Module Structure

```
packages/tui/src/
├── main.rs                    # tokio::main, event loop, terminal setup
├── app/
│   ├── mod.rs                 # AppState, FocusedPanel enum
│   ├── actions.rs             # Action enum dispatch (keybindings → mutations)
│   └── config.rs              # User config (optional toml)
├── protocol/                  # Lumi Protocol parsers (pure, testable)
│   ├── mod.rs
│   ├── metadata.rs            # Parse .lumi-metadata.json → HashMap<String, CloneMetadata>
│   ├── registry.rs            # Parse ~/.lumi-ops/.registry.json → RepoRegistry
│   ├── mission.rs             # Read MISSION.md / MISSION_COMPLETE.md / REVIEW_FEEDBACK.md
│   └── worktree.rs            # Parse `lumi-ops list --json` output → Vec<ShadowClone>
├── tmux/
│   ├── mod.rs
│   └── session.rs             # TmuxSession: create, capture_pane, send_keys, attach, kill, exists
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

---

## Open Source Reference — Borrowable Code

### 🥇 Grove (ZiiMs/Grove) — MIT License ✅

**GitHub:** https://github.com/ZiiMs/Grove
**Tech match:** Rust + ratatui 0.29 + crossterm 0.28 + tokio + tmux

#### Borrow: `tmux/session.rs`
tmux wrapper with: `create(working_dir, command)`, `exists()`, `capture_pane(lines)`, `send_keys(keys)`, `send_keys_raw(keys)`, `attach()`, `kill()`, `pane_current_command()`, `pane_size()`.

Key pattern — capture with ANSI preserved:
```rust
Command::new("tmux")
    .args(["capture-pane", "-t", &self.name, "-p", "-e", "-J", "-S", &format!("-{}", lines)])
```

#### Borrow: `agent/model.rs`
Agent struct with: `id (UUID)`, `branch`, `worktree_path`, `tmux_session`, `status`, `output_buffer`, `created_at`, `last_activity`, `activity_history (VecDeque<bool>)`, `checklist_progress`.

Sparkline pattern:
```rust
pub fn sparkline_data(&self) -> Vec<u64> {
    self.activity_history.iter().map(|&active| if active { 1 } else { 0 }).collect()
}
```

#### Borrow: `agent/detector.rs`
Status detection via regex patterns on tmux output for Claude/Gemini/Codex. Uses `LazyLock<Regex>` for compiled patterns.

#### Borrow: Entry point pattern (main.rs)
- `enable_raw_mode()` + `EnterAlternateScreen` + `EnableMouseCapture`
- Event loop with `poll(Duration)` + `crossterm::event::read()`
- `tokio::spawn` for background polling tasks
- `watch::channel` for shared state updates

### 🥈 Pertmux Architecture (for future v2)

**Daemon/Client via Unix Socket:**
```
pertmux serve → background daemon → polls tmux/metadata/forge every 2-60s
                                   → broadcasts DashboardSnapshot
                                   → TUI clients connect via /tmp/pertmux-{USER}.sock
```

**Skip for Phase 1** — use direct file reads. Consider for Phase 2 if we need multi-client support (VS Code extension + TUI reading same state).

---

## Event Loop Pattern (from Grove)

```rust
#[tokio::main]
async fn main() -> Result<()> {
    // 1. Setup terminal
    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen, EnableMouseCapture)?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;

    // 2. Create app state
    let mut app = AppState::new();

    // 3. Spawn background pollers
    let (tx, mut rx) = mpsc::channel(32);
    tokio::spawn(poll_metadata(tx.clone()));      // 2s interval
    tokio::spawn(poll_agent_status(tx.clone()));   // 2s interval

    // 4. Main loop
    loop {
        terminal.draw(|f| ui::render(f, &app))?;

        // Check for keyboard events with short timeout
        if poll(Duration::from_millis(100))? {
            if let Event::Key(key) = event::read()? {
                match app.handle_key(key) {
                    Action::Quit => break,
                    Action::SpawnClone(desc) => { /* subprocess */ },
                    // ...
                    _ => {}
                }
            }
        }

        // Drain background updates
        while let Ok(update) = rx.try_recv() {
            app.apply_update(update);
        }
    }

    // 5. Cleanup
    disable_raw_mode()?;
    execute!(terminal.backend_mut(), LeaveAlternateScreen, DisableMouseCapture)?;
    terminal.show_cursor()?;
    Ok(())
}
```

---

## CLI Subprocess Pattern

All mutations via `lumi-ops` CLI:

```rust
use tokio::process::Command;
use anyhow::Result;

pub async fn spawn_clone(root: &str, branch: &str, description: &str) -> Result<String> {
    let output = Command::new("lumi-ops")
        .args(["spawn", branch, "--root", root, "--description", description])
        .output()
        .await?;
    if !output.status.success() {
        anyhow::bail!("spawn failed: {}", String::from_utf8_lossy(&output.stderr));
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

pub async fn list_clones_json(root: &str) -> Result<Vec<ShadowClone>> {
    let output = Command::new("lumi-ops")
        .args(["list", "--root", root, "--json"])
        .output()
        .await?;
    let clones: Vec<ShadowClone> = serde_json::from_slice(&output.stdout)?;
    Ok(clones)
}

pub async fn kill_clone(root: &str, branch: &str) -> Result<()> { /* ... */ }
pub async fn merge_clone(root: &str, branch: &str, target: &str) -> Result<()> { /* ... */ }
```

---

## Status Icons

| ReviewStatus | Icon |
|-------------|------|
| `todo` | 🟡 |
| `inProgress` | 🔵 |
| `needsReview` | 🟣 |
| `needsRevision` | 🟠 |
| `done` | ✅ |
| `wontDo` | ⬛ |

| Agent Status | Icon |
|-------------|------|
| Running | 🤖 |
| Waiting (input) | ⏳ |
| Completed | ✅ |
| Failed | ❌ |
| Idle (no tmux) | 💤 |

---

## Key Crate Documentation References

| Crate | Docs |
|-------|------|
| ratatui | https://docs.rs/ratatui/latest |
| crossterm | https://docs.rs/crossterm/latest |
| ansi-to-tui | https://docs.rs/ansi-to-tui/latest |
| tui-tree-widget | https://docs.rs/tui-tree-widget/latest |
| tui-textarea | https://docs.rs/tui-textarea/latest |
| pulldown-cmark | https://docs.rs/pulldown-cmark/latest |
| fuzzy-matcher | https://docs.rs/fuzzy-matcher/latest |

---

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

---

## Build & Run

```bash
# Development
cd packages/tui
cargo run

# Release build
cargo build --release

# Run with specific repo
cargo run -- /path/to/repo

# Debug logging
RUST_LOG=lumi_tui=debug cargo run 2>/tmp/lumi-tui.log
```

---

## Important Rules

1. **Pure consumer** — TUI never writes to `.lumi-metadata.json` or git. All mutations go through `lumi-ops` CLI.
2. **Protocol compatibility** — Rust structs must exactly mirror the TypeScript types from `@lumi-ops/cli`. When CLI types change, TUI structs must update.
3. **Graceful degradation** — All file reads and tmux calls should handle "not found" / "not running" gracefully with `Option<T>`.
4. **ANSI passthrough** — Use `ansi-to-tui` to render tmux output with color codes preserved. Use `-e` flag on `capture-pane`.
5. **No blocking** — All subprocess calls must be `tokio::process::Command`, never `std::process::Command` in the event loop.

# Lumi-Ops TUI — Code Patterns

## Open Source Reference — Grove (MIT)

**GitHub:** https://github.com/ZiiMs/Grove
**Tech match:** Rust + ratatui 0.29 + crossterm 0.28 + tokio + tmux

### Tmux Session Pattern (`tmux/session.rs`)

tmux wrapper with: `create(working_dir, command)`, `exists()`, `capture_pane(lines)`, `send_keys(keys)`, `send_keys_raw(keys)`, `attach()`, `kill()`, `pane_current_command()`, `pane_size()`.

Key pattern — capture with ANSI preserved:
```rust
Command::new("tmux")
    .args(["capture-pane", "-t", &self.name, "-p", "-e", "-J", "-S", &format!("-{}", lines)])
```

### Agent Model Pattern (`agent/model.rs`)

Agent struct with: `id (UUID)`, `branch`, `worktree_path`, `tmux_session`, `status`, `output_buffer`, `created_at`, `last_activity`, `activity_history (VecDeque<bool>)`, `checklist_progress`.

Sparkline pattern:
```rust
pub fn sparkline_data(&self) -> Vec<u64> {
    self.activity_history.iter().map(|&active| if active { 1 } else { 0 }).collect()
}
```

### Agent Status Detection (`agent/detector.rs`)

Status detection via regex patterns on tmux output for Claude/Gemini/Codex. Uses `LazyLock<Regex>` for compiled patterns.

---

## Event Loop Pattern

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

## Pertmux Architecture (for future v2)

**Daemon/Client via Unix Socket:**
```
pertmux serve → background daemon → polls tmux/metadata/forge every 2-60s
                                   → broadcasts DashboardSnapshot
                                   → TUI clients connect via /tmp/pertmux-{USER}.sock
```

**Skip for Phase 1** — use direct file reads. Consider for Phase 2 if we need multi-client support.

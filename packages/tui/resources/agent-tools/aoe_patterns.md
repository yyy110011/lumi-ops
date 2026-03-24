# Agent of Empires (AoE) — Patterns

> **Repo:** https://github.com/njbrake/agent-of-empires
> **License:** MIT
> **Tech Stack:** Rust, ratatui 0.30, crossterm 0.29, tokio, git2, notify, portable-pty
> **Binary:** `aoe` (v0.18.0)

## Architecture Overview

A **complete terminal session manager** for AI coding agents. AoE is architecturally closest to what Lumi TUI aims to be — it wraps tmux, manages git worktrees, supports Docker sandboxing, and provides a full TUI dashboard.

```
src/
├── agents.rs              # Multi-agent type detection
├── containers/
│   ├── container_interface.rs  # ContainerRuntimeInterface trait
│   ├── docker.rs              # Docker implementation
│   ├── podman.rs              # Podman implementation
│   └── runtime_base.rs        # Shared container runtime logic
├── session/
│   ├── config.rs              # Session config (TOML), sort order, profiles
│   ├── instance.rs            # Session instance model
│   ├── storage.rs             # JSON file-based session storage
│   ├── status.rs              # Session status detection
│   └── sandbox_info.rs        # Sandbox metadata per session
├── tmux/                      # tmux wrapper (similar to others)
├── tui/
│   ├── mod.rs                 # Main TUI app (ratatui event loop)
│   ├── home/                  # Home view (session list + operations)
│   ├── diff/                  # Diff view (review git changes)
│   ├── settings/              # Settings view
│   ├── status_poller.rs       # Background status polling
│   ├── creation_poller.rs     # Async session creation tracking
│   ├── deletion_poller.rs     # Async session deletion tracking
│   ├── styles.rs              # TUI colors and styles
│   ├── components/            # Reusable UI components
│   └── dialogs/               # Modal dialogs
├── migrations/                # Data migration system (v001-v004)
└── update/                    # Self-update checker
```

## Unique Patterns

### 1. Container Runtime Abstraction

Like workmux's multiplexer abstraction, AoE abstracts container runtimes:

```rust
pub trait ContainerRuntimeInterface {
    fn is_available(&self) -> bool;
    fn is_daemon_running(&self) -> bool;
    fn get_version(&self) -> Result<String>;
    fn create_container(&self, name: &str, image: &str, config: &ContainerConfig) -> Result<String>;
    fn start_container(&self, name: &str) -> Result<()>;
    fn stop_container(&self, name: &str) -> Result<()>;
    fn is_container_running(&self, name: &str) -> Result<bool>;
    fn exec_in_container(&self, name: &str, cmd: &[&str]) -> Result<Output>;
    fn build_create_args(&self, name: &str, image: &str, config: &ContainerConfig) -> Vec<String>;
    // ...
}
```

Shared base implementation in `RuntimeBase` — Docker and Podman implement the trait, with most logic shared.

### 2. Status Poller Pattern (Background Thread)

Non-blocking status detection using a dedicated polling thread:

```rust
pub struct StatusPoller {
    request_tx: mpsc::Sender<Vec<Instance>>,
    result_rx: mpsc::Receiver<Vec<StatusUpdate>>,
    _handle: thread::JoinHandle<()>,
}

pub struct StatusUpdate {
    pub id: String,
    pub status: Status,
    pub last_error: Option<String>,
}
```

**Key design decisions:**
- The TUI sends the current instance list to the poller
- The poller runs tmux subprocess calls on a background thread
- Results are returned via a channel
- Container health is checked with rate limiting (5s interval)
- The poller caches container states to avoid expensive Docker API calls

### 3. Sandbox-Aware Status Detection

The status poller integrates container health into session status:

```rust
if inst.is_sandboxed() {
    if let Some(sandbox) = &inst.sandbox_info {
        if let Some(&running) = container_states.get(&sandbox.container_name) {
            if !running {
                return StatusUpdate {
                    status: Status::Error,
                    last_error: Some("Container is not running".to_string()),
                };
            }
        }
    }
}
```

Container state is batch-checked (all containers in one call) rather than per-session.

### 4. Git Worktree Auto-Management

AoE auto-creates git worktrees when adding sessions:

```bash
aoe add . -w feat/my-feature -b  # Create worktree + branch + session
```

Integrated with `git2` crate for native Git operations (no subprocess calls for git).

### 5. Agent + Terminal Dual View Mode

```rust
pub enum ViewMode {
    Agent,     // Show AI agent pane
    Terminal,  // Show paired shell terminal pane
}
```

Each session has two tmux panes: one for the agent, one for terminal. Toggle with `t` key.

### 6. Profile System

Separate workspaces for different projects/clients:

```rust
// Session config supports multiple profiles
// Each profile has its own session list and settings
```

### 7. Creation/Deletion Pollers

Async tracking of long-running operations:

```rust
pub struct CreationPoller {
    // Tracks session creation progress (worktree init, Docker build, etc.)
}

pub struct DeletionPoller {
    // Tracks session cleanup (container removal, worktree prune)
}
```

These prevent the TUI from blocking during potentially slow operations.

### 8. Multi-Agent Support (8 agents)

The broadest agent support: Claude Code, OpenCode, Mistral Vibe, Codex CLI, Gemini CLI, Cursor CLI, Copilot CLI, and Pi.dev.

### 9. Data Migrations

Versioned migration system for config/data format changes:

```
src/migrations/
├── v001_xdg_linux.rs              # Move config to XDG dirs
├── v002_seed_sandbox_from_volumes.rs  # Migrate sandbox config
├── v003_yolo_mode_config.rs       # Add yolo mode settings
└── v004_unified_environment.rs    # Unify env across agents
```

### 10. Per-Repo Config with Hooks

`.aoe/config.toml` in each repo for project-specific settings:
- Pre/post session creation hooks
- Default sandbox image
- Agent preferences

## Code Snippets Worth Borrowing

- **`src/containers/container_interface.rs`** — Container runtime trait (Docker/Podman abstraction).
- **`src/tui/status_poller.rs`** — Background status polling with mpsc channels.
- **`src/containers/docker.rs`** — Docker container lifecycle management.
- **`src/tui/home/mod.rs`** — Agent+Terminal dual view with preview cache.
- **`src/tui/creation_poller.rs`** — Async operation progress tracking.
- **`src/session/config.rs`** — TOML config with profiles and sort order.

## Relevance to Lumi TUI

| Feature | Relevance |
|---------|-----------|
| Status poller pattern | **High** — Must-have for non-blocking status updates |
| Container runtime trait | **High** — If we add Docker sandboxing |
| Git worktree auto-management | **High** — Core to our workflow (via lumi-ops CLI) |
| Dual view (agent + terminal) | **High** — Great UX for monitoring agents |
| Creation/deletion pollers | **Medium** — Async operation tracking |
| Multi-agent detection | **Medium** — We need to detect which agent is running |
| Per-repo config | **Medium** — We have `.prompts/` and `.lumi/` equivalent |
| Profile system | **Low** — Not needed for our initial version |

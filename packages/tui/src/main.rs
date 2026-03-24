use std::io;
use std::time::Duration;

use anyhow::Result;
use crossterm::{
    event::{self, DisableMouseCapture, EnableMouseCapture, Event},
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use ratatui::{backend::CrosstermBackend, Terminal};
use tokio::sync::mpsc;
use tokio::task::JoinHandle;

mod app;
mod cli;
mod protocol;
mod tmux;
mod ui;

use app::{Action, AppState, StateUpdate};

/// Detect which AI agent CLI is available on the system.
/// Tries `gemini` first, then `claude`.
async fn detect_agent_cli() -> Option<String> {
    // Try gemini first
    if tokio::process::Command::new("gemini")
        .arg("--version")
        .output()
        .await
        .map(|o| o.status.success())
        .unwrap_or(false)
    {
        return Some("gemini".to_string());
    }

    // Try claude
    if tokio::process::Command::new("claude")
        .arg("--version")
        .output()
        .await
        .map(|o| o.status.success())
        .unwrap_or(false)
    {
        return Some("claude".to_string());
    }

    None
}

#[tokio::main]
async fn main() -> Result<()> {
    // Setup logging to file (avoid polluting TUI)
    let log_file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open("/tmp/lumi-tui.log")
        .ok();

    if let Some(file) = log_file {
        tracing_subscriber::fmt()
            .with_env_filter(
                tracing_subscriber::EnvFilter::from_default_env()
                    .add_directive("lumi_tui=debug".parse().unwrap()),
            )
            .with_writer(std::sync::Arc::new(file))
            .init();
    }

    tracing::info!("=== Lumi-TUI starting ===");

    // Setup terminal
    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen, EnableMouseCapture)?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;

    // Create app state
    let mut app = AppState::new();

    // Load repos from global registry on startup
    app.load_repos();
    tracing::info!(count = app.repos.len(), "Loaded repos from registry");

    // Load initial clones if we have a repo selected
    if app.current_repo_root.is_some() {
        app.load_clones();
        tracing::info!(count = app.clones.len(), "Loaded initial clones");
    }

    // Channel for background updates
    let (tx, mut rx) = mpsc::channel::<StateUpdate>(32);

    // Start metadata poller if we have a repo
    let mut metadata_poller: Option<JoinHandle<()>> = None;
    let mut terminal_poller: Option<JoinHandle<()>> = None;

    if let Some(repo_root) = &app.current_repo_root {
        metadata_poller = Some(app::poller::spawn_metadata_poller(
            tx.clone(),
            repo_root.clone(),
        ));
        tracing::info!("Started metadata poller");
    }

    // Auto-spawn an agent (gemini or claude) in a tmux session
    let session_name = "lumi-tui-agent".to_string();
    let cwd = std::env::current_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| ".".to_string());

    // Detect which agent CLI is available
    let agent_cmd = detect_agent_cli().await;

    if let Some(cmd) = &agent_cmd {
        tracing::info!(agent = %cmd, cwd = %cwd, "Spawning agent in tmux session");
        let session = tmux::TmuxSession::new(&session_name);

        // Kill any leftover session from a previous run
        let _ = session.kill().await;

        // Create a new tmux session and run the agent
        match session.create(&cwd, cmd).await {
            Ok(()) => {
                app.active_tmux_session = Some(session_name.clone());

                // Wait a moment for the agent to start, then capture initial output
                tokio::time::sleep(Duration::from_millis(500)).await;
                if let Ok(content) = session.capture_pane(500).await {
                    app.terminal_content = content;
                }

                // Start polling
                terminal_poller = Some(app::poller::spawn_terminal_poller(
                    tx.clone(),
                    session_name.clone(),
                    "tui-agent".to_string(),
                ));
                tracing::info!("Agent tmux session started and poller running");
            }
            Err(e) => {
                tracing::error!("Failed to spawn agent: {}", e);
            }
        }
    } else {
        tracing::warn!("No agent CLI found (tried: gemini, claude). Terminal panel will be empty.");
    }

    // Main event loop
    let result = loop {
        // Draw UI
        terminal.draw(|frame| {
            ui::render(frame, &mut app);
        })?;

        // Poll for keyboard events (100ms timeout for responsive UI)
        if event::poll(Duration::from_millis(100))? {
            if let Event::Key(key) = event::read()? {
                match app.handle_key(key) {
                    Action::Quit => break Ok(()),
                    Action::Up | Action::Down => {
                        // Restart metadata poller if repo changed while navigating Projects panel.
                        // Note: terminal_poller is NOT aborted — the agent session is independent.
                        if app.focused == app::FocusedPanel::Projects {
                            if let Some(handle) = metadata_poller.take() {
                                handle.abort();
                            }

                            if let Some(repo_root) = app.current_repo_root.clone() {
                                app.load_clones();
                                metadata_poller =
                                    Some(app::poller::spawn_metadata_poller(
                                        tx.clone(),
                                        repo_root,
                                    ));
                            }
                        }
                    }
                    Action::None | Action::CycleFocus | Action::JumpToPanel(_) => {}
                    Action::AttachAgent => {
                        if let Some(ref session_name) = app.active_tmux_session {
                            // 1. Suspend TUI — restore normal terminal
                            disable_raw_mode()?;
                            execute!(
                                terminal.backend_mut(),
                                LeaveAlternateScreen,
                                DisableMouseCapture
                            )?;
                            terminal.show_cursor()?;

                            // 2. Run tmux attach (blocking — user has full control)
                            let attach_status = std::process::Command::new("tmux")
                                .args(["attach-session", "-t", session_name])
                                .status();

                            tracing::info!(?attach_status, "tmux attach returned");

                            // 3. Restore TUI
                            enable_raw_mode()?;
                            execute!(
                                terminal.backend_mut(),
                                EnterAlternateScreen,
                                EnableMouseCapture
                            )?;

                            // Force full redraw
                            terminal.clear()?;
                        }
                    }
                    action => {
                        tracing::debug!(?action, "Unhandled action");
                    }
                }
            }
        }

        // Drain background updates
        while let Ok(update) = rx.try_recv() {
            app.apply_update(update);
        }
    };

    // Abort pollers on shutdown
    if let Some(handle) = metadata_poller.take() {
        handle.abort();
    }
    if let Some(handle) = terminal_poller.take() {
        handle.abort();
    }

    // Kill the agent tmux session we spawned
    if let Some(ref session_name) = app.active_tmux_session {
        tracing::info!(session = %session_name, "Killing agent tmux session");
        let session = tmux::TmuxSession::new(session_name.clone());
        let _ = session.kill().await;
    }

    // Cleanup terminal
    disable_raw_mode()?;
    execute!(
        terminal.backend_mut(),
        LeaveAlternateScreen,
        DisableMouseCapture
    )?;
    terminal.show_cursor()?;

    tracing::info!("=== Lumi-TUI shutdown ===");
    result
}

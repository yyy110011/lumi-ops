use std::io;
use std::sync::Arc;
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
#[allow(dead_code)]
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

    if let Some(repo_root) = &app.current_repo_root {
        metadata_poller = Some(app::poller::spawn_metadata_poller(
            tx.clone(),
            repo_root.clone(),
        ));
        tracing::info!("Started metadata poller");
    }

    // --- Spawn agent on embedded PTY ---
    let cwd = std::env::current_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| ".".to_string());

    // Detect which agent CLI is available
    let agent_cmd = detect_agent_cli().await;
    let mut _pty_reader_handle: Option<std::thread::JoinHandle<()>> = None;

    if let Some(cmd) = &agent_cmd {
        tracing::info!(agent = %cmd, cwd = %cwd, "Spawning agent on embedded PTY");

        // Estimate terminal size for the right panel (~40% of terminal width)
        let term_size = crossterm::terminal::size().unwrap_or((120, 40));
        let pty_cols = (term_size.0 as f32 * 0.4) as u16;
        let pty_rows = term_size.1.saturating_sub(4);

        match app::pty::PtyManager::spawn(cmd, &[], &cwd, pty_rows, pty_cols) {
            Ok((pty_mgr, reader_handle)) => {
                let parser = Arc::clone(pty_mgr.parser());
                app.pty_parser = Some(parser);
                app.pty_manager = Some(pty_mgr);
                _pty_reader_handle = Some(reader_handle);
                tracing::info!("Agent PTY spawned successfully");
            }
            Err(e) => {
                tracing::error!("Failed to spawn agent PTY: {}", e);
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

    // Abort metadata poller on shutdown
    if let Some(handle) = metadata_poller.take() {
        handle.abort();
    }

    // PTY cleanup: drop the PtyManager to close the PTY fd,
    // which will cause the reader thread to exit on EOF.
    drop(app.pty_manager.take());
    drop(app.pty_parser.take());

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

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
    #[allow(unused_mut)]
    let mut terminal_poller: Option<JoinHandle<()>> = None;

    if let Some(repo_root) = &app.current_repo_root {
        metadata_poller = Some(app::poller::spawn_metadata_poller(
            tx.clone(),
            repo_root.clone(),
        ));
        tracing::info!("Started metadata poller");
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
                        // Restart pollers if repo changed while navigating Projects panel.
                        if app.focused == app::FocusedPanel::Projects {
                            if let Some(handle) = metadata_poller.take() {
                                handle.abort();
                            }
                            if let Some(handle) = terminal_poller.take() {
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

    // Abort pollers on shutdown
    if let Some(handle) = metadata_poller.take() {
        handle.abort();
    }
    if let Some(handle) = terminal_poller.take() {
        handle.abort();
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

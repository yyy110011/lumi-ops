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
#[allow(dead_code)]
mod tmux;
mod ui;

use app::{Action, AppState, FocusedPanel, StateUpdate};

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

    // Create app state (loads config via TuiConfig::load() in AppState::new())
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
                        if app.focused == FocusedPanel::Projects {
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
                    Action::LaunchAgent => {
                        if let Some(clone) = app.selected_clone_ref() {
                            let worktree = clone.path.clone();
                            let branch = clone.branch.clone();
                            let (cmd, args) = app.config.build_agent_command(&worktree);
                            let args_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
                            let term_size = crossterm::terminal::size().unwrap_or((120, 40));
                            let pty_cols = (term_size.0 as f32 * 0.4) as u16;
                            let pty_rows = term_size.1.saturating_sub(4);
                            let driver = if app.config.agent.default_driver == "claude" {
                                app::pty_pool::DriverName::Claude
                            } else {
                                app::pty_pool::DriverName::Gemini
                            };
                            match app.pty_pool.spawn(&branch, &worktree, driver, &cmd, &args_refs, pty_rows, pty_cols) {
                                Ok(_) => {
                                    app.focused = FocusedPanel::Terminal;
                                    app.file_tabs.refresh(&worktree);
                                    tracing::info!(branch = %branch, "Agent launched");
                                }
                                Err(e) => tracing::error!("Failed to launch agent: {}", e),
                            }
                        }
                    }
                    Action::KillAgent => {
                        let idx = app.pty_pool.selected_index();
                        if !app.pty_pool.is_empty() {
                            if let Err(e) = app.pty_pool.kill(idx) {
                                tracing::error!("Failed to kill agent: {}", e);
                            }
                        }
                    }
                    Action::AttachAgent => {
                        // Selection already handled by navigate_down/up in AgentList
                        app.focused = FocusedPanel::Terminal;
                    }
                    Action::NextFileTab => {
                        app.file_tabs.next_tab();
                    }
                    Action::PrevFileTab => {
                        app.file_tabs.prev_tab();
                    }
                    Action::ToggleSettings => {
                        tracing::debug!("Settings toggle requested (not yet implemented)");
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

        // --- Status detection tick ---
        // Run on every tick for the selected agent.
        if let Some(agent) = app.pty_pool.selected_agent() {
            let text = agent.parser.lock()
                .map(|p| p.screen().contents())
                .unwrap_or_default();
            let driver = agent.driver;
            let new_status = app::status_detector::detect_status(&text, driver);
            // Update status (need mutable access)
            if let Some(agent_mut) = app.pty_pool.selected_agent_mut() {
                agent_mut.status = new_status;
            }
        }
    };

    // Abort metadata poller on shutdown
    if let Some(handle) = metadata_poller.take() {
        handle.abort();
    }

    // PtyPool is dropped when `app` goes out of scope — handles cleanup automatically.
    // No need for explicit PTY cleanup.

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

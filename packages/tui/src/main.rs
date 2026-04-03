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
use app::pty_pool::DriverName;

// ---------------------------------------------------------------------------
// CLI agent detection
// ---------------------------------------------------------------------------

/// Result of detecting available CLI agents on the system.
#[derive(Debug)]
enum AvailableAgent {
    /// Only one agent found — auto-spawn it.
    Single(DriverName),
    /// Both gemini and claude are available — need user selection.
    Both,
    /// Neither is available.
    Neither,
}

/// Check which CLI agents are available using `which`.
fn detect_agents() -> AvailableAgent {
    let has_gemini = std::process::Command::new("which")
        .arg("gemini")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false);

    let has_claude = std::process::Command::new("which")
        .arg("claude")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false);

    match (has_gemini, has_claude) {
        (true, true) => AvailableAgent::Both,
        (true, false) => AvailableAgent::Single(DriverName::Gemini),
        (false, true) => AvailableAgent::Single(DriverName::Claude),
        (false, false) => AvailableAgent::Neither,
    }
}

/// Spawn the home PTY with the given driver.
fn spawn_home_agent(app: &mut AppState, driver: DriverName) {
    let cwd = std::env::current_dir()
        .unwrap_or_else(|_| std::path::PathBuf::from("."))
        .to_string_lossy()
        .to_string();

    let cmd = match driver {
        DriverName::Gemini => "gemini",
        DriverName::Claude => "claude",
    };

    let term_size = crossterm::terminal::size().unwrap_or((120, 40));
    let pty_cols = (term_size.0 as f32 * 0.4) as u16;
    let pty_rows = term_size.1.saturating_sub(4);

    match app.pty_pool.spawn_home(driver, cmd, &[], &cwd, pty_rows, pty_cols) {
        Ok(()) => {
            tracing::info!(driver = ?driver, cwd = %cwd, "Home agent spawned");
        }
        Err(e) => {
            tracing::error!(error = %e, "Failed to spawn home agent");
        }
    }
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

    // --- Detect & spawn home CLI agent ---
    let available = detect_agents();
    tracing::info!(detected = ?available, "CLI agent detection");

    // Track whether we need deferred selection (both agents available)
    match available {
        AvailableAgent::Single(driver) => {
            // Only one agent available — spawn immediately
            spawn_home_agent(&mut app, driver);
        }
        AvailableAgent::Both => {
            // Both available — defer selection until user focuses Terminal
            app.needs_agent_selection = true;
        }
        AvailableAgent::Neither => {
            tracing::warn!("No CLI agent (gemini/claude) found on system");
        }
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


    // Track repo root for change detection
    let mut prev_repo_root = app.current_repo_root.clone();

    // Main event loop
    let result = loop {
        // Draw UI
        terminal.draw(|frame| {
            ui::render(frame, &mut app);
        })?;

        // Poll for keyboard events (100ms timeout for responsive UI)
        if event::poll(Duration::from_millis(100))? {
            if let Event::Key(key) = event::read()? {
                // --- Deferred agent selection (both agents available) ---
                // When the user first focuses the Terminal panel and we need selection,
                // show a simple inline prompt. We handle '1' for gemini and '2' for claude.
                if app.needs_agent_selection && app.focused == FocusedPanel::Terminal {
                    match key.code {
                        crossterm::event::KeyCode::Char('1') => {
                            spawn_home_agent(&mut app, DriverName::Gemini);
                            app.needs_agent_selection = false;
                            continue;
                        }
                        crossterm::event::KeyCode::Char('2') => {
                            spawn_home_agent(&mut app, DriverName::Claude);
                            app.needs_agent_selection = false;
                            continue;
                        }
                        // Tab/Esc/number keys still navigate away from Terminal
                        crossterm::event::KeyCode::Tab
                        | crossterm::event::KeyCode::Esc => {
                            // Let normal key handling process these
                        }
                        _ => {
                            // Ignore other keys while selection is pending
                            continue;
                        }
                    }
                }

                match app.handle_key(key) {
                    Action::Quit => break Ok(()),
                    Action::Up | Action::Down => {
                        // Only reload clones + restart poller if the repo actually changed
                        if app.focused == FocusedPanel::Projects {
                            let new_root = app.current_repo_root.clone();
                            if new_root != prev_repo_root {
                                prev_repo_root = new_root;
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
                                DriverName::Claude
                            } else {
                                DriverName::Gemini
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
                            // Capture worktree path before killing (agent is removed from pool)
                            let worktree = app.pty_pool.agents().get(idx)
                                .map(|a| a.worktree_path.clone());
                            if let Err(e) = app.pty_pool.kill(idx) {
                                tracing::error!("Failed to kill agent: {}", e);
                            }
                            // Remove status file after successful kill
                            if let Some(wt) = worktree {
                                app::agent_status_file::remove_status(&wt);
                            }
                        }
                    }
                    Action::AttachAgent => {
                        // Selection + attach_clone already handled in handle_key
                        app.focused = FocusedPanel::Terminal;
                    }
                    Action::DetachToHome => {
                        // detach_to_home already called in handle_key
                        // Terminal stays focused, just showing home now
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
        // Run on every tick for the selected clone agent (skip home — it's interactive).
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

        // --- Write status files for all clone agents ---
        for agent in app.pty_pool.agents() {
            app::agent_status_file::write_status(
                &agent.worktree_path,
                agent.status,
                agent.driver,
            );
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

// =============================================================================
// Event Loop — Terminal Setup, Teardown, and Event Handling (ratatui 0.29)
// =============================================================================
//
// Source: ratatui examples + Grove patterns (MIT)
// Two patterns shown:
//   1. Sync event loop (simpler, good for Phase 1)
//   2. Async event loop with tokio (required for background polling)

use std::io;
use std::time::Duration;

use crossterm::event::{self, Event, KeyCode, KeyEvent, KeyModifiers};
use crossterm::execute;
use crossterm::terminal::{
    disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen,
};
use ratatui::backend::CrosstermBackend;
use ratatui::Terminal;

// ---------------------------------------------------------------------------
// Pattern 1: Synchronous event loop (ratatui 0.29 simplified API)
// ---------------------------------------------------------------------------
// ratatui 0.29 provides `ratatui::run()` which handles terminal setup/teardown
// automatically. This is the simplest approach.

fn sync_simple() -> color_eyre::Result<()> {
    color_eyre::install()?;

    let mut app = App::default();

    // ratatui::run handles:
    //   enable_raw_mode + EnterAlternateScreen (before)
    //   disable_raw_mode + LeaveAlternateScreen (after, even on panic)
    ratatui::run(|terminal| {
        loop {
            terminal.draw(|frame| {
                // Render UI here
                frame.render_widget(ratatui::widgets::Paragraph::new("Hello"), frame.area());
            })?;

            // Blocking read with optional timeout via poll()
            if let Some(key) = event::read()?.as_key_press_event() {
                match key.code {
                    KeyCode::Char('q') => return Ok(()),
                    KeyCode::Char('j') | KeyCode::Down => { /* next item */ }
                    KeyCode::Char('k') | KeyCode::Up => { /* prev item */ }
                    KeyCode::Tab => { /* cycle panel focus */ }
                    _ => {}
                }
            }
        }
    })
}

// ---------------------------------------------------------------------------
// Pattern 2: Manual terminal setup/teardown (more control)
// ---------------------------------------------------------------------------
fn manual_terminal_setup() -> io::Result<()> {
    // Setup
    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen)?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;

    // Run application
    let result = run_app(&mut terminal);

    // Teardown (always runs, even on error)
    disable_raw_mode()?;
    execute!(terminal.backend_mut(), LeaveAlternateScreen)?;
    terminal.show_cursor()?;

    result
}

fn run_app(terminal: &mut Terminal<CrosstermBackend<io::Stdout>>) -> io::Result<()> {
    loop {
        terminal.draw(|frame| {
            // render...
        })?;

        if event::poll(Duration::from_millis(250))? {
            if let Event::Key(key) = event::read()? {
                if key.code == KeyCode::Char('q') {
                    return Ok(());
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Pattern 3: Async event loop with tokio (Grove-style, for lumi-tui)
// ---------------------------------------------------------------------------
// This pattern allows background tasks (polling metadata, capturing tmux)
// to run concurrently with the UI event loop.

use tokio::sync::mpsc;
// use tokio::time;

/// Messages from background tasks to the UI
enum AppUpdate {
    MetadataRefresh(Vec<CloneInfo>),
    AgentOutput(String, Vec<u8>), // (branch, ansi_bytes)
    Tick,                          // periodic refresh signal
}

struct CloneInfo {
    branch: String,
    status: String,
}

#[tokio::main]
async fn main_async() -> color_eyre::Result<()> {
    color_eyre::install()?;

    // 1. Setup terminal
    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen)?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;

    // 2. Create app state
    let mut app = App::default();

    // 3. Create channel for background → UI communication
    let (tx, mut rx) = mpsc::channel::<AppUpdate>(32);

    // 4. Spawn background poller — reads .lumi-metadata.json every 2s
    let tx_meta = tx.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(2));
        loop {
            interval.tick().await;
            // In real code: read metadata file and parse
            let clones = vec![]; // placeholder
            let _ = tx_meta.send(AppUpdate::MetadataRefresh(clones)).await;
        }
    });

    // 5. Spawn tick timer for UI refresh
    let tx_tick = tx.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_millis(250));
        loop {
            interval.tick().await;
            let _ = tx_tick.send(AppUpdate::Tick).await;
        }
    });

    // 6. Main event loop
    loop {
        // Draw
        terminal.draw(|frame| {
            // ui::render(frame, &app);
        })?;

        // Check for keyboard events (non-blocking with short timeout)
        if event::poll(Duration::from_millis(50))? {
            if let Event::Key(key) = event::read()? {
                match app.handle_key(key) {
                    Action::Quit => break,
                    Action::None => {}
                    // other actions...
                    _ => {}
                }
            }
        }

        // Drain background updates (non-blocking)
        while let Ok(update) = rx.try_recv() {
            match update {
                AppUpdate::MetadataRefresh(clones) => {
                    // app.update_clones(clones);
                }
                AppUpdate::AgentOutput(branch, bytes) => {
                    // app.update_terminal(branch, bytes);
                }
                AppUpdate::Tick => {
                    // periodic UI refresh
                }
            }
        }
    }

    // 7. Cleanup
    disable_raw_mode()?;
    execute!(terminal.backend_mut(), LeaveAlternateScreen)?;
    terminal.show_cursor()?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Pattern 4: Action dispatch (keybinding → mutation)
// ---------------------------------------------------------------------------
enum Action {
    Quit,
    None,
    CyclePanelFocus,
    JumpToPanel(usize),
    SpawnClone,
    AttachTmux,
    StopAgent,
    ReviewClone,
    DiffClone,
    MergeClone,
    KillClone,
    FuzzySearch,
    ShowHelp,
    ScrollUp,
    ScrollDown,
    SelectNext,
    SelectPrevious,
}

#[derive(Default)]
struct App {
    // fields...
}

impl App {
    fn handle_key(&mut self, key: KeyEvent) -> Action {
        // Global shortcuts (not in text input mode)
        match key.code {
            KeyCode::Char('q') => Action::Quit,
            KeyCode::Tab => Action::CyclePanelFocus,
            KeyCode::Char('1') => Action::JumpToPanel(0),
            KeyCode::Char('2') => Action::JumpToPanel(1),
            KeyCode::Char('3') => Action::JumpToPanel(2),
            KeyCode::Char('4') => Action::JumpToPanel(3),
            KeyCode::Char('n') => Action::SpawnClone,
            KeyCode::Char('a') => Action::AttachTmux,
            KeyCode::Char('s') => Action::StopAgent,
            KeyCode::Char('r') => Action::ReviewClone,
            KeyCode::Char('d') => Action::DiffClone,
            KeyCode::Char('m') => Action::MergeClone,
            KeyCode::Char('k') => Action::KillClone,
            KeyCode::Char('/') => Action::FuzzySearch,
            KeyCode::Char('?') => Action::ShowHelp,
            KeyCode::Char('j') | KeyCode::Down => Action::SelectNext,
            KeyCode::Char('k') | KeyCode::Up => Action::SelectPrevious,
            _ => Action::None,
        }
    }
}

// ---------------------------------------------------------------------------
// Pattern 5: Input mode switching (Normal vs Text Input)
// ---------------------------------------------------------------------------
#[derive(Default, PartialEq)]
enum InputMode {
    #[default]
    Normal,  // keyboard shortcuts active
    TextInput, // typing into text area
}

// When InputMode::TextInput, forward all key events to tui-textarea.
// When InputMode::Normal, handle global shortcuts.
// Toggle with Enter (to focus input) and Esc (to unfocus).

// ---------------------------------------------------------------------------
// Pattern 6: Modifier key handling
// ---------------------------------------------------------------------------
fn handle_with_modifiers(key: KeyEvent) {
    let shift = key.modifiers.contains(KeyModifiers::SHIFT);
    let ctrl = key.modifiers.contains(KeyModifiers::CONTROL);
    let alt = key.modifiers.contains(KeyModifiers::ALT);

    match (key.code, ctrl, shift) {
        (KeyCode::Char('c'), true, _) => { /* Ctrl+C: quit */ }
        (KeyCode::Char('r'), true, _) => { /* Ctrl+R: force refresh */ }
        (KeyCode::Right, _, true) => { /* Shift+Right: resize panel */ }
        _ => {}
    }
}

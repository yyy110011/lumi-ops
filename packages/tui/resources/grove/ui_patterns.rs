// ============================================================================
// Grove UI Patterns — Extracted Layout, Rendering, and Keybinding Samples
// Source: ZiiMs/Grove (MIT License)
//
// ADAPTATION NOTES FOR LUMI-TUI:
// - Grove uses a single-panel layout (agent list + preview below).
//   Lumi-TUI uses a 4-panel layout (projects | file viewer / agent table | terminal)
// - Grove's AppWidget pattern (struct with render method) is directly reusable.
// - Keybind matching helper is portable as-is.
// ============================================================================

// ── Terminal Setup (from main.rs) ───────────────────────────────────────────

use std::io;
use anyhow::Result;
use crossterm::{
    event::{
        self, poll, DisableBracketedPaste, DisableMouseCapture,
        EnableBracketedPaste, EnableMouseCapture, Event, KeyCode, KeyModifiers,
    },
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use ratatui::{backend::CrosstermBackend, Terminal};

/// Terminal setup pattern — enter raw mode, alternate screen, mouse capture.
/// Must be paired with cleanup on exit (including panics!).
fn setup_terminal() -> Result<Terminal<CrosstermBackend<io::Stdout>>> {
    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(
        stdout,
        EnterAlternateScreen,
        EnableMouseCapture,
        EnableBracketedPaste
    )?;
    let backend = CrosstermBackend::new(stdout);
    Terminal::new(backend).map_err(Into::into)
}

fn cleanup_terminal(terminal: &mut Terminal<CrosstermBackend<io::Stdout>>) -> Result<()> {
    disable_raw_mode()?;
    execute!(
        terminal.backend_mut(),
        LeaveAlternateScreen,
        DisableMouseCapture,
        DisableBracketedPaste
    )?;
    terminal.show_cursor()?;
    Ok(())
}

// ── Main Event Loop Pattern (from main.rs) ──────────────────────────────────

use std::time::Duration;
use tokio::sync::mpsc;

/// The main event loop pattern from Grove.
/// Key architecture decisions:
/// 1. `mpsc::unbounded_channel` for Action dispatch (not bounded — avoids backpressure)
/// 2. `watch::channel` for sharing state with background tasks (agent list, selected agent)
/// 3. Short poll timeout (50ms) for responsive UI
/// 4. Separate tick interval (100ms) for animations and periodic updates
async fn main_event_loop() -> Result<()> {
    let mut terminal = setup_terminal()?;
    let (action_tx, mut action_rx) = mpsc::unbounded_channel::<Action>();

    // Spawn background pollers
    let poll_tx = action_tx.clone();
    tokio::spawn(async move {
        // poll_agents(poll_tx).await;  // 2-second interval
    });

    let poll_timeout = Duration::from_millis(50);
    let tick_interval = Duration::from_millis(100);
    let mut last_tick = std::time::Instant::now();

    let mut app = AppState::default();

    loop {
        // 1. Draw
        terminal.draw(|f| {
            // ui::render(f, &app);
        })?;

        // 2. Poll keyboard events
        if poll(poll_timeout)? {
            if let Event::Key(key) = event::read()? {
                // Dispatch key to action
                // let action = app.handle_key(key);
                // action_tx.send(action);
            }
        }

        // 3. Process background actions
        while let Ok(action) = action_rx.try_recv() {
            // app.apply(action);
        }

        // 4. Periodic tick
        if last_tick.elapsed() >= tick_interval {
            action_tx.send(Action::Tick).ok();
            last_tick = std::time::Instant::now();
        }
    }

    cleanup_terminal(&mut terminal)?;
    Ok(())
}

// ── Layout Pattern (from ui/app.rs) ─────────────────────────────────────────

use ratatui::{
    layout::{Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Paragraph},
    Frame,
};

/// Grove's AppWidget pattern: a struct that holds a reference to state,
/// with a `render()` method that draws everything.
///
/// For Lumi-TUI, adapt to 4-panel layout:
/// ```
/// ┌──────────┬──────────────────┬───────────────────┐
/// │ Projects │  File Viewer     │  Agent Terminal    │
/// │  (~20%)  ├──────────────────┤  (~40%)            │
/// │          │  Agent Table     │                    │
/// │          │  (~60% height)   │  [Input at bottom] │
/// ├──────────┴──────────────────┴───────────────────┤
/// │ Status Bar                                       │
/// └──────────────────────────────────────────────────┘
/// ```
pub struct AppWidget<'a> {
    state: &'a AppState,
}

impl<'a> AppWidget<'a> {
    pub fn render(self, frame: &mut Frame) {
        let size = frame.area();

        // Main horizontal split: left panel (20%) | center (40%) | right (40%)
        let main_chunks = Layout::default()
            .direction(Direction::Horizontal)
            .constraints([
                Constraint::Percentage(20),
                Constraint::Percentage(40),
                Constraint::Percentage(40),
            ])
            .split(Rect {
                x: size.x,
                y: size.y,
                width: size.width,
                height: size.height.saturating_sub(1), // Reserve 1 row for status bar
            });

        // Center vertical split: file viewer (40%) | agent table (60%)
        let center_chunks = Layout::default()
            .direction(Direction::Vertical)
            .constraints([
                Constraint::Percentage(40),
                Constraint::Percentage(60),
            ])
            .split(main_chunks[1]);

        // Render panels
        self.render_projects_panel(frame, main_chunks[0]);
        self.render_file_viewer(frame, center_chunks[0]);
        self.render_agent_table(frame, center_chunks[1]);
        self.render_terminal_panel(frame, main_chunks[2]);

        // Status bar at bottom
        let status_bar = Rect {
            x: size.x,
            y: size.y + size.height.saturating_sub(1),
            width: size.width,
            height: 1,
        };
        self.render_status_bar(frame, status_bar);
    }

    fn render_projects_panel(&self, frame: &mut Frame, area: Rect) {
        let block = Block::default()
            .title(" PROJECTS ")
            .borders(Borders::ALL)
            .border_style(Style::default().fg(Color::White));
        frame.render_widget(block, area);
    }

    fn render_file_viewer(&self, frame: &mut Frame, area: Rect) {
        let block = Block::default()
            .title(" FILE VIEWER ")
            .borders(Borders::ALL)
            .border_style(Style::default().fg(Color::White));
        frame.render_widget(block, area);
    }

    fn render_agent_table(&self, frame: &mut Frame, area: Rect) {
        let block = Block::default()
            .title(" AGENTS ")
            .borders(Borders::ALL)
            .border_style(Style::default().fg(Color::White));
        frame.render_widget(block, area);
    }

    fn render_terminal_panel(&self, frame: &mut Frame, area: Rect) {
        let block = Block::default()
            .title(" TERMINAL ")
            .borders(Borders::ALL)
            .border_style(Style::default().fg(Color::White));
        frame.render_widget(block, area);
    }

    fn render_status_bar(&self, frame: &mut Frame, area: Rect) {
        let spans = vec![
            Span::styled(" [q]", Style::default().fg(Color::Yellow)),
            Span::raw("uit "),
            Span::styled("[n]", Style::default().fg(Color::Yellow)),
            Span::raw("ew "),
            Span::styled("[a]", Style::default().fg(Color::Yellow)),
            Span::raw("ttach "),
            Span::styled("[s]", Style::default().fg(Color::Yellow)),
            Span::raw("top "),
            Span::styled("[r]", Style::default().fg(Color::Yellow)),
            Span::raw("eview "),
            Span::styled("[d]", Style::default().fg(Color::Yellow)),
            Span::raw("iff "),
            Span::styled("[m]", Style::default().fg(Color::Yellow)),
            Span::raw("erge "),
            Span::styled("[Tab]", Style::default().fg(Color::Yellow)),
            Span::raw(" focus"),
        ];
        let bar = Paragraph::new(Line::from(spans));
        frame.render_widget(bar, area);
    }
}

// ── Keybind Matching (from main.rs) ─────────────────────────────────────────

/// Matches a crossterm KeyEvent against a configured Keybind.
/// Portable utility — works directly in Lumi-TUI.
fn matches_keybind(key: crossterm::event::KeyEvent, keybind: &Keybind) -> bool {
    let has_ctrl = key.modifiers.contains(KeyModifiers::CONTROL);
    let has_shift = key.modifiers.contains(KeyModifiers::SHIFT);
    let has_alt = key.modifiers.contains(KeyModifiers::ALT);

    let expected_ctrl = keybind.modifiers.iter().any(|m| m == "Control");
    let expected_shift = keybind.modifiers.iter().any(|m| m == "Shift");
    let expected_alt = keybind.modifiers.iter().any(|m| m == "Alt");

    if has_ctrl != expected_ctrl || has_alt != expected_alt {
        return false;
    }

    let key_matches = match &keybind.key[..] {
        "Up" => key.code == KeyCode::Up,
        "Down" => key.code == KeyCode::Down,
        "Left" => key.code == KeyCode::Left,
        "Right" => key.code == KeyCode::Right,
        "Enter" => key.code == KeyCode::Enter,
        "Backspace" => key.code == KeyCode::Backspace,
        "Tab" => key.code == KeyCode::Tab,
        "Esc" => key.code == KeyCode::Esc,
        c => {
            if let Some(ch) = c.chars().next() {
                match key.code {
                    KeyCode::Char(input_ch) => {
                        if ch.is_ascii_alphabetic() {
                            let expected_ch = ch.to_ascii_lowercase();
                            let actual_ch = input_ch.to_ascii_lowercase();
                            if expected_shift {
                                expected_ch == actual_ch && has_shift
                            } else {
                                expected_ch == actual_ch && !has_shift
                            }
                        } else {
                            ch == input_ch
                        }
                    }
                    _ => false,
                }
            } else {
                false
            }
        }
    };

    key_matches
}

// ── ANSI Rendering Pattern (from Grove's terminal panel) ────────────────────

// Grove uses `ansi-to-tui` crate to render tmux capture-pane output with colors.
// Key pattern:
//
// ```rust
// use ansi_to_tui::IntoText;
//
// fn render_terminal_output(frame: &mut Frame, area: Rect, output: &str) {
//     let text = output.into_text().unwrap_or_default();
//     let paragraph = Paragraph::new(text)
//         .block(Block::default().borders(Borders::ALL).title(" TERMINAL "))
//         .scroll((scroll_offset, 0));
//     frame.render_widget(paragraph, area);
// }
// ```
//
// This preserves ANSI colors from tmux's `capture-pane -e` flag, rendering
// them as ratatui styles. Critical for showing agent output with syntax
// highlighting and colored status indicators.

// ── Centered Rect Helper (from ui/helpers.rs) ────────────────────────────────

/// Create a centered rectangle within a given area.
/// Used for modals, dialogs, and overlays.
pub fn centered_rect(percent_x: u16, percent_y: u16, area: Rect) -> Rect {
    let popup_layout = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Percentage((100 - percent_y) / 2),
            Constraint::Percentage(percent_y),
            Constraint::Percentage((100 - percent_y) / 2),
        ])
        .split(area);

    Layout::default()
        .direction(Direction::Horizontal)
        .constraints([
            Constraint::Percentage((100 - percent_x) / 2),
            Constraint::Percentage(percent_x),
            Constraint::Percentage((100 - percent_x) / 2),
        ])
        .split(popup_layout[1])[1]
}

//! User interface — 4-panel layout with status bar.
//!
//! Each panel is a separate module with its own render function.

pub mod agent_list;
pub mod file_viewer;
pub mod projects;
pub mod terminal;

use ratatui::{
    layout::{Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::Paragraph,
    Frame,
};

use crate::app::{AppState, FocusedPanel};

/// Main render function called from the event loop.
pub fn render(frame: &mut Frame, app: &mut AppState) {
    // Top-level vertical split: main area + status bar
    let outer = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Min(3),    // Main content
            Constraint::Length(1), // Status bar
        ])
        .split(frame.area());

    // Main area: Left panel (25%) | Center (50%) | Right (25%)
    let columns = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([
            Constraint::Percentage(25),
            Constraint::Percentage(50),
            Constraint::Percentage(25),
        ])
        .split(outer[0]);

    // Center column: File viewer (top 60%) | Agent list (bottom 40%)
    let center = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Percentage(60), Constraint::Percentage(40)])
        .split(columns[1]);

    // Render each panel
    projects::render_projects(frame, columns[0], app);
    file_viewer::render_file_viewer(frame, center[0], app);
    agent_list::render_agent_list(frame, center[1], app);
    terminal::render_terminal(frame, columns[2], app);
    render_status_bar(frame, outer[1], app);
}

fn render_status_bar(frame: &mut Frame, area: Rect, app: &AppState) {
    // Left: current repo name
    let repo_name = app
        .repos
        .first()
        .map(|r| r.0.as_str())
        .unwrap_or("No repo");

    // Right: clone count
    let clone_count = format!(" {} clones ", app.clones.len());

    // Center: context-aware shortcuts based on focused panel
    let shortcuts = match app.focused {
        FocusedPanel::Projects => vec![
            shortcut_span("j/k", "Navigate"),
            shortcut_span("Enter", "Select"),
            shortcut_span("h/l", "Fold"),
        ],
        FocusedPanel::FileViewer => vec![
            shortcut_span("j/k", "Scroll"),
        ],
        FocusedPanel::AgentList => vec![
            shortcut_span("j/k", "Navigate"),
            shortcut_span("r", "Review"),
            shortcut_span("d", "Diff"),
            shortcut_span("m", "Merge"),
            shortcut_span("K", "Kill"),
        ],
        FocusedPanel::Terminal => vec![
            shortcut_span("j/k", "Scroll"),
            shortcut_span("a", "Attach"),
            shortcut_span("s", "Stop"),
        ],
    };

    let mut spans: Vec<Span<'_>> = Vec::new();

    // Left section: repo name
    spans.push(Span::styled(
        format!(" {} ", repo_name),
        Style::default()
            .fg(Color::Cyan)
            .add_modifier(Modifier::BOLD),
    ));
    spans.push(Span::styled("│", Style::default().fg(Color::DarkGray)));

    // Global shortcuts
    spans.extend(vec![
        shortcut_key(" q"),
        Span::raw(" Quit "),
        shortcut_key("Tab"),
        Span::raw(" Focus "),
        shortcut_key("n"),
        Span::raw(" Spawn "),
        shortcut_key("?"),
        Span::raw(" Help"),
    ]);

    // Separator
    spans.push(Span::styled(" │ ", Style::default().fg(Color::DarkGray)));

    // Panel-specific shortcuts
    for shortcut in shortcuts {
        spans.extend(shortcut);
    }

    // Fill remaining space, then clone count on the right
    // We approximate by just appending the clone count
    spans.push(Span::styled(
        format!("  {}", clone_count),
        Style::default().fg(Color::DarkGray),
    ));

    let status = Paragraph::new(Line::from(spans))
        .style(Style::default().bg(Color::DarkGray).fg(Color::White));
    frame.render_widget(status, area);
}

/// Build a shortcut key span (highlighted).
fn shortcut_key(key: &str) -> Span<'_> {
    Span::styled(
        key,
        Style::default()
            .fg(Color::Yellow)
            .add_modifier(Modifier::BOLD),
    )
}

/// Build a [key] description pair.
fn shortcut_span<'a>(key: &'a str, desc: &'a str) -> Vec<Span<'a>> {
    vec![
        shortcut_key(key),
        Span::raw(format!(" {} ", desc)),
    ]
}

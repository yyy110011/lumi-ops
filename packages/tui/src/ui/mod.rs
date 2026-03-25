//! User interface — 4-panel layout with status bar.
//!
//! Each panel is a separate module with its own render function.

pub mod agent_list;
pub mod file_tabs;
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
            Constraint::Percentage(20),
            Constraint::Percentage(40),
            Constraint::Percentage(40),
        ])
        .split(outer[0]);

    // Center column: File viewer (top 60%) | Agent list (bottom 40%)
    let center = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Percentage(60), Constraint::Percentage(40)])
        .split(columns[1]);

    // Render each panel
    projects::render_projects(frame, columns[0], app);

    // Use tabbed file viewer instead of the legacy single-file viewer
    let file_viewer_focused = app.focused == FocusedPanel::FileViewer;
    file_tabs::render_file_tabs(frame, center[0], &app.file_tabs, file_viewer_focused);

    // Agent panel — ONLY shows running agents from PtyPool
    agent_list::render_agent_list(
        frame,
        center[1],
        app.pty_pool.agents(),
        app.pty_pool.selected_index(),
        app.focused == FocusedPanel::AgentList,
    );


    terminal::render_terminal(frame, columns[2], app);
    render_status_bar(frame, outer[1], app);
}

fn render_status_bar(frame: &mut Frame, area: Rect, app: &AppState) {
    // Split status bar into 3 sections: Left (Info), Center (Shortcuts), Right (Stats)
    let chunks = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([
            Constraint::Percentage(25), // Info
            Constraint::Percentage(50), // Shortcuts
            Constraint::Percentage(25), // Stats
        ])
        .split(area);

    // 1. Left Section: Repo & Panel
    let repo_name = app
        .repos
        .get(app.selected_repo)
        .map(|r| r.0.as_str())
        .unwrap_or("No repo");

    let (panel_label, panel_color) = match app.focused {
        FocusedPanel::Projects => (" PROJECTS ", Color::Yellow),
        FocusedPanel::FileViewer => (" FILE VIEWER ", Color::Magenta),
        FocusedPanel::AgentList => (" AGENTS ", Color::Cyan),
        FocusedPanel::Terminal => (" TERMINAL ", Color::Green),
    };

    let left_spans = vec![
        Span::styled(
            format!(" 📂 {} ", repo_name),
            Style::default().fg(Color::White).add_modifier(Modifier::BOLD),
        ),
        Span::styled(
            panel_label,
            Style::default().bg(panel_color).fg(Color::Black).add_modifier(Modifier::BOLD),
        ),
    ];
    frame.render_widget(Paragraph::new(Line::from(left_spans)).style(Style::default().bg(Color::DarkGray)), chunks[0]);

    // 2. Center Section: Context-aware shortcuts
    let mut shortcuts = vec![
        shortcut_key(" q"), Span::raw(" Quit "),
        shortcut_key("Tab"), Span::raw(" Next "),
    ];

    let panel_shortcuts = match app.focused {
        FocusedPanel::Projects => vec![
            shortcut_span("j/k", "Nav"),
            shortcut_span("Enter", "MISSION"),
            shortcut_span("a", "Launch"),
        ],
        FocusedPanel::FileViewer => vec![
            shortcut_span("j/k", "Scroll"),
            shortcut_span("←/→", "Tab"),
        ],
        FocusedPanel::AgentList => vec![
            shortcut_span("j/k", "Nav"),
            shortcut_span("Enter", "Attach"),
            shortcut_span("x", "Kill"),
            shortcut_span("r", "Review"),
        ],
        FocusedPanel::Terminal => vec![
            shortcut_span("Type", "Input"),
            shortcut_span("Esc", "Back"),
            shortcut_span("C-c", "Int"),
        ],
    };

    for shortcut in panel_shortcuts {
        shortcuts.push(Span::styled(" │ ", Style::default().fg(Color::Black)));
        shortcuts.extend(shortcut);
    }

    frame.render_widget(
        Paragraph::new(Line::from(shortcuts))
            .alignment(ratatui::layout::Alignment::Center)
            .style(Style::default().bg(Color::DarkGray)),
        chunks[1]
    );

    // 3. Right Section: Stats
    let agent_count = app.pty_pool.len();
    let clone_count = app.clones.len();
    let right_spans = vec![
        Span::styled(format!(" 🌳 {} Clones ", clone_count), Style::default().fg(Color::Gray)),
        Span::styled(format!(" 🤖 {} Agents ", agent_count), Style::default().fg(Color::Green)),
        Span::raw(" "),
    ];
    frame.render_widget(
        Paragraph::new(Line::from(right_spans))
            .alignment(ratatui::layout::Alignment::Right)
            .style(Style::default().bg(Color::DarkGray)),
        chunks[2]
    );
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

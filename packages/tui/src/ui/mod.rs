//! User interface — 4-panel layout with status bar.
//!
//! Each panel is a separate render function called from `render()`.

use ratatui::{
    layout::{Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Paragraph},
    Frame,
};

use crate::app::{AppState, FocusedPanel};

/// Main render function called from the event loop.
pub fn render(frame: &mut Frame, app: &AppState) {
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
    render_projects_panel(frame, columns[0], app);
    render_file_viewer(frame, center[0], app);
    render_agent_list(frame, center[1], app);
    render_terminal_panel(frame, columns[2], app);
    render_status_bar(frame, outer[1], app);
}

/// Helper to determine block border style based on focus.
fn panel_block(title: &str, focused: bool) -> Block<'_> {
    let style = if focused {
        Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD)
    } else {
        Style::default().fg(Color::DarkGray)
    };
    Block::default()
        .borders(Borders::ALL)
        .title(format!(" {} ", title))
        .border_style(style)
}

fn render_projects_panel(frame: &mut Frame, area: Rect, app: &AppState) {
    let focused = app.focused == FocusedPanel::Projects;
    let block = panel_block("Projects", focused);

    // TODO: Replace with tui-tree-widget in impl-ui clone
    let placeholder = Paragraph::new("No repos loaded")
        .block(block)
        .style(Style::default().fg(Color::DarkGray));
    frame.render_widget(placeholder, area);
}

fn render_file_viewer(frame: &mut Frame, area: Rect, app: &AppState) {
    let focused = app.focused == FocusedPanel::FileViewer;
    let block = panel_block("MISSION.md", focused);

    // TODO: Replace with markdown renderer in impl-ui clone
    let placeholder = Paragraph::new("Select a clone to view its mission")
        .block(block)
        .style(Style::default().fg(Color::DarkGray));
    frame.render_widget(placeholder, area);
}

fn render_agent_list(frame: &mut Frame, area: Rect, app: &AppState) {
    let focused = app.focused == FocusedPanel::AgentList;
    let block = panel_block("Agents", focused);

    // TODO: Replace with table widget in impl-ui clone
    let placeholder = Paragraph::new("No active agents")
        .block(block)
        .style(Style::default().fg(Color::DarkGray));
    frame.render_widget(placeholder, area);
}

fn render_terminal_panel(frame: &mut Frame, area: Rect, app: &AppState) {
    let focused = app.focused == FocusedPanel::Terminal;
    let block = panel_block("Terminal", focused);

    // TODO: Replace with ANSI renderer in impl-ui clone
    let placeholder = Paragraph::new("Attach to an agent to view output")
        .block(block)
        .style(Style::default().fg(Color::DarkGray));
    frame.render_widget(placeholder, area);
}

fn render_status_bar(frame: &mut Frame, area: Rect, _app: &AppState) {
    let keys = vec![
        Span::styled(" q", Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD)),
        Span::raw(" Quit  "),
        Span::styled("Tab", Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD)),
        Span::raw(" Focus  "),
        Span::styled("j/k", Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD)),
        Span::raw(" Navigate  "),
        Span::styled("n", Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD)),
        Span::raw(" Spawn  "),
        Span::styled("K", Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD)),
        Span::raw(" Kill  "),
        Span::styled("a", Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD)),
        Span::raw(" Attach  "),
        Span::styled("?", Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD)),
        Span::raw(" Help"),
    ];
    let status = Paragraph::new(Line::from(keys))
        .style(Style::default().bg(Color::DarkGray).fg(Color::White));
    frame.render_widget(status, area);
}

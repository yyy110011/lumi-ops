//! Agent list panel — table of running agents from PtyPool.
//!
//! Two render functions coexist:
//! - `render_agent_list` — new, renders `&[AgentInstance]` with real-time status icons.
//! - `render_clone_list` — legacy, renders `AppState.clones` for backwards compatibility.

use ratatui::{
    layout::{Constraint, Rect},
    style::{Color, Modifier, Style},
    text::Span,
    widgets::{Block, Borders, Cell, Paragraph, Row, Table, TableState},
    Frame,
};

use crate::app::pty_pool::{AgentInstance, AgentStatus, DriverName};
use crate::app::{AppState, FocusedPanel};
use crate::protocol::metadata::ReviewStatus;

// ---------------------------------------------------------------------------
// Helper functions (public for testing)
// ---------------------------------------------------------------------------

/// Map `AgentStatus` to a display icon.
pub fn status_icon(status: AgentStatus) -> &'static str {
    match status {
        AgentStatus::Running => "●",
        AgentStatus::AwaitingInput => "⚠",
        AgentStatus::Completed => "✓",
        AgentStatus::Error => "✗",
        AgentStatus::Idle => "○",
    }
}

/// Map `AgentStatus` to a display color.
pub fn status_color(status: AgentStatus) -> Color {
    match status {
        AgentStatus::Running => Color::Green,
        AgentStatus::AwaitingInput => Color::Yellow,
        AgentStatus::Completed => Color::Cyan,
        AgentStatus::Error => Color::Red,
        AgentStatus::Idle => Color::Gray,
    }
}

/// Map `DriverName` to a lowercase label.
pub fn driver_label(driver: DriverName) -> &'static str {
    match driver {
        DriverName::Gemini => "gemini",
        DriverName::Claude => "claude",
    }
}

/// Count agents with `Running` status.
pub fn running_count(agents: &[AgentInstance]) -> usize {
    agents.iter().filter(|a| a.status == AgentStatus::Running).count()
}

/// Map `AgentStatus` to a human-readable label.
fn status_label(status: AgentStatus) -> &'static str {
    match status {
        AgentStatus::Running => "Running",
        AgentStatus::AwaitingInput => "Waiting",
        AgentStatus::Completed => "Done",
        AgentStatus::Error => "Error",
        AgentStatus::Idle => "Idle",
    }
}

// ---------------------------------------------------------------------------
// New agent-based rendering
// ---------------------------------------------------------------------------

/// Render the agent list panel from `PtyPool` agent data.
///
/// Designed to accept data directly so it works before PtyPool is wired into AppState.
pub fn render_agent_list(
    frame: &mut Frame,
    area: Rect,
    agents: &[AgentInstance],
    selected: usize,
    focused: bool,
) {
    let border_style = if focused {
        Style::default()
            .fg(Color::Cyan)
            .add_modifier(Modifier::BOLD)
    } else {
        Style::default().fg(Color::DarkGray)
    };

    let running = running_count(agents);
    let block = Block::default()
        .borders(Borders::ALL)
        .title(format!(" 🤖 Agents ({running} running) "))
        .border_style(border_style);

    // Empty state
    if agents.is_empty() {
        let placeholder = Paragraph::new("  No agents running. Select a clone and press 'a' to launch.")
            .block(block)
            .style(Style::default().fg(Color::DarkGray));
        frame.render_widget(placeholder, area);
        return;
    }

    // Build rows
    let rows: Vec<Row> = agents
        .iter()
        .enumerate()
        .map(|(i, agent)| {
            let icon = status_icon(agent.status);
            let color = status_color(agent.status);
            let label = status_label(agent.status);
            let driver = driver_label(agent.driver);
            let marker = if i == selected { "▶ " } else { "  " };

            let mut icon_style = Style::default().fg(color);
            if agent.status == AgentStatus::AwaitingInput {
                icon_style = icon_style.add_modifier(Modifier::BOLD);
            }

            Row::new(vec![
                Cell::from(Span::styled(
                    format!("{marker}{icon}"),
                    icon_style,
                )),
                Cell::from(agent.clone_branch.clone()),
                Cell::from(driver.to_string()),
                Cell::from(Span::styled(label, Style::default().fg(color))),
            ])
        })
        .collect();

    let widths = [
        Constraint::Length(5),      // marker + icon
        Constraint::Percentage(40), // Branch
        Constraint::Percentage(20), // Driver
        Constraint::Percentage(25), // Status label
    ];

    let table = Table::new(rows, widths)
        .block(block)
        .row_highlight_style(
            Style::default()
                .bg(Color::DarkGray)
                .add_modifier(Modifier::BOLD),
        );

    let mut table_state = TableState::default().with_selected(if agents.is_empty() {
        None
    } else {
        Some(selected.min(agents.len() - 1))
    });

    frame.render_stateful_widget(table, area, &mut table_state);
}

// ---------------------------------------------------------------------------
// Legacy clone-based rendering (kept for backwards compatibility)
// ---------------------------------------------------------------------------

/// Map `ReviewStatus` to a display string with icon.
fn review_display(status: &Option<ReviewStatus>) -> (&'static str, Color) {
    match status {
        Some(ReviewStatus::Todo) => ("🟡 Todo", Color::Yellow),
        Some(ReviewStatus::InProgress) => ("🔵 Working", Color::Blue),
        Some(ReviewStatus::NeedsReview) => ("🟣 Review", Color::Magenta),
        Some(ReviewStatus::NeedsRevision) => ("🟠 Revise", Color::LightYellow),
        Some(ReviewStatus::Done) => ("✅ Done", Color::Green),
        Some(ReviewStatus::WontDo) => ("⬛ Won't Do", Color::DarkGray),
        None => ("❓ Unknown", Color::DarkGray),
    }
}

/// Render the agent list panel using clone metadata (legacy).
///
/// Renamed from the original `render_agent_list` to coexist with the
/// new agent-based rendering function.
pub fn render_clone_list(frame: &mut Frame, area: Rect, app: &AppState) {
    let focused = app.focused == FocusedPanel::AgentList;
    let border_style = if focused {
        Style::default()
            .fg(Color::Cyan)
            .add_modifier(Modifier::BOLD)
    } else {
        Style::default().fg(Color::DarkGray)
    };

    let block = Block::default()
        .borders(Borders::ALL)
        .title(format!(" 🤖 Agents ({}) ", app.clones.len()))
        .border_style(border_style);

    if app.clones.is_empty() {
        let placeholder = Paragraph::new("  No active agents")
            .block(block)
            .style(Style::default().fg(Color::DarkGray));
        frame.render_widget(placeholder, area);
        return;
    }

    // Build table header
    let header = Row::new(vec![
        Cell::from("Status").style(Style::default().add_modifier(Modifier::BOLD)),
        Cell::from("Branch").style(Style::default().add_modifier(Modifier::BOLD)),
        Cell::from("Review").style(Style::default().add_modifier(Modifier::BOLD)),
        Cell::from("Base").style(Style::default().add_modifier(Modifier::BOLD)),
    ])
    .style(
        Style::default()
            .fg(Color::White)
            .bg(Color::DarkGray),
    )
    .height(1);

    // Build table rows from clones
    let rows: Vec<Row> = app
        .clones
        .iter()
        .map(|clone| {
            let (review_text, review_color) = review_display(&clone.review_status);
            let base = clone
                .base_branch
                .as_deref()
                .unwrap_or("—");

            Row::new(vec![
                Cell::from(if clone.is_shadow { "🤖" } else { "📁" }),
                Cell::from(clone.branch.clone()),
                Cell::from(Span::styled(
                    review_text,
                    Style::default().fg(review_color),
                )),
                Cell::from(base.to_string()),
            ])
        })
        .collect();

    let widths = [
        Constraint::Length(4),      // Status icon
        Constraint::Percentage(35), // Branch
        Constraint::Percentage(30), // Review
        Constraint::Percentage(25), // Base
    ];

    let table = Table::new(rows, widths)
        .header(header)
        .block(block)
        .row_highlight_style(
            Style::default()
                .bg(Color::DarkGray)
                .add_modifier(Modifier::BOLD),
        )
        .highlight_symbol("▶ ");

    let mut table_state = TableState::default()
        .with_selected(if app.clones.is_empty() {
            None
        } else {
            Some(app.selected_clone.min(app.clones.len() - 1))
        });

    frame.render_stateful_widget(table, area, &mut table_state);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_status_icon_running() {
        assert_eq!(status_icon(AgentStatus::Running), "●");
    }

    #[test]
    fn test_status_icon_awaiting_input() {
        assert_eq!(status_icon(AgentStatus::AwaitingInput), "⚠");
    }

    #[test]
    fn test_status_icon_completed() {
        assert_eq!(status_icon(AgentStatus::Completed), "✓");
    }

    #[test]
    fn test_status_icon_error() {
        assert_eq!(status_icon(AgentStatus::Error), "✗");
    }

    #[test]
    fn test_status_icon_idle() {
        assert_eq!(status_icon(AgentStatus::Idle), "○");
    }

    #[test]
    fn test_status_color_running() {
        assert_eq!(status_color(AgentStatus::Running), Color::Green);
    }

    #[test]
    fn test_status_color_awaiting_input() {
        assert_eq!(status_color(AgentStatus::AwaitingInput), Color::Yellow);
    }

    #[test]
    fn test_status_color_completed() {
        assert_eq!(status_color(AgentStatus::Completed), Color::Cyan);
    }

    #[test]
    fn test_status_color_error() {
        assert_eq!(status_color(AgentStatus::Error), Color::Red);
    }

    #[test]
    fn test_status_color_idle() {
        assert_eq!(status_color(AgentStatus::Idle), Color::Gray);
    }

    #[test]
    fn test_driver_label_gemini() {
        assert_eq!(driver_label(DriverName::Gemini), "gemini");
    }

    #[test]
    fn test_driver_label_claude() {
        assert_eq!(driver_label(DriverName::Claude), "claude");
    }

    #[test]
    fn test_running_count_empty() {
        let agents: Vec<AgentInstance> = vec![];
        assert_eq!(running_count(&agents), 0);
    }

    #[test]
    fn test_status_label_values() {
        assert_eq!(status_label(AgentStatus::Running), "Running");
        assert_eq!(status_label(AgentStatus::AwaitingInput), "Waiting");
        assert_eq!(status_label(AgentStatus::Completed), "Done");
        assert_eq!(status_label(AgentStatus::Error), "Error");
        assert_eq!(status_label(AgentStatus::Idle), "Idle");
    }
}

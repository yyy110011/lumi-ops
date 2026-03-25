//! Agent list panel — table of running agents from PtyPool.
//!
//! Two render functions coexist:
//! - `render_agent_list` — new, renders `&[AgentInstance]` with real-time status icons.
//! - `render_clone_list` — legacy, renders `AppState.clones` for backwards compatibility.

use ratatui::{
    layout::{Constraint, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Cell, Paragraph, Row, Table, TableState},
    Frame,
};

use crate::app::pty_pool::{AgentInstance, AgentStatus, DriverName};

// ---------------------------------------------------------------------------
// Helper functions (public for testing)
// ---------------------------------------------------------------------------

/// Map `AgentStatus` to a display icon.
pub fn status_icon(status: AgentStatus) -> &'static str {
    match status {
        AgentStatus::Running => "🚀",
        AgentStatus::AwaitingInput => "💬",
        AgentStatus::Completed => "✅",
        AgentStatus::Error => "❌",
        AgentStatus::Idle => "💤",
    }
}

/// Map `AgentStatus` to a display color.
pub fn status_color(status: AgentStatus) -> Color {
    match status {
        AgentStatus::Running => Color::Green,
        AgentStatus::AwaitingInput => Color::Yellow,
        AgentStatus::Completed => Color::Cyan,
        AgentStatus::Error => Color::Red,
        AgentStatus::Idle => Color::DarkGray,
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
        AgentStatus::AwaitingInput => "Action Req",
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
        let text = vec![
            Line::default(),
            Line::from(vec![
                Span::styled("  No agents running. ", Style::default().fg(Color::DarkGray)),
            ]),
            Line::from(vec![
                Span::styled("  Select a clone and press '", Style::default().fg(Color::DarkGray)),
                Span::styled("a", Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD)),
                Span::styled("' to launch.", Style::default().fg(Color::DarkGray)),
            ]),
        ];
        let paragraph = Paragraph::new(text)
            .block(block);
        frame.render_widget(paragraph, area);
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
            let marker = if i == selected { "▶" } else { " " };

            let mut icon_style = Style::default().fg(color);
            if agent.status == AgentStatus::AwaitingInput {
                icon_style = icon_style.add_modifier(Modifier::BOLD);
            }

            Row::new(vec![
                Cell::from(Span::styled(marker, Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD))),
                Cell::from(Span::styled(icon, icon_style)),
                Cell::from(agent.clone_branch.clone()),
                Cell::from(Span::styled(driver, Style::default().fg(Color::Gray))),
                Cell::from(Span::styled(label, Style::default().fg(color).add_modifier(Modifier::BOLD))),
            ])
        })
        .collect();

    let widths = [
        Constraint::Length(1),      // marker
        Constraint::Length(3),      // icon
        Constraint::Percentage(45), // Branch
        Constraint::Percentage(20), // Driver
        Constraint::Percentage(25), // Status label
    ];

    let table = Table::new(rows, widths)
        .block(block)
        .row_highlight_style(
            Style::default()
                .bg(Color::Rgb(40, 44, 52)) // Dark grey background for selection
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
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_status_icon_running() {
        assert_eq!(status_icon(AgentStatus::Running), "🚀");
    }

    #[test]
    fn test_status_icon_awaiting_input() {
        assert_eq!(status_icon(AgentStatus::AwaitingInput), "💬");
    }

    #[test]
    fn test_status_icon_completed() {
        assert_eq!(status_icon(AgentStatus::Completed), "✅");
    }

    #[test]
    fn test_status_icon_error() {
        assert_eq!(status_icon(AgentStatus::Error), "❌");
    }

    #[test]
    fn test_status_icon_idle() {
        assert_eq!(status_icon(AgentStatus::Idle), "💤");
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
        assert_eq!(status_color(AgentStatus::Idle), Color::DarkGray);
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
        assert_eq!(status_label(AgentStatus::AwaitingInput), "Action Req");
        assert_eq!(status_label(AgentStatus::Completed), "Done");
        assert_eq!(status_label(AgentStatus::Error), "Error");
        assert_eq!(status_label(AgentStatus::Idle), "Idle");
    }
}

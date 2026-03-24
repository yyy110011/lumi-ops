//! Agent list panel — table of shadow clones with status info.
//!
//! Uses ratatui's built-in `Table` widget to display clone information
//! with columns: Status | Branch | Review | Base Branch.

use ratatui::{
    layout::{Constraint, Rect},
    style::{Color, Modifier, Style},
    text::Span,
    widgets::{Block, Borders, Cell, Paragraph, Row, Table, TableState},
    Frame,
};

use crate::app::{AppState, FocusedPanel};
use crate::protocol::metadata::ReviewStatus;

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

/// Render the agent list panel (center-bottom).
pub fn render_agent_list(frame: &mut Frame, area: Rect, app: &AppState) {
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

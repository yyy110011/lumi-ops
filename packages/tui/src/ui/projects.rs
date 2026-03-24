//! Projects panel — tree-like list view of registered repos and their shadow clones.
//!
//! Uses ratatui's built-in `List` widget to display a hierarchical tree:
//!   📂 repo-name
//!   ├── 🔵 feat/add-auth (inProgress)
//!   └── ✅ feat/dashboard (done)

use ratatui::{
    layout::Rect,
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, List, ListItem, ListState, Paragraph},
    Frame,
};

use crate::app::{AppState, FocusedPanel};
use crate::protocol::metadata::ReviewStatus;

/// Map `ReviewStatus` to a status icon.
fn status_icon(status: &Option<ReviewStatus>) -> &'static str {
    match status {
        Some(ReviewStatus::Todo) => "🟡",
        Some(ReviewStatus::InProgress) => "🔵",
        Some(ReviewStatus::NeedsReview) => "🟣",
        Some(ReviewStatus::NeedsRevision) => "🟠",
        Some(ReviewStatus::Done) => "✅",
        Some(ReviewStatus::WontDo) => "⬛",
        None => "❓",
    }
}

/// Build flat list items with tree-like indentation from app state.
fn build_tree_items(app: &AppState) -> Vec<ListItem<'static>> {
    let mut items = Vec::new();

    for (repo_idx, repo) in app.repos.iter().enumerate() {
        // Repo header
        items.push(ListItem::new(Line::from(vec![
            Span::styled("📂 ", Style::default().fg(Color::Yellow)),
            Span::styled(
                repo.name.clone(),
                Style::default()
                    .fg(Color::White)
                    .add_modifier(Modifier::BOLD),
            ),
        ])));

        // Clones for this repo
        let repo_clones: Vec<_> = app
            .clones
            .iter()
            .filter(|c| c.path.contains(&repo.name))
            .collect();

        for (i, clone) in repo_clones.iter().enumerate() {
            let icon = status_icon(&clone.review_status);
            let is_last = i == repo_clones.len() - 1;
            let connector = if is_last { "└── " } else { "├── " };

            let status_text = clone
                .review_status
                .as_ref()
                .map(|s| format!("{:?}", s))
                .unwrap_or_else(|| "unknown".to_string());

            items.push(ListItem::new(Line::from(vec![
                Span::styled(connector, Style::default().fg(Color::DarkGray)),
                Span::raw(format!("{} ", icon)),
                Span::styled(clone.branch.clone(), Style::default().fg(Color::White)),
                Span::styled(
                    format!(" ({})", status_text),
                    Style::default().fg(Color::DarkGray),
                ),
            ])));
        }

        // Blank line between repos (except last)
        if repo_idx < app.repos.len() - 1 {
            items.push(ListItem::new(Line::raw("")));
        }
    }

    items
}

/// Render the Projects panel (left).
pub fn render_projects(frame: &mut Frame, area: Rect, app: &mut AppState) {
    let focused = app.focused == FocusedPanel::Projects;
    let border_style = if focused {
        Style::default()
            .fg(Color::Cyan)
            .add_modifier(Modifier::BOLD)
    } else {
        Style::default().fg(Color::DarkGray)
    };

    let block = Block::default()
        .borders(Borders::ALL)
        .title(" 📂 Projects ")
        .border_style(border_style);

    if app.repos.is_empty() {
        let placeholder = Paragraph::new("  No repos registered")
            .block(block)
            .style(Style::default().fg(Color::DarkGray));
        frame.render_widget(placeholder, area);
        return;
    }

    let items = build_tree_items(app);
    let list = List::new(items)
        .block(block)
        .highlight_style(
            Style::default()
                .bg(Color::DarkGray)
                .add_modifier(Modifier::BOLD),
        )
        .highlight_symbol("▶ ");

    let mut list_state = ListState::default().with_selected(Some(app.tree_selected_idx));
    frame.render_stateful_widget(list, area, &mut list_state);
}

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

/// Map `ReviewStatus` to a status icon and color.
fn status_style(status: &Option<ReviewStatus>) -> (&'static str, Color) {
    match status {
        Some(ReviewStatus::Todo) => ("📋", Color::Yellow),
        Some(ReviewStatus::InProgress) => ("🔨", Color::Blue),
        Some(ReviewStatus::NeedsReview) => ("👀", Color::Magenta),
        Some(ReviewStatus::NeedsRevision) => ("🔄", Color::LightRed),
        Some(ReviewStatus::Done) => ("✅", Color::Green),
        Some(ReviewStatus::WontDo) => ("❌", Color::DarkGray),
        None => ("❓", Color::DarkGray),
    }
}

/// Build flat list items with tree-like indentation from app state.
fn build_tree_items(app: &AppState) -> Vec<ListItem<'static>> {
    let mut items = Vec::new();

    for (repo_idx, repo) in app.repos.iter().enumerate() {
        let is_selected_repo = repo_idx == app.selected_repo;

        // Repo header — show ▶/▼ fold indicator
        let fold_icon = if is_selected_repo && !app.clones.is_empty() {
            "▼ "
        } else {
            "▶ "
        };

        items.push(ListItem::new(Line::from(vec![
            Span::styled(fold_icon, Style::default().fg(Color::DarkGray)),
            Span::styled("📂 ", Style::default().fg(Color::Yellow)),
            Span::styled(
                repo.0.clone(),
                Style::default()
                    .fg(if is_selected_repo { Color::Cyan } else { Color::White })
                    .add_modifier(if is_selected_repo { Modifier::BOLD } else { Modifier::empty() }),
            ),
        ])));

        // Only show clones under the currently selected repo
        if is_selected_repo {
            for (i, clone) in app.clones.iter().enumerate() {
                let (icon, color) = status_style(&clone.review_status);
                let is_last = i == app.clones.len() - 1;
                let connector = if is_last { "  └── " } else { "  ├── " };
                let is_selected_clone = i == app.selected_clone && app.tree_selected_idx > repo_idx;

                let status_text = clone
                    .review_status
                    .as_ref()
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| "unknown".to_string());

                let mut branch_style = Style::default();
                if is_selected_clone {
                    branch_style = branch_style.fg(Color::White).add_modifier(Modifier::BOLD);
                } else {
                    branch_style = branch_style.fg(Color::Gray);
                }

                items.push(ListItem::new(Line::from(vec![
                    Span::styled(connector, Style::default().fg(Color::DarkGray)),
                    Span::styled(format!("{} ", icon), Style::default().fg(color)),
                    Span::styled(clone.branch.clone(), branch_style),
                    Span::styled(
                        format!(" ({})", status_text),
                        Style::default().fg(Color::DarkGray).add_modifier(Modifier::ITALIC),
                    ),
                ])));
            }
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

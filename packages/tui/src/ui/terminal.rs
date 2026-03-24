//! Terminal panel — ANSI output rendering from tmux capture-pane.
//!
//! Uses `ansi-to-tui` to convert raw ANSI escape sequences into
//! ratatui `Text` with colors and styles preserved.

use ansi_to_tui::IntoText;
use ratatui::{
    layout::Rect,
    style::{Color, Modifier, Style},
    widgets::{Block, Borders, Paragraph, Wrap},
    Frame,
};

use crate::app::{AppState, FocusedPanel};

/// Render the terminal output panel (right).
pub fn render_terminal(frame: &mut Frame, area: Rect, app: &AppState) {
    let focused = app.focused == FocusedPanel::Terminal;
    let border_style = if focused {
        Style::default()
            .fg(Color::Cyan)
            .add_modifier(Modifier::BOLD)
    } else {
        Style::default().fg(Color::DarkGray)
    };

    let block = Block::default()
        .borders(Borders::ALL)
        .title(" 💬 Terminal ")
        .border_style(border_style);

    if app.terminal_content.is_empty() {
        let placeholder = Paragraph::new("  Attach to an agent with 'a'")
            .block(block)
            .style(Style::default().fg(Color::DarkGray));
        frame.render_widget(placeholder, area);
        return;
    }

    // Convert ANSI bytes to ratatui Text
    let text = match app.terminal_content.as_bytes().into_text() {
        Ok(text) => text,
        Err(_) => {
            // Fallback: render as plain text if ANSI parsing fails
            let paragraph = Paragraph::new(app.terminal_content.as_str())
                .block(block)
                .wrap(Wrap { trim: false });
            frame.render_widget(paragraph, area);
            return;
        }
    };

    // Compute scroll offset — auto-scroll to bottom if enabled
    let content_height = text.lines.len() as u16;
    let visible_height = area.height.saturating_sub(2); // subtract borders
    let scroll_offset = if app.terminal_auto_scroll {
        content_height.saturating_sub(visible_height)
    } else {
        app.terminal_scroll.min(content_height.saturating_sub(visible_height))
    };

    let paragraph = Paragraph::new(text)
        .block(block)
        .wrap(Wrap { trim: false })
        .scroll((scroll_offset, 0));

    frame.render_widget(paragraph, area);
}

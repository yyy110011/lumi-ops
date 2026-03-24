//! Terminal panel — embedded PTY rendering via tui-term.
//!
//! Uses `tui-term::widget::PseudoTerminal` to render the vt100 parser's
//! screen state directly. No ANSI parsing needed — vt100 handles everything.

use ratatui::{
    layout::Rect,
    style::{Color, Modifier, Style},
    widgets::{Block, Borders, Paragraph},
    Frame,
};
use tui_term::widget::PseudoTerminal;

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

    let title = if focused {
        " 💬 Terminal (interactive) "
    } else {
        " 💬 Terminal "
    };

    let block = Block::default()
        .borders(Borders::ALL)
        .title(title)
        .border_style(border_style);

    if let Some(ref parser) = app.pty_parser {
        if let Ok(parser_guard) = parser.lock() {
            let pseudo_term = PseudoTerminal::new(parser_guard.screen())
                .block(block);
            frame.render_widget(pseudo_term, area);
        } else {
            // Parser lock poisoned — show error
            let error = Paragraph::new("  ⚠ Terminal lock error")
                .block(block)
                .style(Style::default().fg(Color::Red));
            frame.render_widget(error, area);
        }
    } else {
        let placeholder = Paragraph::new("  No agent running — install gemini or claude CLI")
            .block(block)
            .style(Style::default().fg(Color::DarkGray));
        frame.render_widget(placeholder, area);
    }
}

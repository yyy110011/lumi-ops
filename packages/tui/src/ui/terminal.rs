//! Terminal panel — embedded PTY rendering via tui-term.
//!
//! Uses `tui-term::widget::PseudoTerminal` to render the vt100 parser's
//! screen state directly. No ANSI parsing needed — vt100 handles everything.
//!
//! Renders the *active* PTY: home session by default, clone agent when attached.

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

    // Build title based on what's displayed
    let title = if app.pty_pool.is_viewing_clone() {
        // Viewing a clone agent
        if let Some(agent) = app.pty_pool.selected_agent() {
            if focused {
                format!(" 💬 Terminal [{}] (interactive) ", agent.clone_branch)
            } else {
                format!(" 💬 Terminal [{}] ", agent.clone_branch)
            }
        } else if focused {
            " 💬 Terminal (interactive) ".to_string()
        } else {
            " 💬 Terminal ".to_string()
        }
    } else if app.pty_pool.has_home() {
        // Viewing home session
        if focused {
            " 🏠 Terminal (home) (interactive) ".to_string()
        } else {
            " 🏠 Terminal (home) ".to_string()
        }
    } else if focused {
        " 💬 Terminal (interactive) ".to_string()
    } else {
        " 💬 Terminal ".to_string()
    };

    let block = Block::default()
        .borders(Borders::ALL)
        .title(title)
        .border_style(border_style);

    // Use active_parser() — returns home or clone parser depending on viewing state
    if let Some(parser) = app.pty_pool.active_parser() {
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
    } else if app.needs_agent_selection {
        // Both agents available — show selection prompt
        use ratatui::text::{Line, Span};
        let text = vec![
            Line::default(),
            Line::from(Span::styled(
                "  Select your home CLI agent:",
                Style::default().fg(Color::White).add_modifier(Modifier::BOLD),
            )),
            Line::default(),
            Line::from(vec![
                Span::styled("    1 ", Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD)),
                Span::styled("→ gemini", Style::default().fg(Color::Cyan)),
            ]),
            Line::from(vec![
                Span::styled("    2 ", Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD)),
                Span::styled("→ claude", Style::default().fg(Color::Magenta)),
            ]),
        ];
        let selection = Paragraph::new(text)
            .block(block)
            .style(Style::default());
        frame.render_widget(selection, area);
    } else {
        // No home agent and no clone agents — show placeholder
        let placeholder = Paragraph::new("  No CLI agent found — install 'gemini' or 'claude'")
            .block(block)
            .style(Style::default().fg(Color::DarkGray));
        frame.render_widget(placeholder, area);
    }
}

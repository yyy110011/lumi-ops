// =============================================================================
// ScrollView — tui-scrollview for Scrollable Log/Terminal Viewer
// =============================================================================
//
// Crate: https://docs.rs/tui-scrollview (MIT)
// Version: tui-scrollview = "0.6"
//
// Key types:
//   - ScrollView       — a virtual canvas larger than the visible area
//   - ScrollViewState  — tracks scroll offset (x, y)
//
// Use case: when you need a *virtual buffer* that's larger than the visible
// area and can contain multiple sub-widgets rendered at arbitrary positions.
// More flexible than Paragraph::scroll() for complex layouts.
//
// Cargo.toml: tui-scrollview = "0.6"

use ratatui::layout::Size;
use ratatui::prelude::*;
use ratatui::widgets::*;
use tui_scrollview::{ScrollView, ScrollViewState};

// ---------------------------------------------------------------------------
// Pattern 1: Basic scrollable log viewer
// ---------------------------------------------------------------------------
struct LogViewer {
    lines: Vec<String>,
    state: ScrollViewState,
}

impl LogViewer {
    fn new() -> Self {
        Self {
            lines: Vec::new(),
            state: ScrollViewState::default(),
        }
    }

    fn push(&mut self, line: String) {
        self.lines.push(line);
        // Auto-scroll to bottom when new lines arrive
        self.state.scroll_down();
    }
}

impl StatefulWidget for &LogViewer {
    type State = ScrollViewState;

    fn render(self, area: Rect, buf: &mut Buffer, state: &mut Self::State) {
        let content_height = self.lines.len() as u16;
        let content_width = area.width.saturating_sub(2); // account for borders

        // Create a virtual canvas that may be taller than the visible area
        let content_size = Size::new(content_width, content_height.max(area.height));
        let mut scroll_view = ScrollView::new(content_size);

        // Render line numbers on the left
        let line_numbers: String = (1..=self.lines.len())
            .map(|i| format!("{:>4} ", i))
            .collect::<Vec<_>>()
            .join("\n");
        scroll_view.render_widget(
            Paragraph::new(line_numbers).style(Style::default().fg(Color::DarkGray)),
            Rect::new(0, 0, 5, content_height),
        );

        // Render log content
        let content: String = self.lines.join("\n");
        scroll_view.render_widget(
            Paragraph::new(content),
            Rect::new(5, 0, content_width.saturating_sub(5), content_height),
        );

        // Render the scroll view into the actual buffer
        scroll_view.render(area, buf, state);
    }
}

// ---------------------------------------------------------------------------
// Pattern 2: ScrollViewState navigation
// ---------------------------------------------------------------------------
use crossterm::event::{KeyCode, KeyEvent};

fn handle_scroll_keys(key: KeyEvent, state: &mut ScrollViewState) -> bool {
    match key.code {
        KeyCode::Char('j') | KeyCode::Down => {
            state.scroll_down();
            true
        }
        KeyCode::Char('k') | KeyCode::Up => {
            state.scroll_up();
            true
        }
        KeyCode::Char('d') => {
            // Half-page down
            state.scroll_page_down();
            true
        }
        KeyCode::Char('u') => {
            // Half-page up
            state.scroll_page_up();
            true
        }
        KeyCode::Char('G') => {
            // Scroll to bottom
            state.scroll_to_bottom();
            true
        }
        KeyCode::Char('g') => {
            // Scroll to top
            state.scroll_to_top();
            true
        }
        KeyCode::Char('h') | KeyCode::Left => {
            state.scroll_left();
            true
        }
        KeyCode::Char('l') | KeyCode::Right => {
            state.scroll_right();
            true
        }
        _ => false,
    }
}

// ---------------------------------------------------------------------------
// Pattern 3: ScrollView with mixed widgets
// ---------------------------------------------------------------------------
// ScrollView can contain any widget, not just text.
// Useful for rendering a complex dashboard within a scrollable container.
fn render_mixed_scrollview(area: Rect, buf: &mut Buffer, state: &mut ScrollViewState) {
    let content_size = Size::new(100, 50); // virtual canvas
    let mut scroll_view = ScrollView::new(content_size);

    // Render a table at the top
    scroll_view.render_widget(
        Paragraph::new("== Agent Activity ==").bold(),
        Rect::new(0, 0, 100, 1),
    );

    // Render a gauge (progress bar)
    scroll_view.render_widget(
        Gauge::default()
            .ratio(0.7)
            .label("70%"),
        Rect::new(0, 2, 50, 1),
    );

    // Render text blocks at different positions
    scroll_view.render_widget(
        Paragraph::new("Some log output here..."),
        Rect::new(0, 4, 100, 10),
    );

    scroll_view.render(area, buf, state);
}

// ---------------------------------------------------------------------------
// Alternative: Paragraph::scroll() for simpler cases
// ---------------------------------------------------------------------------
// If you only need scrollable text (no mixed widgets), Paragraph::scroll()
// is simpler and doesn't require the tui-scrollview crate:
//
//   let paragraph = Paragraph::new(text)
//       .scroll((vertical_offset, horizontal_offset))
//       .wrap(Wrap { trim: false });
//
// Use tui-scrollview when:
//   - You need to compose multiple widgets in a scrollable area
//   - You need 2D scrolling with sub-widget positioning
//   - You need more control over the virtual canvas size

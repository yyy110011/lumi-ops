// =============================================================================
// Text Input — tui-textarea for Agent Communication Input Box
// =============================================================================
//
// Crate: https://github.com/rhysd/tui-textarea (MIT)
// Version: tui-textarea = "0.7"
//
// Key types:
//   - TextArea<'a>  — the widget + state combined
//   - Input          — crossterm event → tui-textarea input adapter
//   - CursorMove     — cursor movement commands
//   - Scrolling      — scroll commands (HalfPageUp, etc.)
//
// Features:
//   - Multi-line text editing with undo/redo
//   - Search (forward/backward) with regex support
//   - Vim-style keybinding example
//   - Line numbers, cursor styling, placeholder text

use crossterm::event::{self, Event, KeyCode};
use ratatui::layout::{Constraint, Layout};
use ratatui::style::{Color, Modifier, Style};
use ratatui::widgets::{Block, Borders};
use ratatui::Frame;
use tui_textarea::{CursorMove, Input, Key, TextArea};

// ---------------------------------------------------------------------------
// Pattern 1: Basic single-line input box (for agent commands)
// ---------------------------------------------------------------------------
fn create_input_box<'a>() -> TextArea<'a> {
    let mut textarea = TextArea::default();

    // Style the input area
    textarea.set_block(
        Block::default()
            .borders(Borders::ALL)
            .title(" Send to Agent "),
    );
    textarea.set_cursor_line_style(Style::default());
    textarea.set_cursor_style(
        Style::default()
            .fg(Color::LightCyan)
            .add_modifier(Modifier::REVERSED),
    );
    textarea.set_placeholder_text("Type a message...");

    textarea
}

// ---------------------------------------------------------------------------
// Pattern 2: Rendering TextArea as a widget
// ---------------------------------------------------------------------------
fn render_input(frame: &mut Frame, textarea: &TextArea) {
    let area = frame.area();

    let [_content, input_area] = area.layout(&Layout::vertical([
        Constraint::Fill(1),
        Constraint::Length(3), // height for single-line input + borders
    ]));

    // TextArea implements Widget — render directly
    frame.render_widget(textarea, input_area);
}

// ---------------------------------------------------------------------------
// Pattern 3: Handling input with mode switching
// ---------------------------------------------------------------------------
// In lumi-tui, we switch between Normal mode (shortcuts active)
// and Input mode (typing into TextArea).

enum InputResult {
    Continue,
    Submit(String),
    Cancel,
}

fn handle_input_mode(textarea: &mut TextArea, event: Event) -> InputResult {
    match event.into() {
        // Enter submits the message
        Input {
            key: Key::Enter, ..
        } => {
            let text = textarea.lines().join("\n");
            // Clear the textarea after submit
            textarea.select_all();
            textarea.cut(); // removes selected text
            InputResult::Submit(text)
        }
        // Esc exits input mode
        Input { key: Key::Esc, .. } => InputResult::Cancel,
        // Ctrl+M also submits (Enter alternative)
        Input {
            key: Key::Char('m'),
            ctrl: true,
            ..
        } => {
            let text = textarea.lines().join("\n");
            textarea.select_all();
            textarea.cut();
            InputResult::Submit(text)
        }
        // All other input goes to the textarea
        input => {
            textarea.input(input);
            InputResult::Continue
        }
    }
}

// ---------------------------------------------------------------------------
// Pattern 4: Search integration (for /search in file viewer)
// ---------------------------------------------------------------------------
fn search_example(textarea: &mut TextArea) {
    // Set a search pattern (supports regex)
    let _ = textarea.set_search_pattern("TODO");

    // Navigate matches
    textarea.search_forward(false);  // false = don't wrap to top
    textarea.search_back(false);     // false = don't wrap to bottom

    // Jump to first match and close search
    textarea.search_forward(true); // true = wrap around

    // Clear search
    let _ = textarea.set_search_pattern("");

    // Visual: search matches get a highlight style
    textarea.set_search_style(
        Style::default()
            .bg(Color::Yellow)
            .fg(Color::Black),
    );
}

// ---------------------------------------------------------------------------
// Pattern 5: Editor-style textarea with line numbers + search box
// ---------------------------------------------------------------------------
// From tui-textarea/examples/editor.rs — adapted for lumi-tui file viewer
struct SearchBox<'a> {
    textarea: TextArea<'a>,
    open: bool,
}

impl Default for SearchBox<'_> {
    fn default() -> Self {
        let mut textarea = TextArea::default();
        textarea.set_block(
            Block::default()
                .borders(Borders::ALL)
                .title("Search"),
        );
        Self {
            textarea,
            open: false,
        }
    }
}

impl SearchBox<'_> {
    fn open(&mut self) {
        self.open = true;
    }

    fn close(&mut self) {
        self.open = false;
        // Clear input but keep undo history for easy re-search
        self.textarea.move_cursor(CursorMove::End);
        self.textarea.delete_line_by_head();
    }

    fn height(&self) -> u16 {
        if self.open { 3 } else { 0 }
    }

    /// Returns the search query if the input was modified
    fn input(&mut self, input: Input) -> Option<&str> {
        match input {
            // Disable Enter/Ctrl+M (no newlines in search)
            Input { key: Key::Enter, .. }
            | Input { key: Key::Char('m'), ctrl: true, .. } => None,
            input => {
                let modified = self.textarea.input(input);
                modified.then(|| self.textarea.lines()[0].as_str())
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Pattern 6: Key API reference (tui-textarea Input type)
// ---------------------------------------------------------------------------
// tui-textarea uses its own Input type.
// Convert crossterm events via: `let input: Input = event.into();`
//
// Key mapping:
//   Input { key: Key::Char('x'), ctrl: false, alt: false, shift: false }
//   Input { key: Key::Enter, .. }
//   Input { key: Key::Esc, .. }
//   Input { key: Key::Backspace, .. }
//   Input { key: Key::Tab, .. }
//   Input { key: Key::Up/Down/Left/Right, .. }
//   Input { key: Key::Null, .. }  // no-op

// ---------------------------------------------------------------------------
// Pattern 7: TextArea methods cheat sheet
// ---------------------------------------------------------------------------
// Navigation:
//   textarea.move_cursor(CursorMove::Head)     — start of line
//   textarea.move_cursor(CursorMove::End)      — end of line
//   textarea.move_cursor(CursorMove::Top)      — first line
//   textarea.move_cursor(CursorMove::Bottom)   — last line
//   textarea.move_cursor(CursorMove::WordForward/WordBack)
//
// Editing:
//   textarea.insert_char(ch)
//   textarea.insert_newline()
//   textarea.delete_next_char() / delete_char()
//   textarea.delete_line_by_head() / delete_line_by_end()
//   textarea.undo() / textarea.redo()
//   textarea.cut() / textarea.copy() / textarea.paste()
//   textarea.select_all()
//
// Selection:
//   textarea.start_selection()
//   textarea.cancel_selection()
//
// Scrolling:
//   textarea.scroll((rows, cols))
//   textarea.scroll(Scrolling::HalfPageDown)
//   textarea.scroll(Scrolling::PageUp)
//
// State:
//   textarea.cursor() -> (row, col)
//   textarea.lines() -> &[String]
//   textarea.is_empty() -> bool

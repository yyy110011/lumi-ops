// =============================================================================
// ANSI Rendering — ansi-to-tui for tmux capture-pane Output
// =============================================================================
//
// Crate: https://docs.rs/ansi-to-tui (MIT)
// Version: ansi-to-tui = "7" (or "8" for latest)
//
// Purpose: Convert ANSI-escaped terminal output (from `tmux capture-pane -p -e`)
//          into ratatui `Text` with colors and styles preserved.
//
// Key trait: IntoText — converts &[u8] or Vec<u8> → ratatui::text::Text
//
// Cargo.toml: ansi-to-tui = "7"

use ansi_to_tui::IntoText;
use ratatui::layout::Rect;
use ratatui::widgets::{Block, Paragraph, Wrap};
use ratatui::Frame;
use std::process::Command;
use tokio::process::Command as AsyncCommand;

// ---------------------------------------------------------------------------
// Pattern 1: Basic ANSI → ratatui Text conversion
// ---------------------------------------------------------------------------
fn basic_ansi_conversion() {
    // ANSI-escaped bytes (e.g., red text)
    let ansi_bytes = b"\x1b[31mError:\x1b[0m something went wrong";

    // Convert to ratatui Text (preserves color codes as ratatui Style)
    let text = ansi_bytes.into_text().expect("valid ANSI");

    // `text` is now a ratatui::text::Text with colored spans
    // Can be used directly in Paragraph::new(text)
}

// ---------------------------------------------------------------------------
// Pattern 2: tmux capture-pane → ratatui (sync version)
// ---------------------------------------------------------------------------
/// Capture tmux pane output with ANSI colors preserved
fn capture_tmux_pane_sync(session_name: &str, lines: usize) -> Option<ratatui::text::Text<'static>> {
    let output = Command::new("tmux")
        .args([
            "capture-pane",
            "-t", session_name,
            "-p",    // print to stdout
            "-e",    // escape sequences (ANSI colors)
            "-J",    // join wrapped lines
            "-S", &format!("-{}", lines), // start from N lines back
        ])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    // Convert raw ANSI bytes → ratatui Text
    output.stdout.into_text().ok()
}

// ---------------------------------------------------------------------------
// Pattern 3: tmux capture-pane → ratatui (async version for tokio)
// ---------------------------------------------------------------------------
async fn capture_tmux_pane_async(
    session_name: &str,
    lines: usize,
) -> anyhow::Result<ratatui::text::Text<'static>> {
    let output = AsyncCommand::new("tmux")
        .args([
            "capture-pane",
            "-t", session_name,
            "-p", "-e", "-J",
            "-S", &format!("-{}", lines),
        ])
        .output()
        .await?;

    if !output.status.success() {
        anyhow::bail!(
            "capture-pane failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    let text = output.stdout.into_text()?;
    Ok(text)
}

// ---------------------------------------------------------------------------
// Pattern 4: Rendering captured terminal output in a panel
// ---------------------------------------------------------------------------
fn render_terminal_panel(
    frame: &mut Frame,
    area: Rect,
    terminal_text: &ratatui::text::Text<'_>,
) {
    let block = Block::bordered().title(" 💬 Terminal ");

    let paragraph = Paragraph::new(terminal_text.clone())
        .block(block)
        .wrap(Wrap { trim: false });

    frame.render_widget(paragraph, area);
}

// ---------------------------------------------------------------------------
// Pattern 5: Scrollable terminal output with Paragraph::scroll
// ---------------------------------------------------------------------------
fn render_scrollable_terminal(
    frame: &mut Frame,
    area: Rect,
    terminal_text: &ratatui::text::Text<'_>,
    scroll_offset: u16,
) {
    let block = Block::bordered().title(" 💬 Terminal ");

    let paragraph = Paragraph::new(terminal_text.clone())
        .block(block)
        .scroll((scroll_offset, 0)) // (vertical_offset, horizontal_offset)
        .wrap(Wrap { trim: false });

    frame.render_widget(paragraph, area);
}

// ---------------------------------------------------------------------------
// Pattern 6: Combining with Scrollbar widget for visual indicator
// ---------------------------------------------------------------------------
use ratatui::layout::Margin;
use ratatui::widgets::{Scrollbar, ScrollbarOrientation, ScrollbarState};

fn render_terminal_with_scrollbar(
    frame: &mut Frame,
    area: Rect,
    terminal_text: &ratatui::text::Text<'_>,
    scroll_offset: u16,
    total_lines: usize,
) {
    let block = Block::bordered().title(" 💬 Terminal ");
    let inner = block.inner(area);

    let paragraph = Paragraph::new(terminal_text.clone())
        .block(block)
        .scroll((scroll_offset, 0))
        .wrap(Wrap { trim: false });

    frame.render_widget(paragraph, area);

    // Scrollbar on the right side
    let mut scrollbar_state = ScrollbarState::new(total_lines)
        .position(scroll_offset as usize);

    frame.render_stateful_widget(
        Scrollbar::default()
            .orientation(ScrollbarOrientation::VerticalRight)
            .begin_symbol(None)
            .end_symbol(None),
        area.inner(Margin {
            vertical: 1,
            horizontal: 0,
        }),
        &mut scrollbar_state,
    );
}

// ---------------------------------------------------------------------------
// Pattern 7: Reading from file (for testing without tmux)
// ---------------------------------------------------------------------------
fn read_ansi_file(path: &str) -> anyhow::Result<ratatui::text::Text<'static>> {
    let buffer = std::fs::read(path)?;
    let text = buffer.into_text()?;
    Ok(text)
}

// ---------------------------------------------------------------------------
// Notes on ANSI color support
// ---------------------------------------------------------------------------
// ansi-to-tui supports:
//   - Named/basic colors:     \x1b[30..37m (fg), \x1b[40..47m (bg)
//   - 256 indexed colors:     \x1b[38;5;<N>m (fg), \x1b[48;5;<N>m (bg)
//   - True color (24-bit):    \x1b[38;2;<R>;<G>;<B>m
//   - SGR modifiers:          bold, italic, underline, strikethrough
//   - Reset:                  \x1b[0m
//
// The `-e` flag on `tmux capture-pane` is critical to preserve ANSI escapes.
// Without it, you get plain text only.

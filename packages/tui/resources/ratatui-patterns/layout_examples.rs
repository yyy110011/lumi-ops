// =============================================================================
// Layout Examples — ratatui 0.29 Layout, Constraint, and Panel Splitting
// =============================================================================
//
// Source: https://github.com/ratatui/ratatui (MIT)
// Extracted patterns for lumi-tui 4-panel dashboard layout.
//
// Key types:
//   - Layout::horizontal / Layout::vertical — primary layout builders
//   - Constraint — Length, Min, Max, Percentage, Ratio, Fill
//   - Flex — Start, Center, End, SpaceBetween, SpaceAround, SpaceEvenly
//   - Rect — area rectangle, with .layout() destructuring
//   - area.centered(w, h) — centered popup overlay

use ratatui::layout::{Constraint, Flex, Layout, Rect};
use ratatui::widgets::{Block, Clear, Paragraph};
use ratatui::Frame;

// ---------------------------------------------------------------------------
// Pattern 1: Basic vertical layout with destructuring
// ---------------------------------------------------------------------------
// Use array destructuring on .layout() for clean, type-safe access.
fn basic_vertical_layout(frame: &mut Frame) {
    let area = frame.area();

    // Layout::vertical returns areas top-to-bottom
    let [header, content, footer] = area.layout(&Layout::vertical([
        Constraint::Length(1),  // fixed 1-row header
        Constraint::Fill(1),   // content takes remaining space
        Constraint::Length(1), // fixed 1-row footer/status bar
    ]));

    frame.render_widget(Paragraph::new("Header"), header);
    frame.render_widget(Paragraph::new("Content"), content);
    frame.render_widget(Paragraph::new("Footer"), footer);
}

// ---------------------------------------------------------------------------
// Pattern 2: Lumi-TUI 4-panel layout
// ---------------------------------------------------------------------------
// Matches the design spec:
//   ┌─────────────┬────────────────────────┬──────────────────────┐
//   │  Projects   │  File Viewer (top)     │  Agent Terminal      │
//   │  (~20%)     ├────────────────────────┤  (~40%)              │
//   │             │  Agent Table (bottom)  │                      │
//   ├─────────────┴────────────────────────┴──────────────────────┤
//   │  Status bar / keybinding hints                              │
//   └─────────────────────────────────────────────────────────────┘
fn lumi_4panel_layout(frame: &mut Frame) {
    let area = frame.area();

    // Step 1: Top-level vertical split — main area + status bar
    let [main_area, status_bar] = area.layout(&Layout::vertical([
        Constraint::Fill(1),   // main panels
        Constraint::Length(1), // status bar
    ]));

    // Step 2: Horizontal split — left panel | center | right panel
    let [left_panel, center_panel, right_panel] = main_area.layout(&Layout::horizontal([
        Constraint::Percentage(20), // Projects tree (~20%)
        Constraint::Percentage(40), // Center: file viewer + agent table
        Constraint::Percentage(40), // Agent terminal (~40%)
    ]));

    // Step 3: Center vertical split — file viewer (top) + agent table (bottom)
    let [file_viewer, agent_table] = center_panel.layout(&Layout::vertical([
        Constraint::Percentage(40), // File viewer (MISSION.md preview)
        Constraint::Percentage(60), // Active agents table
    ]));

    // Step 4: Right panel — terminal output + input box
    let [terminal_output, input_box] = right_panel.layout(&Layout::vertical([
        Constraint::Fill(1),    // tmux capture-pane output
        Constraint::Length(3),  // text input area (2 lines + border)
    ]));

    // Render each panel with a bordered block
    frame.render_widget(
        Block::bordered().title(" 📂 Projects "),
        left_panel,
    );
    frame.render_widget(
        Block::bordered().title(" 📄 File Viewer "),
        file_viewer,
    );
    frame.render_widget(
        Block::bordered().title(" 🤖 Active Agents "),
        agent_table,
    );
    frame.render_widget(
        Block::bordered().title(" 💬 Terminal "),
        terminal_output,
    );
    frame.render_widget(
        Block::bordered().title(" Input "),
        input_box,
    );
    frame.render_widget(
        Paragraph::new(" [q]uit [n]ew [a]ttach [s]top [r]eview [d]iff [m]erge [k]ill "),
        status_bar,
    );
}

// ---------------------------------------------------------------------------
// Pattern 3: Constraint types cheat sheet
// ---------------------------------------------------------------------------
// Length(n)     — exactly n cells
// Min(n)       — at least n cells, grows to fill
// Max(n)       — at most n cells
// Percentage(p) — p% of parent
// Ratio(n, d)  — n/d of parent
// Fill(w)      — fill remaining proportional to weight w
//
// Common patterns:
//   Fixed header + fill:  [Length(1), Fill(1)]
//   Two equal halves:     [Percentage(50), Percentage(50)]  or [Fill(1), Fill(1)]
//   Sidebar + main:       [Length(30), Fill(1)]
//   Three columns 20/40/40: [Percentage(20), Percentage(40), Percentage(40)]

// ---------------------------------------------------------------------------
// Pattern 4: Flex — control how leftover space is distributed
// ---------------------------------------------------------------------------
fn flex_layout_example(frame: &mut Frame) {
    let area = frame.area();

    let (blocks, _spacers) = Layout::horizontal(&[
        Constraint::Length(10),
        Constraint::Length(10),
        Constraint::Length(10),
    ])
    .flex(Flex::SpaceBetween)  // distribute leftover evenly between blocks
    .spacing(2)                // 2-cell gap between blocks
    .split_with_spacers(area);

    for block_area in blocks.iter() {
        frame.render_widget(Block::bordered(), *block_area);
    }
}

// ---------------------------------------------------------------------------
// Pattern 5: Popup overlay using Clear + centered()
// ---------------------------------------------------------------------------
// Clear widget erases background before rendering the popup on top.
fn popup_overlay(frame: &mut Frame, show_popup: bool) {
    let area = frame.area();

    // Render background content first
    frame.render_widget(Block::bordered().title("Content"), area);

    if show_popup {
        // .centered(width_constraint, height_constraint) creates a centered sub-area
        let popup_area = area.centered(
            Constraint::Percentage(60),
            Constraint::Percentage(30),
        );

        // Clear the background buffer before rendering popup
        frame.render_widget(Clear, popup_area);

        let popup = Paragraph::new("Are you sure?")
            .block(Block::bordered().title(" ⚠ Confirm "));
        frame.render_widget(popup, popup_area);
    }
}

// ---------------------------------------------------------------------------
// Pattern 6: Dynamic layout based on terminal size
// ---------------------------------------------------------------------------
fn responsive_layout(frame: &mut Frame) {
    let area = frame.area();

    if area.width >= 120 {
        // Wide: 3-column layout
        let [left, center, right] = area.layout(&Layout::horizontal([
            Constraint::Percentage(20),
            Constraint::Percentage(40),
            Constraint::Percentage(40),
        ]));
        let _ = (left, center, right);
    } else if area.width >= 80 {
        // Medium: 2-column layout (hide projects panel)
        let [main, terminal] = area.layout(&Layout::horizontal([
            Constraint::Percentage(50),
            Constraint::Percentage(50),
        ]));
        let _ = (main, terminal);
    } else {
        // Narrow: single column, stacked
        let [top, bottom] = area.layout(&Layout::vertical([
            Constraint::Percentage(50),
            Constraint::Percentage(50),
        ]));
        let _ = (top, bottom);
    }
}

// ---------------------------------------------------------------------------
// Pattern 7: Nested layout for table with scrollbar
// ---------------------------------------------------------------------------
use ratatui::layout::Margin;

fn table_layout_with_scrollbar(frame: &mut Frame) {
    let area = frame.area();

    let [table_area, footer_area] = area.layout(&Layout::vertical([
        Constraint::Min(5),     // table gets most space
        Constraint::Length(4),  // footer with help text
    ]));

    // Scrollbar renders inside the table area with a 1-cell margin
    let scrollbar_area = table_area.inner(Margin {
        vertical: 1,
        horizontal: 1,
    });

    let _ = scrollbar_area;
}

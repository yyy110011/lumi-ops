// =============================================================================
// Markdown Renderer — pulldown-cmark → ratatui for MISSION.md Preview
// =============================================================================
//
// Crate: https://docs.rs/pulldown-cmark (MIT)
// Version: pulldown-cmark = "0.12"
//
// Strategy: Parse markdown AST with pulldown-cmark, then convert events
// into ratatui Spans/Lines with basic syntax coloring.
//
// This is NOT a full markdown renderer — it provides enough for
// readable MISSION.md / MISSION_COMPLETE.md preview in the file viewer panel.

use pulldown_cmark::{Event, Options, Parser, Tag, TagEnd, HeadingLevel};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span, Text};

// ---------------------------------------------------------------------------
// Pattern 1: Parse markdown string → ratatui Text
// ---------------------------------------------------------------------------
pub fn markdown_to_text(markdown: &str) -> Text<'static> {
    let options = Options::ENABLE_STRIKETHROUGH
        | Options::ENABLE_TABLES
        | Options::ENABLE_TASKLISTS;

    let parser = Parser::new_ext(markdown, options);
    let mut lines: Vec<Line<'static>> = Vec::new();
    let mut current_spans: Vec<Span<'static>> = Vec::new();
    let mut style_stack: Vec<Style> = vec![Style::default()];

    for event in parser {
        match event {
            // --- Block-level events ---
            Event::Start(tag) => {
                match tag {
                    Tag::Heading { level, .. } => {
                        let style = heading_style(level);
                        style_stack.push(style);
                    }
                    Tag::Paragraph => {
                        // start collecting spans
                    }
                    Tag::CodeBlock(_kind) => {
                        style_stack.push(
                            Style::default()
                                .fg(Color::Green)
                                .add_modifier(Modifier::DIM),
                        );
                    }
                    Tag::BlockQuote(_) => {
                        current_spans.push(Span::styled("│ ", Style::default().fg(Color::DarkGray)));
                        style_stack.push(Style::default().fg(Color::Gray).add_modifier(Modifier::ITALIC));
                    }
                    Tag::List(_) => {}
                    Tag::Item => {
                        current_spans.push(Span::styled("  • ", Style::default().fg(Color::Cyan)));
                    }

                    // --- Inline events ---
                    Tag::Emphasis => {
                        style_stack.push(
                            Style::default().add_modifier(Modifier::ITALIC),
                        );
                    }
                    Tag::Strong => {
                        style_stack.push(
                            Style::default()
                                .add_modifier(Modifier::BOLD)
                                .fg(Color::White),
                        );
                    }
                    Tag::Strikethrough => {
                        style_stack.push(
                            Style::default().add_modifier(Modifier::CROSSED_OUT),
                        );
                    }
                    Tag::Link { dest_url, .. } => {
                        style_stack.push(
                            Style::default()
                                .fg(Color::Blue)
                                .add_modifier(Modifier::UNDERLINED),
                        );
                    }
                    _ => {}
                }
            }

            Event::End(tag_end) => {
                match tag_end {
                    TagEnd::Heading(_) | TagEnd::Emphasis | TagEnd::Strong
                    | TagEnd::Strikethrough | TagEnd::Link | TagEnd::CodeBlock
                    | TagEnd::BlockQuote => {
                        style_stack.pop();
                    }
                    TagEnd::Paragraph | TagEnd::Item => {
                        // Flush current spans as a line
                        if !current_spans.is_empty() {
                            lines.push(Line::from(std::mem::take(&mut current_spans)));
                        }
                    }
                    _ => {}
                }

                // Add blank line after headings and paragraphs
                match tag_end {
                    TagEnd::Heading(_) => {
                        if !current_spans.is_empty() {
                            lines.push(Line::from(std::mem::take(&mut current_spans)));
                        }
                        lines.push(Line::default()); // blank line
                    }
                    TagEnd::Paragraph => {
                        lines.push(Line::default()); // blank line
                    }
                    _ => {}
                }
            }

            Event::Text(text) => {
                let style = style_stack.last().copied().unwrap_or_default();
                current_spans.push(Span::styled(text.to_string(), style));
            }

            Event::Code(code) => {
                // Inline code: `code`
                current_spans.push(Span::styled(
                    format!("`{}`", code),
                    Style::default().fg(Color::Yellow).bg(Color::DarkGray),
                ));
            }

            Event::SoftBreak => {
                current_spans.push(Span::raw(" "));
            }

            Event::HardBreak => {
                lines.push(Line::from(std::mem::take(&mut current_spans)));
            }

            Event::Rule => {
                lines.push(Line::styled(
                    "─".repeat(40),
                    Style::default().fg(Color::DarkGray),
                ));
                lines.push(Line::default());
            }

            Event::TaskListMarker(checked) => {
                let marker = if checked { "☑ " } else { "☐ " };
                let color = if checked { Color::Green } else { Color::Yellow };
                current_spans.push(Span::styled(marker, Style::default().fg(color)));
            }

            _ => {} // InlineHtml, FootnoteReference, etc.
        }
    }

    // Flush remaining spans
    if !current_spans.is_empty() {
        lines.push(Line::from(current_spans));
    }

    Text::from(lines)
}

// ---------------------------------------------------------------------------
// Pattern 2: Heading styles by level
// ---------------------------------------------------------------------------
fn heading_style(level: HeadingLevel) -> Style {
    match level {
        HeadingLevel::H1 => Style::default()
            .fg(Color::Cyan)
            .add_modifier(Modifier::BOLD | Modifier::UNDERLINED),
        HeadingLevel::H2 => Style::default()
            .fg(Color::LightCyan)
            .add_modifier(Modifier::BOLD),
        HeadingLevel::H3 => Style::default()
            .fg(Color::LightBlue)
            .add_modifier(Modifier::BOLD),
        _ => Style::default()
            .fg(Color::White)
            .add_modifier(Modifier::BOLD),
    }
}

// ---------------------------------------------------------------------------
// Pattern 3: Usage in file viewer panel
// ---------------------------------------------------------------------------
use ratatui::widgets::{Block, Paragraph, Wrap};

fn render_mission_preview(
    frame: &mut ratatui::Frame,
    area: ratatui::layout::Rect,
    mission_content: &str,
    scroll_offset: u16,
) {
    let text = markdown_to_text(mission_content);

    let block = Block::bordered().title(" 📄 MISSION.md ");

    let paragraph = Paragraph::new(text)
        .block(block)
        .wrap(Wrap { trim: false })
        .scroll((scroll_offset, 0));

    frame.render_widget(paragraph, area);
}

// ---------------------------------------------------------------------------
// Pattern 4: Reading MISSION.md from worktree path
// ---------------------------------------------------------------------------
fn read_mission_file(worktree_path: &str) -> Option<String> {
    let mission_path = format!("{}/.lumi/MISSION.md", worktree_path);
    std::fs::read_to_string(mission_path).ok()
}

fn read_mission_complete(worktree_path: &str) -> Option<String> {
    let path = format!("{}/.lumi/MISSION_COMPLETE.md", worktree_path);
    std::fs::read_to_string(path).ok()
}

fn read_review_feedback(worktree_path: &str) -> Option<String> {
    let path = format!("{}/.lumi/REVIEW_FEEDBACK.md", worktree_path);
    std::fs::read_to_string(path).ok()
}

// ---------------------------------------------------------------------------
// Pattern 5: Table rendering from markdown
// ---------------------------------------------------------------------------
// pulldown-cmark can parse tables, but rendering them in ratatui requires
// building a ratatui Table widget. For MISSION.md preview, a simple approach:
//
//   Event::Start(Tag::Table(alignments)) → start collecting rows
//   Event::Start(Tag::TableHead) → mark next row as header
//   Event::Start(Tag::TableRow) → start new row
//   Event::Start(Tag::TableCell) → start new cell
//   Event::Text(text) → cell content
//   Event::End(Tag::TableCell) → finish cell
//   Event::End(Tag::TableRow) → finish row
//   Event::End(Tag::Table) → render as ratatui::Table or as aligned text lines
//
// For Phase 1, rendering tables as plain text lines is sufficient.
// Full Table widget rendering can be added later.

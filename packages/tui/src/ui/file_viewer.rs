//! File viewer panel — markdown rendering for MISSION.md preview.
//!
//! Uses `pulldown-cmark` to parse markdown AST and convert it to
//! styled ratatui `Text` with basic syntax coloring.

use pulldown_cmark::{Event, HeadingLevel, Options, Parser, Tag, TagEnd};
use ratatui::{
    layout::Rect,
    style::{Color, Modifier, Style},
    text::{Line, Span, Text},
    widgets::{Block, Borders, Paragraph, Wrap},
    Frame,
};

use crate::app::{AppState, FocusedPanel};

/// Convert a markdown string to styled ratatui `Text`.
pub fn markdown_to_text(markdown: &str) -> Text<'static> {
    let options =
        Options::ENABLE_STRIKETHROUGH | Options::ENABLE_TABLES | Options::ENABLE_TASKLISTS;

    let parser = Parser::new_ext(markdown, options);
    let mut lines: Vec<Line<'static>> = Vec::new();
    let mut current_spans: Vec<Span<'static>> = Vec::new();
    let mut style_stack: Vec<Style> = vec![Style::default()];

    for event in parser {
        match event {
            // --- Block-level start events ---
            Event::Start(tag) => match tag {
                Tag::Heading { level, .. } => {
                    let style = heading_style(level);
                    style_stack.push(style);
                }
                Tag::Paragraph => {}
                Tag::CodeBlock(_kind) => {
                    style_stack.push(
                        Style::default()
                            .fg(Color::Green)
                            .add_modifier(Modifier::DIM),
                    );
                }
                Tag::BlockQuote(_) => {
                    current_spans.push(Span::styled(
                        "│ ",
                        Style::default().fg(Color::DarkGray),
                    ));
                    style_stack.push(
                        Style::default()
                            .fg(Color::Gray)
                            .add_modifier(Modifier::ITALIC),
                    );
                }
                Tag::List(_) => {}
                Tag::Item => {
                    current_spans.push(Span::styled(
                        "  • ",
                        Style::default().fg(Color::Cyan),
                    ));
                }
                Tag::Emphasis => {
                    style_stack.push(Style::default().add_modifier(Modifier::ITALIC));
                }
                Tag::Strong => {
                    style_stack.push(
                        Style::default()
                            .add_modifier(Modifier::BOLD)
                            .fg(Color::White),
                    );
                }
                Tag::Strikethrough => {
                    style_stack.push(Style::default().add_modifier(Modifier::CROSSED_OUT));
                }
                Tag::Link { .. } => {
                    style_stack.push(
                        Style::default()
                            .fg(Color::Blue)
                            .add_modifier(Modifier::UNDERLINED),
                    );
                }
                _ => {}
            },

            // --- Block-level end events ---
            Event::End(tag_end) => {
                match tag_end {
                    TagEnd::Heading(_)
                    | TagEnd::Emphasis
                    | TagEnd::Strong
                    | TagEnd::Strikethrough
                    | TagEnd::Link
                    | TagEnd::CodeBlock
                    | TagEnd::BlockQuote(_) => {
                        style_stack.pop();
                    }
                    TagEnd::Paragraph | TagEnd::Item => {
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
                        lines.push(Line::default());
                    }
                    TagEnd::Paragraph => {
                        lines.push(Line::default());
                    }
                    _ => {}
                }
            }

            // --- Inline content events ---
            Event::Text(text) => {
                let style = style_stack.last().copied().unwrap_or_default();
                current_spans.push(Span::styled(text.to_string(), style));
            }

            Event::Code(code) => {
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

/// Style for headings by level.
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

/// Render the file viewer panel (center-top).
pub fn render_file_viewer(frame: &mut Frame, area: Rect, app: &AppState) {
    let focused = app.focused == FocusedPanel::FileViewer;
    let border_style = if focused {
        Style::default()
            .fg(Color::Cyan)
            .add_modifier(Modifier::BOLD)
    } else {
        Style::default().fg(Color::DarkGray)
    };

    let block = Block::default()
        .borders(Borders::ALL)
        .title(" 📄 MISSION.md ")
        .border_style(border_style);

    match &app.mission_content {
        Some(content) => {
            let text = markdown_to_text(content);
            let paragraph = Paragraph::new(text)
                .block(block)
                .wrap(Wrap { trim: false })
                .scroll((app.file_scroll, 0));
            frame.render_widget(paragraph, area);
        }
        None => {
            let placeholder = Paragraph::new("  Select a clone to view its mission")
                .block(block)
                .style(Style::default().fg(Color::DarkGray));
            frame.render_widget(placeholder, area);
        }
    }
}

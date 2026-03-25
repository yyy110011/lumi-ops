//! Tabbed file viewer — replaces single MISSION.md viewer with 3 switchable tabs:
//! MISSION, COMPLETE, and LOG.
//!
//! Reuses [`super::file_viewer::markdown_to_text`] for markdown rendering.

use std::io::BufRead;

use ratatui::{
    layout::{Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span, Text},
    widgets::{Block, Borders, Paragraph, Tabs, Wrap},
    Frame,
};

use super::file_viewer::markdown_to_text;

// ── Types ────────────────────────────────────────────────────────────

/// Which tab is active in the file viewer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FileTab {
    Mission,
    Complete,
    Log,
}

impl FileTab {
    /// Index used for arrays (scroll_positions, content_cache).
    fn index(self) -> usize {
        match self {
            Self::Mission => 0,
            Self::Complete => 1,
            Self::Log => 2,
        }
    }
}

// ── State ────────────────────────────────────────────────────────────

/// State for the tabbed file viewer.
pub struct FileTabsState {
    pub active_tab: FileTab,
    pub scroll_positions: [u16; 3],
    pub content_cache: [Option<String>; 3],
}

impl FileTabsState {
    /// Create a new `FileTabsState` with defaults:
    /// - active tab: Mission
    /// - all scrolls: 0
    /// - all caches: None
    pub fn new() -> Self {
        Self {
            active_tab: FileTab::Mission,
            scroll_positions: [0; 3],
            content_cache: [None, None, None],
        }
    }

    /// Cycle to the next tab: Mission → Complete → Log → Mission.
    pub fn next_tab(&mut self) {
        self.active_tab = match self.active_tab {
            FileTab::Mission => FileTab::Complete,
            FileTab::Complete => FileTab::Log,
            FileTab::Log => FileTab::Mission,
        };
    }

    /// Cycle to the previous tab: Mission → Log → Complete → Mission.
    pub fn prev_tab(&mut self) {
        self.active_tab = match self.active_tab {
            FileTab::Mission => FileTab::Log,
            FileTab::Complete => FileTab::Mission,
            FileTab::Log => FileTab::Complete,
        };
    }

    /// Get the scroll position for the active tab.
    pub fn active_scroll(&self) -> u16 {
        self.scroll_positions[self.active_tab.index()]
    }

    /// Get a mutable reference to the scroll position for the active tab.
    pub fn active_scroll_mut(&mut self) -> &mut u16 {
        &mut self.scroll_positions[self.active_tab.index()]
    }

    /// Get the cached content for the active tab.
    pub fn active_content(&self) -> Option<&str> {
        self.content_cache[self.active_tab.index()].as_deref()
    }

    /// Scroll the active tab up by 1 line (saturating at 0).
    pub fn scroll_up(&mut self) {
        let scroll = self.active_scroll_mut();
        *scroll = scroll.saturating_sub(1);
    }

    /// Scroll the active tab down by 1 line (saturating at u16::MAX).
    pub fn scroll_down(&mut self) {
        let scroll = self.active_scroll_mut();
        *scroll = scroll.saturating_add(1);
    }

    /// Read files from disk and update the content cache.
    ///
    /// - Mission: `{worktree_path}/MISSION.md`     (via `.lumi/MISSION.md`)
    /// - Complete: `{worktree_path}/MISSION_COMPLETE.md` (via `.lumi/MISSION_COMPLETE.md`)
    /// - Log: `{worktree_path}/.lumi/agent.log`    (last ~500 lines)
    pub fn refresh(&mut self, worktree_path: &str) {
        let base = std::path::Path::new(worktree_path);

        // Mission
        self.content_cache[FileTab::Mission.index()] =
            read_file_content(&base.join(".lumi").join("MISSION.md"));

        // Complete
        self.content_cache[FileTab::Complete.index()] =
            read_file_content(&base.join(".lumi").join("MISSION_COMPLETE.md"));

        // Log — read last ~500 lines
        self.content_cache[FileTab::Log.index()] =
            read_tail(&base.join(".lumi").join("agent.log"), 500);
    }

    /// Reset all caches and scroll positions.
    pub fn clear(&mut self) {
        self.content_cache = [None, None, None];
        self.scroll_positions = [0; 3];
    }
}

// ── File reading helpers ─────────────────────────────────────────────

/// Read entire file content as a String, returning None if it doesn't exist.
fn read_file_content(path: &std::path::Path) -> Option<String> {
    std::fs::read_to_string(path).ok()
}

/// Read the last `max_lines` lines from a file.
///
/// Returns `None` if the file doesn't exist.
fn read_tail(path: &std::path::Path, max_lines: usize) -> Option<String> {
    let file = std::fs::File::open(path).ok()?;
    let reader = std::io::BufReader::new(file);
    let all_lines: Vec<String> = reader.lines().map_while(Result::ok).collect();

    if all_lines.is_empty() {
        return Some(String::new());
    }

    let start = all_lines.len().saturating_sub(max_lines);
    Some(all_lines[start..].join("\n"))
}

// ── Rendering ────────────────────────────────────────────────────────

/// Render the tabbed file viewer panel.
///
/// Layout:
/// 1. Tab bar (1 line): `[MISSION] [COMPLETE] [LOG]`
/// 2. Content area: markdown-rendered or plain text
pub fn render_file_tabs(frame: &mut Frame, area: Rect, state: &FileTabsState, focused: bool) {
    let border_style = if focused {
        Style::default()
            .fg(Color::Cyan)
            .add_modifier(Modifier::BOLD)
    } else {
        Style::default().fg(Color::DarkGray)
    };

    // Split: tab bar (3 lines including borders) + content
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(3), Constraint::Min(1)])
        .split(area);

    // ── Tab bar ──────────────────────────────────────────────────
    let has_complete = state.content_cache[FileTab::Complete.index()].is_some();

    let tab_titles: Vec<Line<'_>> = vec![
        Line::from(" MISSION "),
        Line::from(if has_complete {
            " 🟣 COMPLETE "
        } else {
            " COMPLETE "
        }),
        Line::from(" LOG "),
    ];

    let tabs = Tabs::new(tab_titles)
        .block(
            Block::default()
                .borders(Borders::ALL)
                .border_style(border_style)
                .title(" 📄 File Viewer "),
        )
        .select(state.active_tab.index())
        .style(Style::default().fg(Color::DarkGray))
        .highlight_style(
            Style::default()
                .fg(Color::White)
                .bg(Color::Cyan)
                .add_modifier(Modifier::BOLD),
        )
        .divider(Span::styled("│", Style::default().fg(Color::DarkGray)));

    frame.render_widget(tabs, chunks[0]);

    // ── Content area ─────────────────────────────────────────────
    let content_block = Block::default()
        .borders(Borders::LEFT | Borders::RIGHT | Borders::BOTTOM)
        .border_style(border_style);

    match state.active_content() {
        Some(content) if !content.is_empty() => {
            match state.active_tab {
                FileTab::Mission | FileTab::Complete => {
                    // Markdown rendering
                    let text = markdown_to_text(content);
                    let paragraph = Paragraph::new(text)
                        .block(content_block)
                        .wrap(Wrap { trim: false })
                        .scroll((state.active_scroll(), 0));
                    frame.render_widget(paragraph, chunks[1]);
                }
                FileTab::Log => {
                    // Plain text, auto-scroll to end
                    let line_count = content.lines().count() as u16;
                    let visible_height = chunks[1].height.saturating_sub(2); // borders
                    let auto_scroll = line_count.saturating_sub(visible_height);

                    // Use active_scroll if user has manually scrolled, otherwise auto-scroll
                    let scroll = if state.active_scroll() == 0 {
                        auto_scroll
                    } else {
                        state.active_scroll()
                    };

                    let lines: Vec<Line<'_>> = content
                        .lines()
                        .map(|l| Line::raw(l.to_string()))
                        .collect();
                    let text = Text::from(lines);

                    let paragraph = Paragraph::new(text)
                        .block(content_block)
                        .wrap(Wrap { trim: false })
                        .scroll((scroll, 0));
                    frame.render_widget(paragraph, chunks[1]);
                }
            }
        }
        _ => {
            // No content — show placeholder
            let placeholder = match state.active_tab {
                FileTab::Mission => "  Select a clone to view its mission",
                FileTab::Complete => "  No report yet",
                FileTab::Log => "  No log file",
            };
            let paragraph = Paragraph::new(placeholder)
                .block(content_block)
                .style(Style::default().fg(Color::DarkGray));
            frame.render_widget(paragraph, chunks[1]);
        }
    }
}

// ── Tests ────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn test_new_defaults() {
        let state = FileTabsState::new();
        assert_eq!(state.active_tab, FileTab::Mission);
        assert_eq!(state.scroll_positions, [0, 0, 0]);
        assert!(state.content_cache[0].is_none());
        assert!(state.content_cache[1].is_none());
        assert!(state.content_cache[2].is_none());
    }

    #[test]
    fn test_next_tab_cycles() {
        let mut state = FileTabsState::new();
        assert_eq!(state.active_tab, FileTab::Mission);

        state.next_tab();
        assert_eq!(state.active_tab, FileTab::Complete);

        state.next_tab();
        assert_eq!(state.active_tab, FileTab::Log);

        state.next_tab();
        assert_eq!(state.active_tab, FileTab::Mission);
    }

    #[test]
    fn test_prev_tab_cycles() {
        let mut state = FileTabsState::new();
        assert_eq!(state.active_tab, FileTab::Mission);

        state.prev_tab();
        assert_eq!(state.active_tab, FileTab::Log);

        state.prev_tab();
        assert_eq!(state.active_tab, FileTab::Complete);

        state.prev_tab();
        assert_eq!(state.active_tab, FileTab::Mission);
    }

    #[test]
    fn test_scroll_up_saturating() {
        let mut state = FileTabsState::new();
        assert_eq!(state.active_scroll(), 0);

        state.scroll_up(); // should stay at 0
        assert_eq!(state.active_scroll(), 0);
    }

    #[test]
    fn test_scroll_down_and_up() {
        let mut state = FileTabsState::new();

        state.scroll_down();
        state.scroll_down();
        state.scroll_down();
        assert_eq!(state.active_scroll(), 3);

        state.scroll_up();
        assert_eq!(state.active_scroll(), 2);
    }

    #[test]
    fn test_scroll_per_tab_independent() {
        let mut state = FileTabsState::new();

        // Scroll Mission tab
        state.scroll_down();
        state.scroll_down();
        assert_eq!(state.active_scroll(), 2);

        // Switch to Complete — scroll should be 0
        state.next_tab();
        assert_eq!(state.active_tab, FileTab::Complete);
        assert_eq!(state.active_scroll(), 0);

        state.scroll_down();
        assert_eq!(state.active_scroll(), 1);

        // Switch back to Mission — scroll should still be 2
        state.prev_tab();
        assert_eq!(state.active_tab, FileTab::Mission);
        assert_eq!(state.active_scroll(), 2);
    }

    #[test]
    fn test_active_content_initially_none() {
        let state = FileTabsState::new();
        assert!(state.active_content().is_none());
    }

    #[test]
    fn test_clear_resets_all() {
        let mut state = FileTabsState::new();
        state.content_cache[0] = Some("test".to_string());
        state.scroll_positions[0] = 5;

        state.clear();

        assert!(state.content_cache[0].is_none());
        assert_eq!(state.scroll_positions[0], 0);
    }

    #[test]
    fn test_refresh_with_temp_directory() {
        let tmp = std::env::temp_dir().join("lumi_tui_test_file_tabs");
        let lumi_dir = tmp.join(".lumi");
        let _ = std::fs::create_dir_all(&lumi_dir);

        // Write test files
        let mut f = std::fs::File::create(lumi_dir.join("MISSION.md")).unwrap();
        write!(f, "# Test Mission\n\nDo the thing.").unwrap();

        let mut f = std::fs::File::create(lumi_dir.join("MISSION_COMPLETE.md")).unwrap();
        write!(f, "## Summary\n\nDone.").unwrap();

        let mut f = std::fs::File::create(lumi_dir.join("agent.log")).unwrap();
        write!(f, "line 1\nline 2\nline 3").unwrap();

        let mut state = FileTabsState::new();
        state.refresh(tmp.to_str().unwrap());

        // Mission tab content
        assert!(state.content_cache[FileTab::Mission.index()].is_some());
        assert!(state.content_cache[FileTab::Mission.index()]
            .as_ref()
            .unwrap()
            .contains("Test Mission"));

        // Complete tab content
        assert!(state.content_cache[FileTab::Complete.index()].is_some());
        assert!(state.content_cache[FileTab::Complete.index()]
            .as_ref()
            .unwrap()
            .contains("Done"));

        // Log tab content
        assert!(state.content_cache[FileTab::Log.index()].is_some());
        assert!(state.content_cache[FileTab::Log.index()]
            .as_ref()
            .unwrap()
            .contains("line 3"));

        // Cleanup
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn test_refresh_missing_files() {
        let tmp = std::env::temp_dir().join("lumi_tui_test_file_tabs_missing");
        let _ = std::fs::create_dir_all(&tmp);
        // Don't create .lumi/ dir

        let mut state = FileTabsState::new();
        state.refresh(tmp.to_str().unwrap());

        assert!(state.content_cache[0].is_none());
        assert!(state.content_cache[1].is_none());
        assert!(state.content_cache[2].is_none());

        // Cleanup
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn test_read_tail_truncation() {
        let tmp = std::env::temp_dir().join("lumi_tui_test_tail");
        let _ = std::fs::create_dir_all(&tmp);

        let log_path = tmp.join("test.log");
        let mut f = std::fs::File::create(&log_path).unwrap();
        for i in 1..=1000 {
            writeln!(f, "log line {}", i).unwrap();
        }

        let content = read_tail(&log_path, 500).unwrap();
        let lines: Vec<&str> = content.lines().collect();
        assert_eq!(lines.len(), 500);
        assert!(lines[0].contains("501")); // First line should be 501
        assert!(lines[499].contains("1000")); // Last line should be 1000

        // Cleanup
        let _ = std::fs::remove_dir_all(&tmp);
    }
}

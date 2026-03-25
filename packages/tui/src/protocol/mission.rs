//! Read MISSION.md, MISSION_COMPLETE.md, REVIEW_FEEDBACK.md from clone worktrees.

/// Read a mission-related file from a clone's `.lumi/` directory.
///
/// Returns `None` if the file doesn't exist.
pub fn read_mission_file(
    worktree_path: &std::path::Path,
    filename: &str,
) -> Option<String> {
    let path = worktree_path.join(".lumi").join(filename);
    std::fs::read_to_string(&path).ok()
}

/// Read MISSION.md for a clone.
pub fn read_mission(worktree_path: &std::path::Path) -> Option<String> {
    read_mission_file(worktree_path, "MISSION.md")
}

/// Read MISSION_COMPLETE.md for a clone.
pub fn read_mission_complete(worktree_path: &std::path::Path) -> Option<String> {
    read_mission_file(worktree_path, "MISSION_COMPLETE.md")
}

/// Read REVIEW_FEEDBACK.md for a clone.
#[allow(unused)]
pub fn read_review_feedback(worktree_path: &std::path::Path) -> Option<String> {
    read_mission_file(worktree_path, "REVIEW_FEEDBACK.md")
}

/// Extract a plain-text preview from markdown content.
///
/// Strips heading markers (`#`), collects the first `max_lines` non-empty lines,
/// and returns them joined by newlines. Suitable for compact display in the TUI.
#[allow(unused)]
pub fn extract_preview(content: &str, max_lines: usize) -> String {
    content
        .lines()
        .map(|line| {
            let trimmed = line.trim();
            // Strip leading `#` heading markers
            if trimmed.starts_with('#') {
                trimmed.trim_start_matches('#').trim()
            } else {
                trimmed
            }
        })
        .filter(|line| !line.is_empty())
        .take(max_lines)
        .collect::<Vec<&str>>()
        .join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_preview_strips_headings() {
        let md = "# Mission Title\n\n## Task\nImplement the thing\n\nMore details here\n";
        let preview = extract_preview(md, 3);
        assert_eq!(preview, "Mission Title\nTask\nImplement the thing");
    }

    #[test]
    fn extract_preview_limits_lines() {
        let md = "Line 1\nLine 2\nLine 3\nLine 4\nLine 5\n";
        let preview = extract_preview(md, 2);
        assert_eq!(preview, "Line 1\nLine 2");
    }

    #[test]
    fn extract_preview_skips_empty_lines() {
        let md = "\n\n# Title\n\n\nSome content\n\n";
        let preview = extract_preview(md, 3);
        assert_eq!(preview, "Title\nSome content");
    }

    #[test]
    fn extract_preview_empty_input() {
        let preview = extract_preview("", 3);
        assert_eq!(preview, "");
    }

    #[test]
    fn extract_preview_nested_headings() {
        let md = "### Deep heading\n#### Deeper\nContent";
        let preview = extract_preview(md, 3);
        assert_eq!(preview, "Deep heading\nDeeper\nContent");
    }
}

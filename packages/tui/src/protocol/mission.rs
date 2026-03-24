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
pub fn read_review_feedback(worktree_path: &std::path::Path) -> Option<String> {
    read_mission_file(worktree_path, "REVIEW_FEEDBACK.md")
}

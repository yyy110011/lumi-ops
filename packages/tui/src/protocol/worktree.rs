//! Parse `lumi-ops list --json` output into structured clone data.

use ratatui::style::Color;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

use super::metadata::ReviewStatus;

/// A shadow clone (worktree) as returned by `lumi-ops list --json`.
///
/// Fields mirror the TypeScript `ShadowClone` interface in `packages/cli/src/commands/list.ts`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShadowClone {
    /// Stable identity — derived from worktree path (e.g., "feat/my-task").
    pub dir_name: String,
    /// Alias for `current_branch` (backward compat).
    pub branch: String,
    /// Actual branch checked out.
    pub current_branch: String,
    /// Absolute path to the worktree directory.
    pub path: String,
    /// Whether this is a shadow clone (true) or the main worktree (false).
    pub is_shadow: bool,
    #[serde(default)]
    pub is_main: bool,
    #[serde(default)]
    pub is_detached: bool,
    pub base_branch: Option<String>,
    pub description: Option<String>,
    pub review_status: Option<ReviewStatus>,
    #[serde(default)]
    pub has_conflict: bool,
    #[serde(default)]
    pub needs_rebase: bool,
}

impl ShadowClone {
    /// Compute the `.worktrees/` storage directory from this clone's path.
    ///
    /// Extracts the parent directory above the clone dir (e.g., from
    /// `/repo.worktrees/feat/my-task` → `/repo.worktrees`).
    #[allow(unused)]
    pub fn storage_dir(&self) -> PathBuf {
        let path = PathBuf::from(&self.path);
        // Walk up to find the `.worktrees` ancestor
        for ancestor in path.ancestors() {
            if let Some(name) = ancestor.file_name() {
                if name.to_string_lossy().ends_with(".worktrees") {
                    return ancestor.to_path_buf();
                }
            }
        }
        // Fallback: assume parent of dir_name segments above the path
        // For `feat/my-task`, go up 2 levels from path
        let depth = self.dir_name.matches('/').count() + 1;
        let mut result = path.clone();
        for _ in 0..depth {
            result = result.parent().unwrap_or(&result).to_path_buf();
        }
        result
    }

    /// Emoji icon for this clone's review status, or "⬜" if none set.
    #[allow(unused)]
    pub fn status_icon(&self) -> &'static str {
        self.review_status
            .as_ref()
            .map(|s| s.icon())
            .unwrap_or("⬜")
    }

    /// Ratatui color for this clone's review status, or `Gray` if none set.
    #[allow(unused)]
    pub fn status_color(&self) -> Color {
        self.review_status
            .as_ref()
            .map(|s| s.color())
            .unwrap_or(Color::Gray)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_json() -> &'static str {
        r#"[
            {
                "dirName": "lumi-ops",
                "branch": "main",
                "currentBranch": "main",
                "path": "/Users/ryan/project_in_progress/lumi-ops",
                "isShadow": false,
                "isMain": true
            },
            {
                "dirName": "feat/auth",
                "branch": "feat/auth",
                "currentBranch": "feat/auth",
                "path": "/Users/ryan/project_in_progress/lumi-ops.worktrees/feat/auth",
                "isShadow": true,
                "isMain": false,
                "baseBranch": "main",
                "description": "Add auth module",
                "reviewStatus": "inProgress",
                "hasConflict": false,
                "needsRebase": false
            },
            {
                "dirName": "fix/detached",
                "branch": "fix/detached",
                "currentBranch": "fix/detached",
                "path": "/Users/ryan/project_in_progress/lumi-ops.worktrees/fix/detached",
                "isShadow": true,
                "isDetached": true
            }
        ]"#
    }

    #[test]
    fn deserialize_clone_list() {
        let clones: Vec<ShadowClone> = serde_json::from_str(sample_json()).unwrap();
        assert_eq!(clones.len(), 3);

        // Main worktree
        let main = &clones[0];
        assert!(main.is_main);
        assert!(!main.is_shadow);
        assert_eq!(main.dir_name, "lumi-ops");

        // Shadow clone with metadata
        let auth = &clones[1];
        assert!(auth.is_shadow);
        assert_eq!(auth.dir_name, "feat/auth");
        assert_eq!(auth.base_branch.as_deref(), Some("main"));
        assert_eq!(auth.review_status, Some(ReviewStatus::InProgress));
        assert!(!auth.has_conflict);

        // Detached clone
        let detached = &clones[2];
        assert!(detached.is_detached);
        assert_eq!(detached.review_status, None);
    }

    #[test]
    fn storage_dir_from_worktree_path() {
        let clone = ShadowClone {
            dir_name: "feat/auth".to_string(),
            branch: "feat/auth".to_string(),
            current_branch: "feat/auth".to_string(),
            path: "/Users/ryan/project.worktrees/feat/auth".to_string(),
            is_shadow: true,
            is_main: false,
            is_detached: false,
            base_branch: None,
            description: None,
            review_status: None,
            has_conflict: false,
            needs_rebase: false,
        };
        assert_eq!(
            clone.storage_dir(),
            PathBuf::from("/Users/ryan/project.worktrees")
        );
    }

    #[test]
    fn status_icon_with_and_without_status() {
        let mut clone = ShadowClone {
            dir_name: "test".to_string(),
            branch: "test".to_string(),
            current_branch: "test".to_string(),
            path: "/tmp/test".to_string(),
            is_shadow: true,
            is_main: false,
            is_detached: false,
            base_branch: None,
            description: None,
            review_status: None,
            has_conflict: false,
            needs_rebase: false,
        };
        assert_eq!(clone.status_icon(), "⬜");
        assert_eq!(clone.status_color(), Color::Gray);

        clone.review_status = Some(ReviewStatus::NeedsReview);
        assert_eq!(clone.status_icon(), "👀");
        assert_eq!(clone.status_color(), Color::Magenta);
    }
}

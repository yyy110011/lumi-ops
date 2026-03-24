//! Parse `lumi-ops list --json` output into structured clone data.

use serde::{Deserialize, Serialize};

use super::metadata::ReviewStatus;

/// A shadow clone (worktree) as returned by `lumi-ops list --json`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShadowClone {
    pub dir_name: String,
    pub branch: String,
    pub current_branch: String,
    pub path: String,
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

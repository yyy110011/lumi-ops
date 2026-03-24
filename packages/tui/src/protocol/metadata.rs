//! Parse `.lumi-metadata.json` — centralized per-repo clone metadata.

use ratatui::style::Color;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fmt;

/// Review status for a shadow clone (mirrors CLI's ReviewStatus type).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ReviewStatus {
    Todo,
    InProgress,
    Done,
    WontDo,
    NeedsReview,
    NeedsRevision,
}

impl Default for ReviewStatus {
    fn default() -> Self {
        Self::Todo
    }
}

impl ReviewStatus {
    /// Emoji icon for display in the TUI.
    pub fn icon(&self) -> &'static str {
        match self {
            Self::Todo => "📋",
            Self::InProgress => "🔨",
            Self::Done => "✅",
            Self::WontDo => "❌",
            Self::NeedsReview => "👀",
            Self::NeedsRevision => "🔄",
        }
    }

    /// Ratatui color for the status.
    pub fn color(&self) -> Color {
        match self {
            Self::Todo => Color::Yellow,
            Self::InProgress => Color::Blue,
            Self::Done => Color::Green,
            Self::WontDo => Color::DarkGray,
            Self::NeedsReview => Color::Magenta,
            Self::NeedsRevision => Color::LightRed,
        }
    }
}

impl fmt::Display for ReviewStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Todo => write!(f, "Todo"),
            Self::InProgress => write!(f, "In Progress"),
            Self::Done => write!(f, "Done"),
            Self::WontDo => write!(f, "Won't Do"),
            Self::NeedsReview => write!(f, "Needs Review"),
            Self::NeedsRevision => write!(f, "Needs Revision"),
        }
    }
}

/// Per-branch metadata stored in `.lumi-metadata.json`.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CloneMetadata {
    pub base_branch: Option<String>,
    pub description: Option<String>,
    pub review_status: Option<ReviewStatus>,
    pub source_prompt: Option<String>,
}

/// Full metadata file: branch name → metadata.
pub type MetadataMap = HashMap<String, CloneMetadata>;

/// Read and parse `.lumi-metadata.json` from a repo's storage directory.
///
/// Returns an empty map if the file doesn't exist or is unparseable.
pub fn read_metadata(storage_dir: &std::path::Path) -> MetadataMap {
    let meta_path = storage_dir.join(".lumi-metadata.json");
    match std::fs::read_to_string(&meta_path) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
        Err(_) => HashMap::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deserialize_all_review_statuses() {
        let json = r#"{
            "feat/auth": {
                "baseBranch": "main",
                "description": "Add auth module",
                "reviewStatus": "inProgress",
                "sourcePrompt": "add-auth.md"
            },
            "fix/bug-123": {
                "baseBranch": "main",
                "reviewStatus": "todo"
            },
            "feat/done-task": {
                "reviewStatus": "done"
            },
            "feat/wont-do": {
                "reviewStatus": "wontDo"
            },
            "feat/review": {
                "reviewStatus": "needsReview"
            },
            "feat/revision": {
                "reviewStatus": "needsRevision"
            }
        }"#;

        let map: MetadataMap = serde_json::from_str(json).unwrap();
        assert_eq!(map.len(), 6);

        let auth = &map["feat/auth"];
        assert_eq!(auth.review_status, Some(ReviewStatus::InProgress));
        assert_eq!(auth.base_branch.as_deref(), Some("main"));
        assert_eq!(auth.description.as_deref(), Some("Add auth module"));
        assert_eq!(auth.source_prompt.as_deref(), Some("add-auth.md"));

        assert_eq!(
            map["fix/bug-123"].review_status,
            Some(ReviewStatus::Todo)
        );
        assert_eq!(
            map["feat/done-task"].review_status,
            Some(ReviewStatus::Done)
        );
        assert_eq!(
            map["feat/wont-do"].review_status,
            Some(ReviewStatus::WontDo)
        );
        assert_eq!(
            map["feat/review"].review_status,
            Some(ReviewStatus::NeedsReview)
        );
        assert_eq!(
            map["feat/revision"].review_status,
            Some(ReviewStatus::NeedsRevision)
        );
    }

    #[test]
    fn deserialize_empty_metadata() {
        let json = r#"{}"#;
        let map: MetadataMap = serde_json::from_str(json).unwrap();
        assert!(map.is_empty());
    }

    #[test]
    fn deserialize_minimal_entry() {
        let json = r#"{ "feat/x": {} }"#;
        let map: MetadataMap = serde_json::from_str(json).unwrap();
        let entry = &map["feat/x"];
        assert_eq!(entry.base_branch, None);
        assert_eq!(entry.description, None);
        assert_eq!(entry.review_status, None);
        assert_eq!(entry.source_prompt, None);
    }

    #[test]
    fn icon_returns_expected_emojis() {
        assert_eq!(ReviewStatus::Todo.icon(), "📋");
        assert_eq!(ReviewStatus::InProgress.icon(), "🔨");
        assert_eq!(ReviewStatus::Done.icon(), "✅");
        assert_eq!(ReviewStatus::WontDo.icon(), "❌");
        assert_eq!(ReviewStatus::NeedsReview.icon(), "👀");
        assert_eq!(ReviewStatus::NeedsRevision.icon(), "🔄");
    }

    #[test]
    fn color_returns_distinct_colors() {
        // Just verify they don't panic and return distinct values
        let colors: Vec<Color> = vec![
            ReviewStatus::Todo.color(),
            ReviewStatus::InProgress.color(),
            ReviewStatus::Done.color(),
            ReviewStatus::WontDo.color(),
            ReviewStatus::NeedsReview.color(),
            ReviewStatus::NeedsRevision.color(),
        ];
        // All should be unique
        for (i, c1) in colors.iter().enumerate() {
            for (j, c2) in colors.iter().enumerate() {
                if i != j {
                    assert_ne!(c1, c2, "Colors at index {i} and {j} should differ");
                }
            }
        }
    }

    #[test]
    fn display_format() {
        assert_eq!(format!("{}", ReviewStatus::Todo), "Todo");
        assert_eq!(format!("{}", ReviewStatus::InProgress), "In Progress");
        assert_eq!(format!("{}", ReviewStatus::NeedsReview), "Needs Review");
    }

    #[test]
    fn default_is_todo() {
        assert_eq!(ReviewStatus::default(), ReviewStatus::Todo);
    }
}

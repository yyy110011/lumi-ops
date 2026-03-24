//! Parse `.lumi-metadata.json` — centralized per-repo clone metadata.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

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

//! File-based agent status persistence.
//!
//! Writes agent status to `.lumi/agent-status.json` in each worktree so that
//! external tools (like the VS Code extension) can read agent status without
//! needing PTY access.

use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

use super::pty_pool::{AgentStatus, DriverName};

/// The filename written inside `.lumi/` in each worktree.
const STATUS_FILENAME: &str = "agent-status.json";

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------

/// JSON representation of agent status on disk.
#[derive(Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct AgentStatusFile {
    pub status: String,
    pub driver: String,
    pub last_updated: String,
}

// ---------------------------------------------------------------------------
// String conversions
// ---------------------------------------------------------------------------

/// Map `AgentStatus` to its lowercase JSON representation.
pub fn status_to_str(status: AgentStatus) -> &'static str {
    match status {
        AgentStatus::Running => "running",
        AgentStatus::AwaitingInput => "awaiting_input",
        AgentStatus::Completed => "completed",
        AgentStatus::Error => "error",
        AgentStatus::Idle => "idle",
    }
}

/// Map `DriverName` to its lowercase JSON representation.
pub fn driver_to_str(driver: DriverName) -> &'static str {
    match driver {
        DriverName::Gemini => "gemini",
        DriverName::Claude => "claude",
    }
}

// ---------------------------------------------------------------------------
// File operations
// ---------------------------------------------------------------------------

/// Write agent status to `{worktree}/.lumi/agent-status.json`.
///
/// Creates the `.lumi/` directory if it doesn't exist.
/// Errors are logged via `tracing::warn` and silently swallowed.
pub fn write_status(worktree_path: &str, status: AgentStatus, driver: DriverName) {
    let lumi_dir = Path::new(worktree_path).join(".lumi");

    if let Err(e) = fs::create_dir_all(&lumi_dir) {
        tracing::warn!(path = %lumi_dir.display(), error = %e, "Failed to create .lumi dir");
        return;
    }

    let file_path = lumi_dir.join(STATUS_FILENAME);
    let data = AgentStatusFile {
        status: status_to_str(status).to_string(),
        driver: driver_to_str(driver).to_string(),
        last_updated: chrono::Utc::now().to_rfc3339(),
    };

    match serde_json::to_string_pretty(&data) {
        Ok(json) => {
            if let Err(e) = fs::write(&file_path, json) {
                tracing::warn!(path = %file_path.display(), error = %e, "Failed to write status file");
            }
        }
        Err(e) => {
            tracing::warn!(error = %e, "Failed to serialize agent status");
        }
    }
}

/// Read agent status from `{worktree}/.lumi/agent-status.json`.
///
/// Returns `None` if the file doesn't exist or contains invalid JSON.
#[cfg(test)]
pub fn read_status(worktree_path: &str) -> Option<AgentStatusFile> {
    let file_path = Path::new(worktree_path)
        .join(".lumi")
        .join(STATUS_FILENAME);

    let content = fs::read_to_string(&file_path).ok()?;
    serde_json::from_str(&content).ok()
}

/// Remove the status file (called when an agent is killed).
///
/// Silently ignores missing files.
pub fn remove_status(worktree_path: &str) {
    let file_path = Path::new(worktree_path)
        .join(".lumi")
        .join(STATUS_FILENAME);

    let _ = fs::remove_file(file_path);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_to_str_all_variants() {
        assert_eq!(status_to_str(AgentStatus::Running), "running");
        assert_eq!(status_to_str(AgentStatus::AwaitingInput), "awaiting_input");
        assert_eq!(status_to_str(AgentStatus::Completed), "completed");
        assert_eq!(status_to_str(AgentStatus::Error), "error");
        assert_eq!(status_to_str(AgentStatus::Idle), "idle");
    }

    #[test]
    fn driver_to_str_all_variants() {
        assert_eq!(driver_to_str(DriverName::Gemini), "gemini");
        assert_eq!(driver_to_str(DriverName::Claude), "claude");
    }

    #[test]
    fn write_and_read_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let worktree = dir.path().to_str().unwrap();

        write_status(worktree, AgentStatus::Running, DriverName::Gemini);

        let result = read_status(worktree);
        assert!(result.is_some());

        let status_file = result.unwrap();
        assert_eq!(status_file.status, "running");
        assert_eq!(status_file.driver, "gemini");
        assert!(!status_file.last_updated.is_empty());
    }

    #[test]
    fn read_missing_returns_none() {
        let dir = tempfile::tempdir().unwrap();
        let worktree = dir.path().to_str().unwrap();

        // No file written yet
        assert!(read_status(worktree).is_none());
    }

    #[test]
    fn remove_deletes_file() {
        let dir = tempfile::tempdir().unwrap();
        let worktree = dir.path().to_str().unwrap();

        write_status(worktree, AgentStatus::Completed, DriverName::Claude);
        assert!(read_status(worktree).is_some());

        remove_status(worktree);
        assert!(read_status(worktree).is_none());
    }

    #[test]
    fn remove_missing_is_noop() {
        let dir = tempfile::tempdir().unwrap();
        let worktree = dir.path().to_str().unwrap();

        // Should not panic or error
        remove_status(worktree);
    }

    #[test]
    fn creates_lumi_dir_if_missing() {
        let dir = tempfile::tempdir().unwrap();
        let worktree = dir.path().to_str().unwrap();

        let lumi_dir = dir.path().join(".lumi");
        assert!(!lumi_dir.exists());

        write_status(worktree, AgentStatus::Idle, DriverName::Gemini);

        assert!(lumi_dir.exists());
        assert!(lumi_dir.join("agent-status.json").exists());
    }

    #[test]
    fn json_format_matches_spec() {
        let dir = tempfile::tempdir().unwrap();
        let worktree = dir.path().to_str().unwrap();

        write_status(worktree, AgentStatus::AwaitingInput, DriverName::Claude);

        let file_path = dir.path().join(".lumi").join("agent-status.json");
        let raw = std::fs::read_to_string(file_path).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&raw).unwrap();

        assert_eq!(parsed["status"], "awaiting_input");
        assert_eq!(parsed["driver"], "claude");
        assert!(parsed["last_updated"].is_string());
    }
}

//! CLI subprocess calls to `lumi-ops`.
//!
//! All mutations go through the CLI — the TUI never modifies git state directly.
//! The only exception is `set_status` which writes `.lumi-metadata.json` directly
//! because the CLI doesn't yet expose a `status set` command.


pub mod detect;
pub mod output;

use std::collections::HashMap;
use std::fmt;
use std::path::Path;

use anyhow::{Context, Result};
use tokio::process::Command;
use tracing::{debug, warn};

use crate::protocol::metadata::{CloneMetadata, ReviewStatus};
use crate::protocol::worktree::ShadowClone;

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

/// Error from a CLI subprocess call, preserving both stdout and stderr.
#[derive(Debug)]
pub struct CliError {
    /// The CLI command that failed (e.g. "lumi-ops list").
    pub command: String,
    /// Process exit code, if available.
    pub exit_code: Option<i32>,
    /// Captured stdout (may contain partial output).
    #[allow(unused)]
    pub stdout: String,
    /// Captured stderr (usually contains the error message).
    pub stderr: String,
}

impl fmt::Display for CliError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "`{}` failed (exit {:?}): {}",
            self.command,
            self.exit_code,
            self.stderr.trim()
        )
    }
}

impl std::error::Error for CliError {}

/// Helper to build a `CliError` from a finished `std::process::Output`.
fn cli_error(command: &str, output: &std::process::Output) -> CliError {
    CliError {
        command: command.to_string(),
        exit_code: output.status.code(),
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
    }
}

// ---------------------------------------------------------------------------
// List clones
// ---------------------------------------------------------------------------

/// List all shadow clones for a given repo root.
///
/// Strategy:
/// 1. Try `lumi-ops list --json` first (structured output).
/// 2. On failure, fall back to `lumi-ops list` and parse text output.
pub async fn list_clones(repo_root: &str) -> Result<Vec<ShadowClone>> {
    debug!(repo_root, "listing clones");

    // Attempt 1: JSON output
    match list_clones_json(repo_root).await {
        Ok(clones) => {
            debug!(count = clones.len(), "listed clones via --json");
            return Ok(clones);
        }
        Err(e) => {
            warn!(error = %e, "lumi-ops list --json failed, trying text fallback");
        }
    }

    // Attempt 2: Parse text output
    list_clones_text(repo_root).await
}

/// `lumi-ops list --json` → parse JSON array of `ShadowClone`.
async fn list_clones_json(repo_root: &str) -> Result<Vec<ShadowClone>> {
    let output = Command::new("lumi-ops")
        .args(["list", "--json"])
        .current_dir(repo_root)
        .output()
        .await
        .context("Failed to execute lumi-ops list --json")?;

    if !output.status.success() {
        return Err(cli_error("lumi-ops list --json", &output).into());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let clones: Vec<ShadowClone> =
        serde_json::from_str(&stdout).context("Failed to parse lumi-ops list --json output")?;
    Ok(clones)
}

/// Fallback: parse `lumi-ops list` text output line by line.
///
/// Expected format per line (after stripping ANSI):
///   `[SHADOW] feat/my-task -> /path/to/worktree`
///   `[CORE]   main -> /path/to/repo`
async fn list_clones_text(repo_root: &str) -> Result<Vec<ShadowClone>> {
    let output = Command::new("lumi-ops")
        .args(["list"])
        .current_dir(repo_root)
        .output()
        .await
        .context("Failed to execute lumi-ops list")?;

    if !output.status.success() {
        return Err(cli_error("lumi-ops list", &output).into());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let clean = output::strip_ansi_pub(&stdout);

    let mut clones = Vec::new();
    for line in clean.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let is_shadow = trimmed.contains("[SHADOW]");
        let is_main = trimmed.contains("[CORE]");

        if !is_shadow && !is_main {
            continue;
        }

        // Parse: "[SHADOW] name (on: branch) -> /path" or "[SHADOW] name -> /path"
        if let Some((name_part, path_part)) = trimmed.split_once(" -> ") {
            let path = path_part.trim().to_string();

            // Extract dir_name from the name part (strip marker)
            let name_str = name_part
                .replace("[SHADOW]", "")
                .replace("[CORE]", "")
                .trim()
                .to_string();

            // Check for "(on: branch)" suffix
            let (dir_name, branch) = if let Some(idx) = name_str.find(" (on: ") {
                let dn = name_str[..idx].trim().to_string();
                let br = name_str[idx + 5..]
                    .trim_end_matches(')')
                    .trim()
                    .to_string();
                (dn, br)
            } else {
                let dn = name_str.trim().to_string();
                let br = dn.clone();
                (dn, br)
            };

            clones.push(ShadowClone {
                dir_name: dir_name.clone(),
                branch: branch.clone(),
                current_branch: branch,
                path,
                is_shadow,
                is_main,
                is_detached: false,
                base_branch: None,
                description: None,
                review_status: None,
                has_conflict: false,
                needs_rebase: false,
            });
        }
    }

    debug!(count = clones.len(), "listed clones via text fallback");
    Ok(clones)
}

// ---------------------------------------------------------------------------
// Spawn
// ---------------------------------------------------------------------------

/// Spawn a new clone via `lumi-ops spawn <branch>`.
///
/// Returns the raw stdout on success.
#[allow(unused)]
pub async fn spawn_clone(repo_root: &str, branch: &str) -> Result<String> {
    debug!(repo_root, branch, "spawning clone");

    let output = Command::new("lumi-ops")
        .args(["spawn", branch])
        .current_dir(repo_root)
        .output()
        .await
        .context("Failed to execute lumi-ops spawn")?;

    if !output.status.success() {
        return Err(cli_error("lumi-ops spawn", &output).into());
    }

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    debug!(branch, "clone spawned successfully");
    Ok(stdout)
}

// ---------------------------------------------------------------------------
// Kill
// ---------------------------------------------------------------------------

/// Kill a clone via `lumi-ops kill <branch>`.
#[allow(unused)]
pub async fn kill_clone(repo_root: &str, branch: &str) -> Result<()> {
    debug!(repo_root, branch, "killing clone");

    let output = Command::new("lumi-ops")
        .args(["kill", branch])
        .current_dir(repo_root)
        .output()
        .await
        .context("Failed to execute lumi-ops kill")?;

    if !output.status.success() {
        return Err(cli_error("lumi-ops kill", &output).into());
    }

    debug!(branch, "clone killed successfully");
    Ok(())
}

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

/// Merge a clone via `lumi-ops merge <source> <target>`.
///
/// Returns the raw stdout on success.
#[allow(unused)]
pub async fn merge_clone(repo_root: &str, source: &str, target: &str) -> Result<String> {
    debug!(repo_root, source, target, "merging clone");

    let output = Command::new("lumi-ops")
        .args(["merge", source, target])
        .current_dir(repo_root)
        .output()
        .await
        .context("Failed to execute lumi-ops merge")?;

    if !output.status.success() {
        return Err(cli_error("lumi-ops merge", &output).into());
    }

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    debug!(source, target, "merge completed successfully");
    Ok(stdout)
}

// ---------------------------------------------------------------------------
// Set status
// ---------------------------------------------------------------------------

/// Set the review status of a clone branch.
///
/// # Implementation Note
///
/// The `lumi-ops` CLI does not yet expose a `status set` command.
/// This function directly reads/writes `.lumi-metadata.json`, mirroring the
/// TypeScript library's `setCloneStatus()` behavior.
///
/// TODO: Switch to CLI subprocess once `lumi-ops status set` is implemented.
#[allow(unused)]
pub async fn set_status(repo_root: &str, branch: &str, status: ReviewStatus) -> Result<()> {
    debug!(repo_root, branch, ?status, "setting clone status");

    let storage_dir = format!("{}.worktrees", repo_root);
    let meta_path = Path::new(&storage_dir).join(".lumi-metadata.json");

    // Read existing metadata (or start fresh)
    let mut metadata: HashMap<String, CloneMetadata> = if meta_path.exists() {
        let content = tokio::fs::read_to_string(&meta_path)
            .await
            .with_context(|| format!("Failed to read {}", meta_path.display()))?;
        serde_json::from_str(&content)
            .with_context(|| format!("Failed to parse {}", meta_path.display()))?
    } else {
        HashMap::new()
    };

    // Update status
    let entry = metadata.entry(branch.to_string()).or_default();
    entry.review_status = Some(status);

    // Write back
    let json = serde_json::to_string_pretty(&metadata)
        .context("Failed to serialize metadata")?;
    tokio::fs::write(&meta_path, json)
        .await
        .with_context(|| format!("Failed to write {}", meta_path.display()))?;

    debug!(branch, "status updated successfully");
    Ok(())
}

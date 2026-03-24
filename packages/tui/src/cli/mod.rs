//! CLI subprocess calls to `lumi-ops`.
//!
//! All mutations go through the CLI — the TUI never modifies files directly.

use anyhow::Result;
use tokio::process::Command;

use crate::protocol::worktree::ShadowClone;

/// Execute `lumi-ops list --json` for a given repo root and parse the output.
pub async fn list_clones(repo_root: &str) -> Result<Vec<ShadowClone>> {
    let output = Command::new("lumi-ops")
        .args(["list", "--json"])
        .current_dir(repo_root)
        .output()
        .await?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!("lumi-ops list failed: {}", stderr);
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let clones: Vec<ShadowClone> = serde_json::from_str(&stdout)?;
    Ok(clones)
}

/// Spawn a new clone via `lumi-ops spawn <branch>`.
pub async fn spawn_clone(repo_root: &str, branch: &str) -> Result<String> {
    let output = Command::new("lumi-ops")
        .args(["spawn", branch])
        .current_dir(repo_root)
        .output()
        .await?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!("spawn failed: {}", stderr);
    }
    Ok(stdout)
}

/// Kill a clone via `lumi-ops kill <branch>`.
pub async fn kill_clone(repo_root: &str, branch: &str) -> Result<()> {
    let output = Command::new("lumi-ops")
        .args(["kill", branch])
        .current_dir(repo_root)
        .output()
        .await?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!("kill failed: {}", stderr);
    }
    Ok(())
}

/// Merge a clone via `lumi-ops merge <source> <target>`.
pub async fn merge_clone(repo_root: &str, source: &str, target: &str) -> Result<String> {
    let output = Command::new("lumi-ops")
        .args(["merge", source, target])
        .current_dir(repo_root)
        .output()
        .await?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!("merge failed: {}", stderr);
    }
    Ok(stdout)
}

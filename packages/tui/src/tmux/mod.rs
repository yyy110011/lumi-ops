//! Tmux session management — async wrapper for tmux CLI.
//!
//! Provides capture-pane output (ANSI-preserved), send-keys input,
//! and session lifecycle (create, attach, kill).

pub mod detector;
pub mod manager;

use anyhow::{Context, Result};
use tokio::process::Command;

/// Session name prefix for all Lumi-managed tmux sessions.
pub const SESSION_PREFIX: &str = "lumi-";

/// Check if tmux is available on the system.
pub async fn is_tmux_available() -> bool {
    Command::new("tmux")
        .arg("-V")
        .output()
        .await
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// List all Lumi-managed tmux sessions (those with `lumi-` prefix).
pub async fn list_lumi_sessions() -> Result<Vec<String>> {
    let output = Command::new("tmux")
        .args(["list-sessions", "-F", "#{session_name}"])
        .output()
        .await
        .context("Failed to list tmux sessions")?;

    if !output.status.success() {
        // No tmux server running is not an error — just no sessions
        return Ok(Vec::new());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(stdout
        .lines()
        .filter(|s| s.starts_with(SESSION_PREFIX))
        .map(String::from)
        .collect())
}

/// Async tmux session wrapper.
///
/// All methods call out to `tmux` via `tokio::process::Command`.
pub struct TmuxSession {
    /// Session name (e.g., "lumi-feat/my-feature")
    pub name: String,
}

impl TmuxSession {
    pub fn new(name: impl Into<String>) -> Self {
        Self { name: name.into() }
    }

    /// Create a new tmux session with the given working directory and command.
    ///
    /// Creates a detached session via `new-session -d`, then sends the command.
    pub async fn create(&self, working_dir: &str, command: &str) -> Result<()> {
        let output = Command::new("tmux")
            .args([
                "new-session",
                "-d",
                "-s",
                &self.name,
                "-c",
                working_dir,
            ])
            .output()
            .await
            .context("Failed to execute tmux new-session")?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            anyhow::bail!("Failed to create tmux session '{}': {}", self.name, stderr);
        }

        // Send the command to start the agent
        self.send_keys(command).await?;
        Ok(())
    }

    /// Check if this session exists.
    pub async fn exists(&self) -> bool {
        Command::new("tmux")
            .args(["has-session", "-t", &self.name])
            .output()
            .await
            .map(|o| o.status.success())
            .unwrap_or(false)
    }

    /// Capture the current pane content with ANSI colors preserved.
    ///
    /// `lines` controls how many lines of scrollback to capture.
    pub async fn capture_pane(&self, lines: usize) -> Result<String> {
        let output = Command::new("tmux")
            .args([
                "capture-pane",
                "-t",
                &self.name,
                "-p",
                "-e", // Preserve ANSI escape sequences
                "-J", // Join wrapped lines
                "-S",
                &format!("-{}", lines),
            ])
            .output()
            .await
            .context("Failed to capture tmux pane")?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            anyhow::bail!(
                "Failed to capture pane for '{}': {}",
                self.name,
                stderr
            );
        }

        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    }

    /// Send keys (text) to the tmux session, followed by Enter.
    pub async fn send_keys(&self, keys: &str) -> Result<()> {
        // Send the text literally
        self.send_keys_raw(keys).await?;

        // Send Enter (C-m = Ctrl+M = Enter)
        let output = Command::new("tmux")
            .args(["send-keys", "-t", &self.name, "C-m"])
            .output()
            .await
            .context("Failed to send Enter to tmux")?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            anyhow::bail!("Failed to send Enter to '{}': {}", self.name, stderr);
        }

        Ok(())
    }

    /// Send raw keys without appending Enter.
    pub async fn send_keys_raw(&self, keys: &str) -> Result<()> {
        let output = Command::new("tmux")
            .args(["send-keys", "-t", &self.name, "-l", keys])
            .output()
            .await
            .context("Failed to send keys to tmux")?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            anyhow::bail!("Failed to send keys to '{}': {}", self.name, stderr);
        }

        Ok(())
    }

    /// Attach to the session (spawns child process, blocks until detach).
    ///
    /// In a TUI context, this is typically used to hand off the terminal
    /// to the user for direct tmux interaction.
    pub async fn attach(&self) -> Result<()> {
        let status = Command::new("tmux")
            .args(["attach-session", "-t", &self.name])
            .status()
            .await
            .context("Failed to attach to tmux session")?;

        if !status.success() {
            anyhow::bail!("Tmux attach to '{}' exited with error", self.name);
        }

        Ok(())
    }

    /// Kill this tmux session.
    pub async fn kill(&self) -> Result<()> {
        let output = Command::new("tmux")
            .args(["kill-session", "-t", &self.name])
            .output()
            .await
            .context("Failed to kill tmux session")?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            // Session might not exist, which is fine
            if !stderr.contains("no server running") && !stderr.contains("session not found") {
                anyhow::bail!("Failed to kill session '{}': {}", self.name, stderr);
            }
        }

        Ok(())
    }

    /// Get the foreground process running in the pane.
    pub async fn pane_current_command(&self) -> Option<String> {
        let output = Command::new("tmux")
            .args([
                "display-message",
                "-t",
                &self.name,
                "-p",
                "#{pane_current_command}",
            ])
            .output()
            .await
            .ok()?;

        if !output.status.success() {
            return None;
        }

        let cmd = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if cmd.is_empty() {
            None
        } else {
            Some(cmd)
        }
    }

    /// Get pane dimensions (width, height).
    ///
    /// Returns `None` if the pane or session doesn't exist.
    pub async fn pane_size(&self) -> Option<(u16, u16)> {
        let output = Command::new("tmux")
            .args([
                "display-message",
                "-t",
                &self.name,
                "-p",
                "#{pane_width} #{pane_height}",
            ])
            .output()
            .await
            .ok()?;

        if !output.status.success() {
            return None;
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let parts: Vec<&str> = stdout.split_whitespace().collect();

        if parts.len() >= 2 {
            let width = parts[0].parse().unwrap_or(80);
            let height = parts[1].parse().unwrap_or(24);
            Some((width, height))
        } else {
            None
        }
    }
}

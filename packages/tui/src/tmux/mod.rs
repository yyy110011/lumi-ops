//! Tmux session management — async wrapper for tmux CLI.
//!
//! Provides capture-pane output (ANSI-preserved), send-keys input,
//! and session lifecycle (create, attach, kill).

use anyhow::Result;
use tokio::process::Command;

/// Check if tmux is available on the system.
pub async fn is_tmux_available() -> bool {
    Command::new("tmux")
        .arg("-V")
        .output()
        .await
        .map(|o| o.status.success())
        .unwrap_or(false)
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
    pub async fn capture_pane(&self) -> Result<String> {
        let output = Command::new("tmux")
            .args(["capture-pane", "-p", "-e", "-J", "-t", &self.name])
            .output()
            .await?;
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    }

    /// Send keys (text) to the tmux session.
    pub async fn send_keys(&self, keys: &str) -> Result<()> {
        Command::new("tmux")
            .args(["send-keys", "-t", &self.name, keys, "Enter"])
            .output()
            .await?;
        Ok(())
    }

    /// Send raw keys without appending Enter.
    pub async fn send_keys_raw(&self, keys: &str) -> Result<()> {
        Command::new("tmux")
            .args(["send-keys", "-t", &self.name, keys])
            .output()
            .await?;
        Ok(())
    }

    /// Kill this tmux session.
    pub async fn kill(&self) -> Result<()> {
        Command::new("tmux")
            .args(["kill-session", "-t", &self.name])
            .output()
            .await?;
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
        let cmd = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if cmd.is_empty() {
            None
        } else {
            Some(cmd)
        }
    }
}

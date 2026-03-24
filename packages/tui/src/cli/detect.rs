//! CLI/tool availability detection.
//!
//! Called once on startup to verify that required external tools are installed.

use tokio::process::Command;
use tracing::{info, warn};

/// Summary of available external tools.
#[derive(Debug, Clone)]
pub struct ToolAvailability {
    /// Version string if `lumi-ops` is available (e.g. "0.5.4").
    pub lumi_ops_version: Option<String>,
    /// Version string if `tmux` is available (e.g. "tmux 3.4").
    pub tmux_version: Option<String>,
}

impl ToolAvailability {
    /// Returns `true` if the `lumi-ops` CLI is available.
    pub fn has_lumi_ops(&self) -> bool {
        self.lumi_ops_version.is_some()
    }

    /// Returns `true` if `tmux` is available.
    pub fn has_tmux(&self) -> bool {
        self.tmux_version.is_some()
    }

    /// Log warnings for any missing tools.
    pub fn log_warnings(&self) {
        if let Some(ref v) = self.lumi_ops_version {
            info!(version = %v, "lumi-ops CLI detected");
        } else {
            warn!("lumi-ops CLI not found — clone management will be unavailable");
        }

        if let Some(ref v) = self.tmux_version {
            info!(version = %v, "tmux detected");
        } else {
            warn!("tmux not found — agent terminal features will be unavailable");
        }
    }
}

/// Detect `lumi-ops` binary and return its version string.
///
/// Runs `lumi-ops --version` and parses the first line of stdout.
pub async fn detect_lumi_ops() -> Option<String> {
    let output = Command::new("lumi-ops")
        .arg("--version")
        .output()
        .await
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let version = stdout.lines().next()?.trim().to_string();
    if version.is_empty() {
        None
    } else {
        Some(version)
    }
}

/// Detect `tmux` binary and return its version string.
///
/// Runs `tmux -V` and parses the first line of stdout (e.g. "tmux 3.4").
pub async fn detect_tmux() -> Option<String> {
    let output = Command::new("tmux")
        .arg("-V")
        .output()
        .await
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let version = stdout.lines().next()?.trim().to_string();
    if version.is_empty() {
        None
    } else {
        Some(version)
    }
}

/// Detect all external tools in parallel.
///
/// Call once during startup and store the result in `AppState`.
pub async fn detect_all() -> ToolAvailability {
    let (lumi_ops, tmux) = tokio::join!(detect_lumi_ops(), detect_tmux());
    ToolAvailability {
        lumi_ops_version: lumi_ops,
        tmux_version: tmux,
    }
}

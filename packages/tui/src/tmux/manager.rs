//! TmuxManager — tracks and polls all `lumi-*` tmux sessions.
//!
//! Designed to be called from a background poller task every 2 seconds.
//! For each session: captures pane output, detects foreground process,
//! and runs status detection to produce a `SessionSnapshot`.

use std::collections::HashMap;

use anyhow::Result;
use tracing;

use super::{list_lumi_sessions, TmuxSession};
use crate::protocol::agent::{AgentStatus, ForegroundProcess, StatusDetection};
use crate::tmux::detector;

/// Default number of scrollback lines to capture.
const DEFAULT_CAPTURE_LINES: usize = 100;

/// A snapshot of a single tmux session's state at a point in time.
#[derive(Debug, Clone)]
pub struct SessionSnapshot {
    /// Tmux session name (e.g., "lumi-feat/my-feature")
    pub session_name: String,
    /// Raw pane output (with ANSI codes)
    pub output: String,
    /// Detected agent status
    pub status: AgentStatus,
    /// Detection diagnostic info
    pub detection: StatusDetection,
}

/// Manages and polls all `lumi-*` tmux sessions.
pub struct TmuxManager {
    /// Tracked sessions: session_name → TmuxSession
    sessions: HashMap<String, TmuxSession>,
}

impl TmuxManager {
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
        }
    }

    /// Refresh the session list by querying tmux for `lumi-*` sessions.
    ///
    /// Adds new sessions and removes stale ones.
    pub async fn refresh_sessions(&mut self) -> Result<()> {
        let live_sessions = list_lumi_sessions().await?;

        // Remove sessions that no longer exist
        self.sessions
            .retain(|name, _| live_sessions.contains(name));

        // Add new sessions
        for name in live_sessions {
            if !self.sessions.contains_key(&name) {
                tracing::debug!(session = %name, "Discovered new lumi tmux session");
                self.sessions
                    .insert(name.clone(), TmuxSession::new(name));
            }
        }

        Ok(())
    }

    /// Poll all tracked sessions: capture output + detect status.
    ///
    /// Returns a snapshot for each session. Errors for individual sessions
    /// are logged and skipped (graceful degradation).
    pub async fn poll_all_sessions(&self) -> Vec<SessionSnapshot> {
        let mut snapshots = Vec::with_capacity(self.sessions.len());

        for (name, session) in &self.sessions {
            match self.poll_session(session).await {
                Ok(snapshot) => snapshots.push(snapshot),
                Err(e) => {
                    tracing::warn!(session = %name, error = %e, "Failed to poll session");
                }
            }
        }

        snapshots
    }

    /// Poll a single session: capture pane + detect foreground process + detect status.
    async fn poll_session(&self, session: &TmuxSession) -> Result<SessionSnapshot> {
        // Capture pane output
        let output = session.capture_pane(DEFAULT_CAPTURE_LINES).await?;

        // Get foreground process for ground-truth detection
        let fg_process = match session.pane_current_command().await {
            Some(cmd) => ForegroundProcess::from_command(&cmd),
            None => ForegroundProcess::Unknown,
        };

        // Detect status using process-aware detection
        let detection = detector::detect_status_with_process(&output, fg_process);

        Ok(SessionSnapshot {
            session_name: session.name.clone(),
            output,
            status: detection.status.clone(),
            detection,
        })
    }

    /// Get the list of currently tracked session names.
    pub fn tracked_sessions(&self) -> Vec<&str> {
        self.sessions.keys().map(|s| s.as_str()).collect()
    }

    /// Check if any sessions are being tracked.
    pub fn is_empty(&self) -> bool {
        self.sessions.is_empty()
    }

    /// Number of tracked sessions.
    pub fn len(&self) -> usize {
        self.sessions.len()
    }
}

impl Default for TmuxManager {
    fn default() -> Self {
        Self::new()
    }
}

//! Agent status types — shared between protocol layer, tmux detector, and session manager.
//!
//! These types represent the runtime status of AI agents running in tmux sessions.

use chrono::{DateTime, Utc};
use ratatui::style::Color;
use std::fmt;

/// Runtime status of an AI agent detected from tmux pane output.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AgentStatus {
    /// Agent is actively processing (spinners, tool execution, thinking)
    Running,
    /// Agent is waiting for user input (permission prompt, question)
    AwaitingInput,
    /// Agent has finished its task successfully
    Completed,
    /// Agent is at a prompt, ready for a new task / no tmux session
    Idle,
    /// Agent encountered an error
    Error(String),
    /// Status could not be determined
    Unknown,
}

impl Default for AgentStatus {
    fn default() -> Self {
        Self::Unknown
    }
}

impl AgentStatus {
    /// Emoji/symbol icon for display in the TUI.
    #[allow(unused)]
    pub fn icon(&self) -> &'static str {
        match self {
            Self::Running => "🤖",
            Self::AwaitingInput => "⏳",
            Self::Completed => "✅",
            Self::Idle => "💤",
            Self::Error(_) => "❌",
            Self::Unknown => "❓",
        }
    }

    /// Ratatui color for the status.
    #[allow(unused)]
    pub fn color(&self) -> Color {
        match self {
            Self::Running => Color::Green,
            Self::AwaitingInput => Color::Yellow,
            Self::Completed => Color::Cyan,
            Self::Idle => Color::DarkGray,
            Self::Error(_) => Color::Red,
            Self::Unknown => Color::Gray,
        }
    }
}

impl fmt::Display for AgentStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Running => write!(f, "Running"),
            Self::AwaitingInput => write!(f, "Awaiting Input"),
            Self::Completed => write!(f, "Completed"),
            Self::Idle => write!(f, "Idle"),
            Self::Error(msg) => write!(f, "Error: {}", msg),
            Self::Unknown => write!(f, "Unknown"),
        }
    }
}

/// Information about an AI agent associated with a shadow clone.
#[allow(unused)]
#[derive(Debug, Clone)]
pub struct AgentInfo {
    /// Branch name this agent is working on (e.g., "feat/auth").
    pub branch: String,
    /// Tmux session name (e.g., "lumi-feat-auth").
    pub tmux_session: String,
    /// Current status of the agent.
    pub status: AgentStatus,
    /// When the agent last showed activity (output change, tool call, etc.)
    pub last_activity: Option<DateTime<Utc>>,
}

impl AgentInfo {
    /// Create a new `AgentInfo` with `Unknown` status and no last activity.
    #[allow(unused)]
    pub fn new(branch: String, tmux_session: String) -> Self {
        Self {
            branch,
            tmux_session,
            status: AgentStatus::Unknown,
            last_activity: None,
        }
    }
}

/// Diagnostic result from agent status detection.
#[derive(Debug, Clone)]
pub struct StatusDetection {
    /// Detected status
    pub status: AgentStatus,
    /// Human-readable reason for the detection
    pub reason: Option<String>,
    /// Which regex pattern group triggered the detection
    pub pattern: Option<String>,
}

impl StatusDetection {
    pub fn new(status: AgentStatus) -> Self {
        Self {
            status,
            reason: None,
            pattern: None,
        }
    }

    pub fn with_reason(mut self, reason: impl Into<String>) -> Self {
        self.reason = Some(reason.into());
        self
    }

    pub fn with_pattern(mut self, pattern: impl Into<String>) -> Self {
        self.pattern = Some(pattern.into());
        self
    }
}

/// Classification of the foreground process in a tmux pane.
///
/// Used as ground truth for more accurate status detection —
/// knowing *which* process is running lets us choose the right
/// regex patterns and default assumptions.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ForegroundProcess {
    /// Claude Code is alive (node, claude, npx)
    ClaudeRunning,
    /// Gemini CLI is alive (node, gemini)
    GeminiRunning,
    /// Codex is alive (codex)
    CodexRunning,
    /// At a shell prompt (bash, zsh, sh, fish, dash)
    Shell,
    /// AI agent spawned a subprocess (cargo, git, python, etc.)
    OtherProcess(String),
    /// Could not determine (tmux error or unavailable)
    Unknown,
}

impl ForegroundProcess {
    /// Classify a process command name into a variant.
    pub fn from_command(cmd: &str) -> Self {
        let cmd_lower = cmd.to_lowercase();
        let binary = cmd_lower.rsplit('/').next().unwrap_or(&cmd_lower);

        // Claude Code process names
        if matches!(binary, "claude" | "node" | "npx") {
            return Self::ClaudeRunning;
        }

        // Gemini CLI
        if binary == "gemini" {
            return Self::GeminiRunning;
        }

        // Codex
        if binary == "codex" {
            return Self::CodexRunning;
        }

        // Shell
        if matches!(binary, "bash" | "zsh" | "sh" | "fish" | "dash") {
            return Self::Shell;
        }

        if binary.is_empty() {
            Self::Unknown
        } else {
            Self::OtherProcess(binary.to_string())
        }
    }

    /// Check if this represents any AI agent running.
    #[allow(unused)]
    pub fn is_agent_running(&self) -> bool {
        matches!(
            self,
            Self::ClaudeRunning | Self::GeminiRunning | Self::CodexRunning
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn icon_returns_expected_symbols() {
        assert_eq!(AgentStatus::Running.icon(), "🤖");
        assert_eq!(AgentStatus::AwaitingInput.icon(), "⏳");
        assert_eq!(AgentStatus::Completed.icon(), "✅");
        assert_eq!(AgentStatus::Idle.icon(), "💤");
        assert_eq!(AgentStatus::Error("test".into()).icon(), "❌");
        assert_eq!(AgentStatus::Unknown.icon(), "❓");
    }

    #[test]
    fn color_returns_distinct_colors() {
        let colors: Vec<Color> = vec![
            AgentStatus::Running.color(),
            AgentStatus::AwaitingInput.color(),
            AgentStatus::Completed.color(),
            AgentStatus::Idle.color(),
            AgentStatus::Error("test".into()).color(),
            AgentStatus::Unknown.color(),
        ];
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
        assert_eq!(format!("{}", AgentStatus::Running), "Running");
        assert_eq!(format!("{}", AgentStatus::AwaitingInput), "Awaiting Input");
        assert_eq!(format!("{}", AgentStatus::Completed), "Completed");
        assert_eq!(format!("{}", AgentStatus::Idle), "Idle");
        assert_eq!(format!("{}", AgentStatus::Error("oops".into())), "Error: oops");
        assert_eq!(format!("{}", AgentStatus::Unknown), "Unknown");
    }

    #[test]
    fn default_is_unknown() {
        assert_eq!(AgentStatus::default(), AgentStatus::Unknown);
    }

    #[test]
    fn agent_info_constructor() {
        let info = AgentInfo::new("feat/auth".to_string(), "lumi-feat-auth".to_string());
        assert_eq!(info.branch, "feat/auth");
        assert_eq!(info.tmux_session, "lumi-feat-auth");
        assert_eq!(info.status, AgentStatus::Unknown);
        assert!(info.last_activity.is_none());
    }

    #[test]
    fn foreground_process_detection() {
        assert_eq!(ForegroundProcess::from_command("claude"), ForegroundProcess::ClaudeRunning);
        assert_eq!(ForegroundProcess::from_command("node"), ForegroundProcess::ClaudeRunning);
        assert_eq!(ForegroundProcess::from_command("gemini"), ForegroundProcess::GeminiRunning);
        assert_eq!(ForegroundProcess::from_command("bash"), ForegroundProcess::Shell);
        assert!(ForegroundProcess::ClaudeRunning.is_agent_running());
        assert!(!ForegroundProcess::Shell.is_agent_running());
    }
}

//! Agent status tracking for tmux-based AI agent sessions.

use chrono::{DateTime, Utc};
use ratatui::style::Color;
use std::fmt;

/// Status of an AI agent running in a tmux session.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AgentStatus {
    /// Agent is actively processing (tool calls, code generation, etc.)
    Running,
    /// Agent is waiting for user input (confirmation prompt, question, etc.)
    AwaitingInput,
    /// Agent has finished its task successfully.
    Completed,
    /// No tmux session found — agent is not running.
    Idle,
    /// Agent encountered an error.
    Error,
    /// Status could not be determined.
    Unknown,
}

impl Default for AgentStatus {
    fn default() -> Self {
        Self::Unknown
    }
}

impl AgentStatus {
    /// Emoji/symbol icon for display in the TUI.
    pub fn icon(&self) -> &'static str {
        match self {
            Self::Running => "🤖",
            Self::AwaitingInput => "⏳",
            Self::Completed => "✅",
            Self::Idle => "💤",
            Self::Error => "❌",
            Self::Unknown => "❓",
        }
    }

    /// Ratatui color for the status.
    pub fn color(&self) -> Color {
        match self {
            Self::Running => Color::Green,
            Self::AwaitingInput => Color::Yellow,
            Self::Completed => Color::Cyan,
            Self::Idle => Color::DarkGray,
            Self::Error => Color::Red,
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
            Self::Error => write!(f, "Error"),
            Self::Unknown => write!(f, "Unknown"),
        }
    }
}

/// Information about an AI agent associated with a shadow clone.
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
    pub fn new(branch: String, tmux_session: String) -> Self {
        Self {
            branch,
            tmux_session,
            status: AgentStatus::Unknown,
            last_activity: None,
        }
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
        assert_eq!(AgentStatus::Error.icon(), "❌");
        assert_eq!(AgentStatus::Unknown.icon(), "❓");
    }

    #[test]
    fn color_returns_distinct_colors() {
        let colors: Vec<Color> = vec![
            AgentStatus::Running.color(),
            AgentStatus::AwaitingInput.color(),
            AgentStatus::Completed.color(),
            AgentStatus::Idle.color(),
            AgentStatus::Error.color(),
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
        assert_eq!(format!("{}", AgentStatus::Error), "Error");
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
}

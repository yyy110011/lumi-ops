// ============================================================================
// Grove AppState, Action, InputMode, Config — Extracted Patterns
// Source: ZiiMs/Grove (MIT License)
// 
// ADAPTATION NOTES FOR LUMI-TUI:
// - Strip ALL project management (Asana, Notion, ClickUp, etc.) — Lumi uses
//   its own ReviewStatus from .lumi-metadata.json
// - Strip ALL git provider integrations (GitLab, GitHub, Codeberg) — Lumi
//   delegates to `lumi-ops` CLI
// - Keep: FocusedPanel, InputMode, action dispatch, config loading pattern
// ============================================================================

// ── From app/action.rs ──────────────────────────────────────────────────────

use uuid::Uuid;

/// Action enum — the central "message" type for the event loop.
/// All user interactions and background events are encoded as Actions.
/// 
/// Lumi-TUI adaptation: strip project mgmt, git provider, dev server actions.
/// Keep: navigation, agent CRUD, status updates, input mode, UI toggles.
#[derive(Debug, Clone)]
pub enum Action {
    // Navigation
    SelectNext,
    SelectPrevious,
    SelectFirst,
    SelectLast,

    // Agent Lifecycle
    CreateAgent { name: String, branch: String },
    DeleteAgent { id: Uuid },
    AttachToAgent { id: Uuid },
    DetachFromAgent,
    CopyWorktreePath { id: Uuid },

    // Status Updates (from background poller)
    UpdateAgentStatus {
        id: Uuid,
        status: AgentStatus,         // from agent_model.rs
        status_reason: Option<StatusReason>,
    },
    UpdateAgentOutput {
        id: Uuid,
        output: String,
    },
    RecordActivity {
        id: Uuid,
        had_activity: bool,
    },
    UpdateChecklistProgress {
        id: Uuid,
        progress: Option<(u32, u32)>,
    },

    // Input Mode
    EnterInputMode(InputMode),
    ExitInputMode,
    UpdateInput(String),
    SubmitInput,

    // UI Toggles (Lumi-specific: replace diff/logs with panel focus)
    ToggleHelp,
    ShowError(String),
    ClearError,

    // Lifecycle
    RefreshAll,
    Tick,
    Quit,
}

/// Input modes — determines what the text input does.
/// Lumi-TUI will have fewer modes: SpawnClone, ConfirmKill, ConfirmMerge, SendInput
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum InputMode {
    NewAgent,       // → SpawnClone in Lumi
    SetNote,        // → SendInput in Lumi
    ConfirmDelete,  // → ConfirmKill in Lumi
    ConfirmMerge,   // → ConfirmMerge in Lumi
}

// ── From app/state.rs ───────────────────────────────────────────────────────

use std::collections::{HashMap, VecDeque};

/// The core application state. Owned by main loop, mutated via Action dispatch.
/// 
/// PATTERN: Single struct holds everything. No Rc/Arc needed because the
/// main loop owns it exclusively. Background tasks communicate via Action channel.
///
/// Lumi-TUI adaptation:
/// - Replace `agents: HashMap<Uuid, Agent>` with clone list from .lumi-metadata.json
/// - Add `focused_panel: FocusedPanel` for 4-panel navigation  
/// - Add `terminal_output: String` for tmux capture-pane content
/// - Remove: settings, project mgmt, git provider, dev server state
pub struct AppState {
    // Agent management
    pub agents: HashMap<Uuid, Agent>,
    pub agent_order: Vec<Uuid>,      // Insertion-ordered agent IDs
    pub selected_index: usize,

    // Input
    pub input_mode: Option<InputMode>,
    pub input_buffer: String,

    // UI state
    pub show_help: bool,
    pub error_message: Option<String>,
    pub preview_content: Option<String>,   // MISSION.md rendered content
    pub output_scroll: usize,

    // Background polling data
    pub cpu_history: VecDeque<f64>,
    pub memory_history: VecDeque<f64>,
    pub memory_used: u64,
    pub memory_total: u64,

    // Config
    pub config: Config,
    pub repo_path: String,

    // Animation
    pub animation_frame: usize,

    // Logs
    pub logs: VecDeque<LogEntry>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FocusedPanel {
    Projects,     // Left: repo/clone tree
    FileViewer,   // Center-top: MISSION.md preview
    AgentTable,   // Center-bottom: agent status table
    Terminal,     // Right: tmux capture-pane output
}

pub struct LogEntry {
    pub timestamp: chrono::DateTime<chrono::Utc>,
    pub level: LogLevel,
    pub message: String,
}

pub enum LogLevel {
    Info,
    Warn,
    Error,
    Debug,
}

/// Key pattern: `selected_agent()` helper returns currently selected agent.
impl AppState {
    pub fn selected_agent(&self) -> Option<&Agent> {
        self.agent_order
            .get(self.selected_index)
            .and_then(|id| self.agents.get(id))
    }

    pub fn selected_agent_id(&self) -> Option<Uuid> {
        self.agent_order.get(self.selected_index).copied()
    }
}

// ── From app/config.rs ──────────────────────────────────────────────────────

use serde::{Deserialize, Serialize};

/// AI agent types supported (same as Grove)
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "kebab-case")]
pub enum AiAgent {
    #[default]
    ClaudeCode,
    Opencode,
    Codex,
    Gemini,
}

impl AiAgent {
    pub fn display_name(&self) -> &'static str {
        match self {
            AiAgent::ClaudeCode => "Claude Code",
            AiAgent::Opencode => "Opencode",
            AiAgent::Codex => "Codex",
            AiAgent::Gemini => "Gemini",
        }
    }

    pub fn command(&self) -> &'static str {
        match self {
            AiAgent::ClaudeCode => "claude",
            AiAgent::Opencode => "opencode",
            AiAgent::Codex => "codex",
            AiAgent::Gemini => "gemini",
        }
    }

    /// Process names that indicate this AI agent is the tmux foreground process.
    /// Used by ForegroundProcess::from_command_for_agent() in detector.rs.
    pub fn process_names(&self) -> &'static [&'static str] {
        match self {
            AiAgent::ClaudeCode => &["node", "claude", "npx"],
            AiAgent::Opencode => &["node", "opencode", "npx"],
            AiAgent::Codex => &["codex"],
            AiAgent::Gemini => &["node", "gemini"],
        }
    }
}

/// Minimal config for Lumi-TUI (toml-based, similar to Grove)
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Config {
    #[serde(default)]
    pub ai_agent: AiAgent,
    #[serde(default)]
    pub ui: UiConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UiConfig {
    #[serde(default = "default_frame_rate")]
    pub frame_rate: u32,
    #[serde(default = "default_tick_rate")]
    pub tick_rate_ms: u64,
    #[serde(default = "default_output_buffer")]
    pub output_buffer_lines: usize,
}

fn default_frame_rate() -> u32 { 30 }
fn default_tick_rate() -> u64 { 250 }
fn default_output_buffer() -> usize { 5000 }

impl Default for UiConfig {
    fn default() -> Self {
        Self {
            frame_rate: default_frame_rate(),
            tick_rate_ms: default_tick_rate(),
            output_buffer_lines: default_output_buffer(),
        }
    }
}

/// Keybind struct — matches keyboard event to configured action.
/// Pattern: store as { key: String, modifiers: Vec<String> } for easy
/// serialization and user customization.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub struct Keybind {
    pub key: String,
    #[serde(default)]
    pub modifiers: Vec<String>,
}

impl Keybind {
    pub fn new(key: impl Into<String>) -> Self {
        Self { key: key.into(), modifiers: Vec::new() }
    }

    pub fn display(&self) -> String {
        if self.modifiers.is_empty() {
            self.key.clone()
        } else {
            format!("{}+{}", self.modifiers.join("+"), self.key)
        }
    }
}

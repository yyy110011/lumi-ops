//! App state, actions, and keybinding dispatch.

use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};

use crate::StateUpdate;

/// Which panel currently has keyboard focus.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FocusedPanel {
    Projects,
    FileViewer,
    AgentList,
    Terminal,
}

impl FocusedPanel {
    /// Cycle to the next panel (Tab key).
    pub fn next(self) -> Self {
        match self {
            Self::Projects => Self::FileViewer,
            Self::FileViewer => Self::AgentList,
            Self::AgentList => Self::Terminal,
            Self::Terminal => Self::Projects,
        }
    }
}

/// Actions dispatched from keyboard events.
#[derive(Debug, Clone)]
pub enum Action {
    None,
    Quit,
    CycleFocus,
    JumpToPanel(FocusedPanel),
    // Navigation
    Up,
    Down,
    Enter,
    // Clone operations (via CLI subprocess)
    SpawnClone,
    AttachAgent,
    StopAgent,
    KillClone,
    MergeClone,
    SetReview,
    ShowDiff,
    // Search
    StartSearch,
    // Help
    ShowHelp,
}

/// Central application state.
pub struct AppState {
    pub focused: FocusedPanel,
    pub should_quit: bool,
    // TODO: These will be populated by Step 2 clones
    // pub repos: Vec<RepoEntry>,
    // pub clones: Vec<CloneEntry>,
    // pub selected_repo: usize,
    // pub selected_clone: usize,
    // pub terminal_content: String,
    // pub mission_content: String,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            focused: FocusedPanel::Projects,
            should_quit: false,
        }
    }

    /// Handle a keyboard event, return the resulting action.
    pub fn handle_key(&mut self, key: KeyEvent) -> Action {
        // Ctrl+C / Ctrl+Q always quits
        if key.modifiers.contains(KeyModifiers::CONTROL)
            && matches!(key.code, KeyCode::Char('c') | KeyCode::Char('q'))
        {
            return Action::Quit;
        }

        match key.code {
            KeyCode::Char('q') => Action::Quit,
            KeyCode::Tab => {
                self.focused = self.focused.next();
                Action::CycleFocus
            }
            KeyCode::Char('1') => {
                self.focused = FocusedPanel::Projects;
                Action::JumpToPanel(FocusedPanel::Projects)
            }
            KeyCode::Char('2') => {
                self.focused = FocusedPanel::FileViewer;
                Action::JumpToPanel(FocusedPanel::FileViewer)
            }
            KeyCode::Char('3') => {
                self.focused = FocusedPanel::AgentList;
                Action::JumpToPanel(FocusedPanel::AgentList)
            }
            KeyCode::Char('4') => {
                self.focused = FocusedPanel::Terminal;
                Action::JumpToPanel(FocusedPanel::Terminal)
            }
            // Navigation
            KeyCode::Up | KeyCode::Char('k') => Action::Up,
            KeyCode::Down | KeyCode::Char('j') => Action::Down,
            KeyCode::Enter => Action::Enter,
            // Clone operations
            KeyCode::Char('n') => Action::SpawnClone,
            KeyCode::Char('a') => Action::AttachAgent,
            KeyCode::Char('s') => Action::StopAgent,
            KeyCode::Char('K') => Action::KillClone,
            KeyCode::Char('m') => Action::MergeClone,
            KeyCode::Char('r') => Action::SetReview,
            KeyCode::Char('d') => Action::ShowDiff,
            // Search
            KeyCode::Char('/') => Action::StartSearch,
            // Help
            KeyCode::Char('?') => Action::ShowHelp,
            _ => Action::None,
        }
    }

    /// Apply a background state update.
    pub fn apply_update(&mut self, update: StateUpdate) {
        match update {
            StateUpdate::MetadataRefreshed => {
                tracing::debug!("Metadata refreshed");
                // TODO: Reload clone/agent list
            }
            StateUpdate::TerminalOutput { branch, content } => {
                tracing::debug!(branch, "Terminal output received");
                // TODO: Update terminal buffer for the specified branch
                let _ = content;
            }
        }
    }
}

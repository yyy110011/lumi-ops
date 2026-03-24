//! App state, actions, and keybinding dispatch.

pub mod poller;

use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};

use crate::protocol::metadata::ReviewStatus;
use crate::protocol::worktree::ShadowClone;

/// Background state update messages sent to the main loop.
#[derive(Debug)]
pub enum StateUpdate {
    /// Fresh clone list from polling (via `lumi-ops list --json`)
    ClonesRefreshed(Vec<ShadowClone>),
    /// MISSION.md content loaded for a clone
    MissionLoaded(String),
    /// Agent terminal output captured from tmux
    TerminalOutput { branch: String, content: String },
}

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

    // --- Data fields ---
    /// Registered repos: (name, root_dir) from `~/.lumi-ops/.registry.json`
    pub repos: Vec<(String, String)>,
    /// Shadow clones for the currently selected repo
    pub clones: Vec<ShadowClone>,
    /// Index of the currently selected repo in `repos`
    pub selected_repo: usize,
    /// Index of the currently selected clone in `clones`
    pub selected_clone: usize,
    /// MISSION.md content for the selected clone
    pub mission_content: Option<String>,
    /// Captured tmux terminal output
    pub terminal_content: String,
    /// Root directory of the currently selected repo
    pub current_repo_root: Option<String>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            focused: FocusedPanel::Projects,
            should_quit: false,
            repos: Vec::new(),
            clones: Vec::new(),
            selected_repo: 0,
            selected_clone: 0,
            mission_content: None,
            terminal_content: String::new(),
            current_repo_root: None,
        }
    }

    /// Load registered repos from the global registry.
    ///
    /// Populates `self.repos` sorted by name, and sets `current_repo_root`
    /// to the first repo if available.
    pub fn load_repos(&mut self) {
        let registry = crate::protocol::registry::read_registry();
        let mut repos: Vec<(String, String)> = registry.into_iter().collect();
        repos.sort_by(|a, b| a.0.cmp(&b.0));
        self.repos = repos;
        self.selected_repo = 0;
        self.update_current_repo_root();
    }

    /// Load clones for the current repo by reading metadata + discovering worktree dirs.
    ///
    /// This is a synchronous file-read approach. For the polling path,
    /// the poller calls `cli::list_clones()` async and sends `ClonesRefreshed`.
    pub fn load_clones(&mut self) {
        let Some(repo_root) = &self.current_repo_root else {
            self.clones.clear();
            self.selected_clone = 0;
            self.mission_content = None;
            return;
        };

        let storage_dir = format!("{}.worktrees", repo_root);
        let storage_path = std::path::Path::new(&storage_dir);
        let metadata_map = crate::protocol::metadata::read_metadata(storage_path);

        // Build clone entries from metadata
        let mut clones: Vec<ShadowClone> = metadata_map
            .into_iter()
            .map(|(branch, meta)| {
                let worktree_path = storage_path.join(&branch);
                ShadowClone {
                    dir_name: branch.clone(),
                    branch: branch.clone(),
                    current_branch: branch.clone(),
                    path: worktree_path.to_string_lossy().to_string(),
                    is_shadow: true,
                    is_main: false,
                    is_detached: false,
                    base_branch: meta.base_branch,
                    description: meta.description,
                    review_status: meta.review_status,
                    has_conflict: false,
                    needs_rebase: false,
                }
            })
            .collect();
        clones.sort_by(|a, b| a.branch.cmp(&b.branch));

        self.clones = clones;
        self.selected_clone = 0;
        self.load_selected_mission();
    }

    /// Get a reference to the currently selected clone.
    pub fn selected_clone_ref(&self) -> Option<&ShadowClone> {
        self.clones.get(self.selected_clone)
    }

    /// Get a reference to the currently selected repo as (name, root).
    pub fn selected_repo_ref(&self) -> Option<&(String, String)> {
        self.repos.get(self.selected_repo)
    }

    /// Derive `current_repo_root` from `selected_repo`.
    fn update_current_repo_root(&mut self) {
        self.current_repo_root = self.repos.get(self.selected_repo).map(|(_, root)| root.clone());
    }

    /// Load the MISSION.md content for the currently selected clone.
    fn load_selected_mission(&mut self) {
        self.mission_content = self
            .selected_clone_ref()
            .and_then(|clone| {
                let worktree_path = std::path::Path::new(&clone.path);
                // Prefer MISSION_COMPLETE.md if it exists (clone finished work),
                // otherwise show MISSION.md
                crate::protocol::mission::read_mission_complete(worktree_path)
                    .or_else(|| crate::protocol::mission::read_mission(worktree_path))
            });
    }

    /// Get the display status icon for a review status.
    pub fn status_icon(status: &Option<ReviewStatus>) -> &'static str {
        match status {
            Some(ReviewStatus::Todo) => "🟡",
            Some(ReviewStatus::InProgress) => "🔵",
            Some(ReviewStatus::NeedsReview) => "🟣",
            Some(ReviewStatus::NeedsRevision) => "🟠",
            Some(ReviewStatus::Done) => "✅",
            Some(ReviewStatus::WontDo) => "⬛",
            None => "  ",
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
            // Navigation — dispatch to focused panel
            KeyCode::Up | KeyCode::Char('k') => {
                self.navigate_up();
                Action::Up
            }
            KeyCode::Down | KeyCode::Char('j') => {
                self.navigate_down();
                Action::Down
            }
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

    /// Navigate up within the focused panel.
    fn navigate_up(&mut self) {
        match self.focused {
            FocusedPanel::Projects => {
                if self.selected_repo > 0 {
                    self.selected_repo -= 1;
                    self.update_current_repo_root();
                    // Reset clone selection when switching repos
                    self.clones.clear();
                    self.selected_clone = 0;
                    self.mission_content = None;
                    self.terminal_content.clear();
                }
            }
            FocusedPanel::AgentList => {
                if self.selected_clone > 0 {
                    self.selected_clone -= 1;
                    self.load_selected_mission();
                }
            }
            // FileViewer and Terminal don't have list navigation (scroll is future work)
            _ => {}
        }
    }

    /// Navigate down within the focused panel.
    fn navigate_down(&mut self) {
        match self.focused {
            FocusedPanel::Projects => {
                if !self.repos.is_empty() && self.selected_repo < self.repos.len() - 1 {
                    self.selected_repo += 1;
                    self.update_current_repo_root();
                    // Reset clone selection when switching repos
                    self.clones.clear();
                    self.selected_clone = 0;
                    self.mission_content = None;
                    self.terminal_content.clear();
                }
            }
            FocusedPanel::AgentList => {
                if !self.clones.is_empty() && self.selected_clone < self.clones.len() - 1 {
                    self.selected_clone += 1;
                    self.load_selected_mission();
                }
            }
            // FileViewer and Terminal don't have list navigation (scroll is future work)
            _ => {}
        }
    }

    /// Apply a background state update.
    pub fn apply_update(&mut self, update: StateUpdate) {
        match update {
            StateUpdate::ClonesRefreshed(new_clones) => {
                tracing::debug!(count = new_clones.len(), "Clones refreshed");
                // Preserve selection if possible
                let previously_selected = self
                    .selected_clone_ref()
                    .map(|c| c.branch.clone());

                self.clones = new_clones;

                // Restore selection by branch name
                if let Some(prev_branch) = previously_selected {
                    self.selected_clone = self
                        .clones
                        .iter()
                        .position(|c| c.branch == prev_branch)
                        .unwrap_or(0);
                } else {
                    self.selected_clone = 0;
                }

                self.load_selected_mission();
            }
            StateUpdate::MissionLoaded(content) => {
                tracing::debug!("Mission content loaded");
                self.mission_content = Some(content);
            }
            StateUpdate::TerminalOutput { branch, content } => {
                tracing::debug!(branch, "Terminal output received");
                // Only update if this output is for the currently selected clone
                if self
                    .selected_clone_ref()
                    .is_some_and(|c| c.branch == branch)
                {
                    self.terminal_content = content;
                }
            }
        }
    }
}

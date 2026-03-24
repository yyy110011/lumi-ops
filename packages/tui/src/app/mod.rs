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

/// A registered repository entry.
#[derive(Debug, Clone)]
pub struct RepoEntry {
    pub name: String,
    pub root_path: String,
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
    // Terminal passthrough — forward key to tmux session
    SendToTerminal(String),
}

/// Central application state.
pub struct AppState {
    pub focused: FocusedPanel,
    pub should_quit: bool,

    // --- Data fields (from registry + metadata) ---
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

    // --- Panel-specific UI state (from impl-ui) ---
    /// Selected index in the Projects panel list (combined repo+clone tree).
    pub tree_selected_idx: usize,
    /// Scroll offset for the file viewer panel.
    pub file_scroll: u16,
    /// Scroll offset for the terminal panel.
    pub terminal_scroll: u16,
    /// Whether the terminal should auto-scroll to bottom.
    pub terminal_auto_scroll: bool,
    /// Active tmux session name being captured (auto-detected or manually attached).
    pub active_tmux_session: Option<String>,
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
            tree_selected_idx: 0,
            file_scroll: 0,
            terminal_scroll: 0,
            terminal_auto_scroll: true,
            active_tmux_session: None,
        }
    }

    /// Load registered repos from the global registry.
    pub fn load_repos(&mut self) {
        let registry = crate::protocol::registry::read_registry();
        let mut repos: Vec<(String, String)> = registry.into_iter().collect();
        repos.sort_by(|a, b| a.0.cmp(&b.0));
        self.repos = repos;
        self.selected_repo = 0;
        self.update_current_repo_root();
    }

    /// Load clones for the current repo by reading metadata + discovering worktree dirs.
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

    /// Get the currently selected clone (alias used by UI).
    #[allow(unused)]
    pub fn selected_clone(&self) -> Option<&ShadowClone> {
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
                crate::protocol::mission::read_mission_complete(worktree_path)
                    .or_else(|| crate::protocol::mission::read_mission(worktree_path))
            });
        self.file_scroll = 0; // Reset scroll on new content
    }

    /// Get the display status icon for a review status.
    #[allow(unused)]
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

        // Terminal passthrough mode — when Terminal is focused,
        // forward all keys to the tmux session except Tab/Esc/number keys
        if self.focused == FocusedPanel::Terminal {
            match key.code {
                // Escape keys to exit terminal focus
                KeyCode::Tab => {
                    self.focused = self.focused.next();
                    return Action::CycleFocus;
                }
                KeyCode::Esc => {
                    self.focused = FocusedPanel::Projects;
                    return Action::JumpToPanel(FocusedPanel::Projects);
                }
                // Number keys to jump panels
                KeyCode::Char('1') => {
                    self.focused = FocusedPanel::Projects;
                    return Action::JumpToPanel(FocusedPanel::Projects);
                }
                KeyCode::Char('2') => {
                    self.focused = FocusedPanel::FileViewer;
                    return Action::JumpToPanel(FocusedPanel::FileViewer);
                }
                KeyCode::Char('3') => {
                    self.focused = FocusedPanel::AgentList;
                    return Action::JumpToPanel(FocusedPanel::AgentList);
                }
                // Everything else → forward to tmux
                KeyCode::Enter => return Action::SendToTerminal("\n".to_string()),
                KeyCode::Char(c) => {
                    if key.modifiers.contains(KeyModifiers::CONTROL) {
                        // Forward Ctrl+key as tmux C-key
                        return Action::SendToTerminal(format!("C-{}", c));
                    }
                    return Action::SendToTerminal(c.to_string());
                }
                KeyCode::Backspace => return Action::SendToTerminal("BSpace".to_string()),
                KeyCode::Up => return Action::SendToTerminal("Up".to_string()),
                KeyCode::Down => return Action::SendToTerminal("Down".to_string()),
                KeyCode::Left => return Action::SendToTerminal("Left".to_string()),
                KeyCode::Right => return Action::SendToTerminal("Right".to_string()),
                _ => return Action::None,
            }
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

    /// Total number of items in the projects tree (for bounds checking).
    pub fn tree_item_count(&self) -> usize {
        let mut count = self.repos.len(); // one item per repo header
        // clones are shown under the selected repo only (current design)
        count += self.clones.len();
        count
    }

    /// Navigate up within the focused panel.
    fn navigate_up(&mut self) {
        match self.focused {
            FocusedPanel::Projects => {
                if self.tree_selected_idx > 0 {
                    self.tree_selected_idx -= 1;
                }
                // Sync the repo selection: repos appear at their index position
                // (simplified: navigate repos directly)
                if self.selected_repo > 0 {
                    self.selected_repo -= 1;
                    self.update_current_repo_root();
                    self.clones.clear();
                    self.selected_clone = 0;
                    self.mission_content = None;

                }
            }
            FocusedPanel::AgentList => {
                if self.selected_clone > 0 {
                    self.selected_clone -= 1;
                    self.load_selected_mission();
                }
            }
            FocusedPanel::FileViewer => {
                self.file_scroll = self.file_scroll.saturating_sub(1);
            }
            FocusedPanel::Terminal => {
                self.terminal_auto_scroll = false;
                self.terminal_scroll = self.terminal_scroll.saturating_sub(1);
            }
        }
    }

    /// Navigate down within the focused panel.
    fn navigate_down(&mut self) {
        match self.focused {
            FocusedPanel::Projects => {
                let max = self.tree_item_count();
                if max > 0 && self.tree_selected_idx < max - 1 {
                    self.tree_selected_idx += 1;
                }
                if !self.repos.is_empty() && self.selected_repo < self.repos.len() - 1 {
                    self.selected_repo += 1;
                    self.update_current_repo_root();
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
            FocusedPanel::FileViewer => {
                self.file_scroll = self.file_scroll.saturating_add(1);
            }
            FocusedPanel::Terminal => {
                self.terminal_scroll = self.terminal_scroll.saturating_add(1);
            }
        }
    }

    /// Apply a background state update.
    pub fn apply_update(&mut self, update: StateUpdate) {
        match update {
            StateUpdate::ClonesRefreshed(new_clones) => {
                tracing::debug!(count = new_clones.len(), "Clones refreshed");
                let previously_selected = self
                    .selected_clone_ref()
                    .map(|c| c.branch.clone());

                self.clones = new_clones;

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
                self.file_scroll = 0;
            }
            StateUpdate::TerminalOutput { branch, content } => {
                tracing::debug!(branch, "Terminal output received");
                // Accept output from active tmux session or matching clone
                let should_update = self.active_tmux_session.is_some()
                    || self
                        .selected_clone_ref()
                        .is_some_and(|c| c.branch == branch);
                if should_update {
                    self.terminal_content = content;
                    if self.terminal_auto_scroll {
                        self.terminal_scroll = u16::MAX;
                    }
                }
            }
        }
    }
}

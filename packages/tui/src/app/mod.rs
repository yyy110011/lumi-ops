//! App state, actions, and keybinding dispatch.

pub mod config;
pub mod poller;
pub mod pty;
pub mod pty_pool;
pub mod status_detector;

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
    StopAgent,
    KillClone,
    MergeClone,
    SetReview,
    ShowDiff,
    // Search
    StartSearch,
    // Help
    ShowHelp,
    // --- Multi-agent actions ---
    /// 'a' key — spawn agent on selected clone
    LaunchAgent,
    /// 'x' key — kill selected agent
    KillAgent,
    /// Enter in Agent List → select agent + focus Terminal
    AttachAgent,
    /// ']' in File Viewer → next tab
    NextFileTab,
    /// '[' in File Viewer → prev tab
    PrevFileTab,
    /// 'S' — toggle settings popup
    ToggleSettings,
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
    /// MISSION.md content for the selected clone (legacy — kept for backwards compat)
    pub mission_content: Option<String>,
    /// Root directory of the currently selected repo
    pub current_repo_root: Option<String>,

    // --- Panel-specific UI state ---
    /// Selected index in the Projects panel list (combined repo+clone tree).
    pub tree_selected_idx: usize,
    /// Scroll offset for the file viewer panel (legacy — file_tabs has its own scroll).
    pub file_scroll: u16,

    // --- Multi-agent PTY pool ---
    /// Pool of running agents, each with their own embedded PTY.
    pub pty_pool: pty_pool::PtyPool,

    // --- Configuration ---
    /// TUI config loaded from `~/.lumi-ops/tui-config.toml`.
    pub config: config::TuiConfig,

    // --- Tabbed file viewer ---
    /// State for the tabbed file viewer (Mission / Complete / Log).
    pub file_tabs: crate::ui::file_tabs::FileTabsState,
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
            current_repo_root: None,
            tree_selected_idx: 0,
            file_scroll: 0,
            pty_pool: pty_pool::PtyPool::new(),
            config: config::TuiConfig::load(),
            file_tabs: crate::ui::file_tabs::FileTabsState::new(),
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

        // Also refresh file tabs for the new clone
        if let Some(clone) = self.selected_clone_ref() {
            let path = clone.path.clone();
            self.file_tabs.refresh(&path);
        } else {
            self.file_tabs.clear();
        }
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
        // --- Terminal-focused mode: forward most keys to PTY pool ---
        if self.focused == FocusedPanel::Terminal {
            if !self.pty_pool.is_empty() {
                match key.code {
                    // Escape keys: Tab, Esc, and number keys switch panels (do NOT send to PTY)
                    KeyCode::Tab => {
                        self.focused = self.focused.next();
                        return Action::CycleFocus;
                    }
                    KeyCode::Esc => {
                        self.focused = FocusedPanel::Projects;
                        return Action::JumpToPanel(FocusedPanel::Projects);
                    }
                    // Number keys 1-4: switch panels (consistent with non-Terminal mode)
                    KeyCode::Char('1') if !key.modifiers.intersects(KeyModifiers::CONTROL | KeyModifiers::ALT) => {
                        self.focused = FocusedPanel::Projects;
                        return Action::JumpToPanel(FocusedPanel::Projects);
                    }
                    KeyCode::Char('2') if !key.modifiers.intersects(KeyModifiers::CONTROL | KeyModifiers::ALT) => {
                        self.focused = FocusedPanel::FileViewer;
                        return Action::JumpToPanel(FocusedPanel::FileViewer);
                    }
                    KeyCode::Char('3') if !key.modifiers.intersects(KeyModifiers::CONTROL | KeyModifiers::ALT) => {
                        self.focused = FocusedPanel::AgentList;
                        return Action::JumpToPanel(FocusedPanel::AgentList);
                    }
                    KeyCode::Char('4') if !key.modifiers.intersects(KeyModifiers::CONTROL | KeyModifiers::ALT) => {
                        self.focused = FocusedPanel::Terminal;
                        return Action::JumpToPanel(FocusedPanel::Terminal);
                    }
                    // Ctrl+Q always quits
                    KeyCode::Char('q') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                        return Action::Quit;
                    }
                    // Ctrl+C → send \x03 to PTY (do NOT quit TUI)
                    KeyCode::Char('c') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                        let _ = self.pty_pool.write_to_selected(&[0x03]);
                        return Action::None;
                    }
                    // Ctrl+D → send \x04
                    KeyCode::Char('d') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                        let _ = self.pty_pool.write_to_selected(&[0x04]);
                        return Action::None;
                    }
                    // Ctrl+Z → send \x1a
                    KeyCode::Char('z') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                        let _ = self.pty_pool.write_to_selected(&[0x1a]);
                        return Action::None;
                    }
                    // Ctrl+L → send \x0c (clear)
                    KeyCode::Char('l') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                        let _ = self.pty_pool.write_to_selected(&[0x0c]);
                        return Action::None;
                    }
                    // Other Ctrl+<char> → send as control character
                    KeyCode::Char(c) if key.modifiers.contains(KeyModifiers::CONTROL) => {
                        let ctrl_byte = (c as u8).wrapping_sub(b'a').wrapping_add(1);
                        let _ = self.pty_pool.write_to_selected(&[ctrl_byte]);
                        return Action::None;
                    }
                    // Regular characters
                    KeyCode::Char(c) => {
                        let _ = self.pty_pool.write_to_selected(c.to_string().as_bytes());
                        return Action::None;
                    }
                    // Enter → \r
                    KeyCode::Enter => {
                        let _ = self.pty_pool.write_to_selected(b"\r");
                        return Action::None;
                    }
                    // Backspace → DEL (0x7f)
                    KeyCode::Backspace => {
                        let _ = self.pty_pool.write_to_selected(&[0x7f]);
                        return Action::None;
                    }
                    // Arrow keys → ANSI escape sequences
                    KeyCode::Up => {
                        let _ = self.pty_pool.write_to_selected(b"\x1b[A");
                        return Action::None;
                    }
                    KeyCode::Down => {
                        let _ = self.pty_pool.write_to_selected(b"\x1b[B");
                        return Action::None;
                    }
                    KeyCode::Right => {
                        let _ = self.pty_pool.write_to_selected(b"\x1b[C");
                        return Action::None;
                    }
                    KeyCode::Left => {
                        let _ = self.pty_pool.write_to_selected(b"\x1b[D");
                        return Action::None;
                    }
                    // Home/End
                    KeyCode::Home => {
                        let _ = self.pty_pool.write_to_selected(b"\x1b[H");
                        return Action::None;
                    }
                    KeyCode::End => {
                        let _ = self.pty_pool.write_to_selected(b"\x1b[F");
                        return Action::None;
                    }
                    // Delete
                    KeyCode::Delete => {
                        let _ = self.pty_pool.write_to_selected(b"\x1b[3~");
                        return Action::None;
                    }
                    // Page Up/Down
                    KeyCode::PageUp => {
                        let _ = self.pty_pool.write_to_selected(b"\x1b[5~");
                        return Action::None;
                    }
                    KeyCode::PageDown => {
                        let _ = self.pty_pool.write_to_selected(b"\x1b[6~");
                        return Action::None;
                    }
                    _ => {}
                }
            }
        }

        // --- Normal mode (non-Terminal panels) ---

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
            KeyCode::Enter => {
                // In AgentList, Enter attaches to the selected agent
                if self.focused == FocusedPanel::AgentList && !self.pty_pool.is_empty() {
                    return Action::AttachAgent;
                }
                Action::Enter
            }
            // Clone operations
            KeyCode::Char('n') => Action::SpawnClone,
            KeyCode::Char('s') => Action::StopAgent,
            KeyCode::Char('K') => Action::KillClone,
            KeyCode::Char('m') => Action::MergeClone,
            KeyCode::Char('r') => Action::SetReview,
            KeyCode::Char('d') => Action::ShowDiff,
            // Multi-agent operations
            KeyCode::Char('a') => Action::LaunchAgent,
            KeyCode::Char('x') => Action::KillAgent,
            KeyCode::Char('S') => Action::ToggleSettings,
            // File tab navigation (only when FileViewer is focused)
            KeyCode::Char(']') if self.focused == FocusedPanel::FileViewer => Action::NextFileTab,
            KeyCode::Char('[') if self.focused == FocusedPanel::FileViewer => Action::PrevFileTab,
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
                if self.selected_repo > 0 {
                    self.selected_repo -= 1;
                    self.update_current_repo_root();
                    self.clones.clear();
                    self.selected_clone = 0;
                    self.mission_content = None;
                }
            }
            FocusedPanel::AgentList => {
                // Navigate agents in pty_pool if agents exist, else navigate clones
                if !self.pty_pool.is_empty() {
                    let current = self.pty_pool.selected_index();
                    if current > 0 {
                        self.pty_pool.select(current - 1);
                    }
                } else if self.selected_clone > 0 {
                    self.selected_clone -= 1;
                    self.load_selected_mission();
                }
            }
            FocusedPanel::FileViewer => {
                self.file_tabs.scroll_up();
            }
            FocusedPanel::Terminal => {
                // In Terminal mode, Up/Down are forwarded to PTY (handled above).
                // This branch is only reached if no PTY is active.
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
                }
            }
            FocusedPanel::AgentList => {
                // Navigate agents in pty_pool if agents exist, else navigate clones
                if !self.pty_pool.is_empty() {
                    let current = self.pty_pool.selected_index();
                    if current < self.pty_pool.len() - 1 {
                        self.pty_pool.select(current + 1);
                    }
                } else if !self.clones.is_empty() && self.selected_clone < self.clones.len() - 1 {
                    self.selected_clone += 1;
                    self.load_selected_mission();
                }
            }
            FocusedPanel::FileViewer => {
                self.file_tabs.scroll_down();
            }
            FocusedPanel::Terminal => {
                // In Terminal mode, Up/Down are forwarded to PTY (handled above).
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
        }
    }
}

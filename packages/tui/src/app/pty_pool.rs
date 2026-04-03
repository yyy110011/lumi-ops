//! Multi-agent PTY pool — manages concurrent AI agents, each in its own embedded PTY.
//!
//! `PtyPool` wraps a `Vec<AgentInstance>` for clone agents and a separate
//! `home` field for the always-on home CLI session. The Terminal panel
//! renders `pool.active_parser()` and keystrokes go to `pool.write_to_active()`.

use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;

use chrono::{DateTime, Utc};
use uuid::Uuid;

use super::pty::PtyManager;

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/// Which AI driver is running in this PTY.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum DriverName {
    Gemini,
    Claude,
}

/// Observable status of a running agent (derived from PTY output analysis).
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum AgentStatus {
    Running,
    AwaitingInput,
    Completed,
    Error,
    Idle,
}

// ---------------------------------------------------------------------------
// AgentInstance
// ---------------------------------------------------------------------------

/// A single agent running in an embedded PTY.
pub struct AgentInstance {
    #[allow(unused)]
    pub id: Uuid,
    pub clone_branch: String,
    #[allow(unused)]
    pub worktree_path: String,
    pub driver: DriverName,
    pub pty_manager: PtyManager,
    pub parser: Arc<Mutex<vt100::Parser>>,
    pub status: AgentStatus,
    #[allow(unused)]
    pub created_at: DateTime<Utc>,
    pub last_activity: DateTime<Utc>,
    /// Handle for the background reader thread that feeds PTY output into the parser.
    #[allow(unused)]
    pub reader_handle: Option<JoinHandle<()>>,
}

// ---------------------------------------------------------------------------
// PtyPool
// ---------------------------------------------------------------------------

/// Multi-agent PTY pool — like VS Code terminal tabs, each agent has its own PTY.
///
/// The `home` field holds the always-on home CLI session (e.g. `gemini` or `claude`
/// running as a bare interactive agent). Clone agents live in `agents`. The pool
/// tracks which view is active via `viewing_clone`.
pub struct PtyPool {
    /// Always-on home session (independent of clone agents).
    home: Option<AgentInstance>,
    /// Clone agents (launched with 'a' on a specific clone).
    agents: Vec<AgentInstance>,
    /// Selected clone agent index (within `agents` vec).
    selected: usize,
    /// If `true`, the Terminal panel shows a clone agent; if `false`, shows home.
    viewing_clone: bool,
}

impl PtyPool {
    /// Create a new, empty pool.
    pub fn new() -> Self {
        Self {
            home: None,
            agents: Vec::new(),
            selected: 0,
            viewing_clone: false,
        }
    }

    // -----------------------------------------------------------------------
    // Home agent methods
    // -----------------------------------------------------------------------

    /// Spawn the home PTY session (bare interactive agent).
    ///
    /// The home agent runs in the user's CWD, not in a clone worktree.
    /// No log file is created for the home session.
    pub fn spawn_home(
        &mut self,
        driver: DriverName,
        cmd: &str,
        args: &[&str],
        cwd: &str,
        rows: u16,
        cols: u16,
    ) -> anyhow::Result<()> {
        let (pty_manager, reader_handle) =
            PtyManager::spawn(cmd, args, cwd, rows, cols, None)?;
        let parser = Arc::clone(pty_manager.parser());
        let now = Utc::now();

        let agent = AgentInstance {
            id: Uuid::new_v4(),
            clone_branch: "(home)".to_string(),
            worktree_path: cwd.to_string(),
            driver,
            pty_manager,
            parser,
            status: AgentStatus::Running,
            created_at: now,
            last_activity: now,
            reader_handle: Some(reader_handle),
        };

        self.home = Some(agent);
        Ok(())
    }

    /// Get the vt100 parser for the home PTY.
    pub fn home_parser(&self) -> Option<&Arc<Mutex<vt100::Parser>>> {
        self.home.as_ref().map(|a| &a.parser)
    }

    /// Get a reference to the home agent instance.
    #[allow(unused)]
    pub fn home_agent(&self) -> Option<&AgentInstance> {
        self.home.as_ref()
    }

    /// Get a mutable reference to the home agent instance.
    #[allow(unused)]
    pub fn home_agent_mut(&mut self) -> Option<&mut AgentInstance> {
        self.home.as_mut()
    }

    /// Whether the home PTY is alive.
    pub fn has_home(&self) -> bool {
        self.home.is_some()
    }

    // -----------------------------------------------------------------------
    // Active view methods (home vs clone)
    // -----------------------------------------------------------------------

    /// Whether we're currently viewing a clone agent (vs home).
    pub fn is_viewing_clone(&self) -> bool {
        self.viewing_clone
    }

    /// Switch to viewing a specific clone agent by index.
    pub fn attach_clone(&mut self, idx: usize) {
        if !self.agents.is_empty() {
            self.selected = idx.min(self.agents.len() - 1);
            self.viewing_clone = true;
        }
    }

    /// Switch back to viewing the home session.
    pub fn detach_to_home(&mut self) {
        self.viewing_clone = false;
    }

    /// Get the parser for whichever PTY is currently displayed.
    ///
    /// If `viewing_clone`, returns the selected clone agent's parser.
    /// Otherwise, returns the home parser.
    pub fn active_parser(&self) -> Option<&Arc<Mutex<vt100::Parser>>> {
        if self.viewing_clone {
            self.agents.get(self.selected).map(|a| &a.parser)
        } else {
            self.home_parser()
        }
    }

    /// Get a reference to the currently active agent (home or clone).
    #[allow(unused)]
    pub fn active_agent(&self) -> Option<&AgentInstance> {
        if self.viewing_clone {
            self.agents.get(self.selected)
        } else {
            self.home.as_ref()
        }
    }

    /// Write bytes to whichever PTY is currently displayed.
    pub fn write_to_active(&mut self, data: &[u8]) -> anyhow::Result<()> {
        if self.viewing_clone {
            self.write_to_selected(data)
        } else {
            match self.home.as_mut() {
                Some(agent) => {
                    agent.pty_manager.write_bytes(data)?;
                    agent.last_activity = Utc::now();
                    Ok(())
                }
                None => anyhow::bail!("No home agent running"),
            }
        }
    }

    /// Returns `true` if there is any active PTY (home or clone agents).
    pub fn has_any_active(&self) -> bool {
        self.home.is_some() || !self.agents.is_empty()
    }

    // -----------------------------------------------------------------------
    // Clone agent methods (unchanged from original)
    // -----------------------------------------------------------------------

    /// Spawn a new clone agent in its own PTY.
    ///
    /// Returns the index of the newly added agent in the pool.
    pub fn spawn(
        &mut self,
        branch: &str,
        worktree: &str,
        driver: DriverName,
        cmd: &str,
        args: &[&str],
        rows: u16,
        cols: u16,
    ) -> anyhow::Result<usize> {
        let log_path = std::path::Path::new(worktree).join(".lumi").join("agent.log");
        let (pty_manager, reader_handle) =
            PtyManager::spawn(cmd, args, worktree, rows, cols, Some(&log_path))?;
        let parser = Arc::clone(pty_manager.parser());
        let now = Utc::now();

        let agent = AgentInstance {
            id: Uuid::new_v4(),
            clone_branch: branch.to_string(),
            worktree_path: worktree.to_string(),
            driver,
            pty_manager,
            parser,
            status: AgentStatus::Running,
            created_at: now,
            last_activity: now,
            reader_handle: Some(reader_handle),
        };

        self.agents.push(agent);
        let idx = self.agents.len() - 1;

        // Auto-select the newly spawned agent and switch view to it
        self.selected = idx;
        self.viewing_clone = true;

        Ok(idx)
    }

    /// Kill the clone agent at `idx`, dropping the PTY and removing it from the pool.
    ///
    /// If we were viewing the killed agent, auto-detach to home.
    /// This method NEVER touches the home PTY.
    pub fn kill(&mut self, idx: usize) -> anyhow::Result<()> {
        if idx >= self.agents.len() {
            anyhow::bail!("Agent index {} out of range (pool size: {})", idx, self.agents.len());
        }

        // Check if we're viewing the agent being killed
        let was_viewing_killed = self.viewing_clone && self.selected == idx;

        // Remove the agent — dropping PtyManager closes the PTY fd and kills the child.
        let _agent = self.agents.remove(idx);
        // The reader_handle's JoinHandle is dropped here; the reader thread will
        // terminate when the PTY master fd is closed (read returns EOF/error).

        // Adjust selected index to stay in bounds.
        if self.agents.is_empty() {
            self.selected = 0;
            // No more clone agents — fall back to home
            if was_viewing_killed {
                self.viewing_clone = false;
            }
        } else if self.selected >= self.agents.len() {
            self.selected = self.agents.len() - 1;
        }

        // If we were viewing the killed agent, detach to home
        if was_viewing_killed && !self.agents.is_empty() {
            // Stay on clone view but with the adjusted index
        } else if was_viewing_killed {
            self.viewing_clone = false;
        }

        Ok(())
    }

    /// Set the selected clone agent index (bounds-checked, clamped to valid range).
    pub fn select(&mut self, idx: usize) {
        if self.agents.is_empty() {
            self.selected = 0;
        } else {
            self.selected = idx.min(self.agents.len() - 1);
        }
    }

    /// Get the vt100 parser for the currently selected clone agent.
    #[allow(unused)]
    pub fn selected_parser(&self) -> Option<&Arc<Mutex<vt100::Parser>>> {
        self.agents.get(self.selected).map(|a| &a.parser)
    }

    /// Get a reference to the currently selected clone agent.
    pub fn selected_agent(&self) -> Option<&AgentInstance> {
        self.agents.get(self.selected)
    }

    /// Get a mutable reference to the currently selected clone agent.
    pub fn selected_agent_mut(&mut self) -> Option<&mut AgentInstance> {
        self.agents.get_mut(self.selected)
    }

    /// Get a slice of all clone agents.
    pub fn agents(&self) -> &[AgentInstance] {
        &self.agents
    }

    /// Get a mutable slice of all clone agents.
    #[allow(unused)]
    pub fn agents_mut(&mut self) -> &mut [AgentInstance] {
        &mut self.agents
    }

    /// Number of clone agents in the pool.
    pub fn len(&self) -> usize {
        self.agents.len()
    }

    /// Whether the pool has no clone agents.
    pub fn is_empty(&self) -> bool {
        self.agents.is_empty()
    }

    /// The currently selected clone agent index.
    pub fn selected_index(&self) -> usize {
        self.selected
    }

    /// Find a clone agent's index by its clone branch name.
    #[allow(unused)]
    pub fn find_by_branch(&self, branch: &str) -> Option<usize> {
        self.agents.iter().position(|a| a.clone_branch == branch)
    }

    /// Write bytes to the selected clone agent's PTY.
    pub fn write_to_selected(&mut self, data: &[u8]) -> anyhow::Result<()> {
        match self.agents.get_mut(self.selected) {
            Some(agent) => {
                agent.pty_manager.write_bytes(data)?;
                agent.last_activity = Utc::now();
                Ok(())
            }
            None => anyhow::bail!("No agent selected (pool is empty)"),
        }
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_pool_is_empty() {
        let pool = PtyPool::new();
        assert!(pool.is_empty());
        assert_eq!(pool.len(), 0);
        assert_eq!(pool.selected_index(), 0);
        assert!(pool.agents().is_empty());
        assert!(!pool.has_home());
        assert!(!pool.is_viewing_clone());
    }

    #[test]
    fn select_on_empty_pool_stays_zero() {
        let mut pool = PtyPool::new();
        pool.select(5);
        assert_eq!(pool.selected_index(), 0);
        pool.select(0);
        assert_eq!(pool.selected_index(), 0);
    }

    #[test]
    fn find_by_branch_returns_none_on_empty_pool() {
        let pool = PtyPool::new();
        assert_eq!(pool.find_by_branch("feat/auth"), None);
    }

    #[test]
    fn selected_parser_returns_none_on_empty_pool() {
        let pool = PtyPool::new();
        assert!(pool.selected_parser().is_none());
    }

    #[test]
    fn selected_agent_returns_none_on_empty_pool() {
        let pool = PtyPool::new();
        assert!(pool.selected_agent().is_none());
    }

    #[test]
    fn selected_agent_mut_returns_none_on_empty_pool() {
        let mut pool = PtyPool::new();
        assert!(pool.selected_agent_mut().is_none());
    }

    #[test]
    fn write_to_selected_errors_on_empty_pool() {
        let mut pool = PtyPool::new();
        let result = pool.write_to_selected(b"hello");
        assert!(result.is_err());
    }

    #[test]
    fn kill_out_of_bounds_errors() {
        let mut pool = PtyPool::new();
        let result = pool.kill(0);
        assert!(result.is_err());
    }

    #[test]
    fn active_parser_returns_none_when_no_home() {
        let pool = PtyPool::new();
        assert!(pool.active_parser().is_none());
    }

    #[test]
    fn home_parser_returns_none_without_home() {
        let pool = PtyPool::new();
        assert!(pool.home_parser().is_none());
    }

    #[test]
    fn has_any_active_false_when_empty() {
        let pool = PtyPool::new();
        assert!(!pool.has_any_active());
    }

    #[test]
    fn attach_clone_noop_on_empty_agents() {
        let mut pool = PtyPool::new();
        pool.attach_clone(0);
        // Should stay viewing home since no agents exist
        assert!(!pool.is_viewing_clone());
    }

    #[test]
    fn detach_to_home_sets_viewing_clone_false() {
        let mut pool = PtyPool::new();
        pool.viewing_clone = true;
        pool.detach_to_home();
        assert!(!pool.is_viewing_clone());
    }

    #[test]
    fn write_to_active_errors_when_no_home_and_not_viewing_clone() {
        let mut pool = PtyPool::new();
        let result = pool.write_to_active(b"hello");
        assert!(result.is_err());
    }

    #[test]
    fn active_agent_returns_none_when_empty() {
        let pool = PtyPool::new();
        assert!(pool.active_agent().is_none());
    }
}

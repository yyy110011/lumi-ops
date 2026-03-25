//! Multi-agent PTY pool — manages concurrent AI agents, each in its own embedded PTY.
//!
//! `PtyPool` wraps a `Vec<AgentInstance>`, each of which owns a `PtyManager` + `vt100::Parser`.
//! The Terminal panel renders `pool.selected_parser()` and keystrokes go to
//! `pool.write_to_selected()`.

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
pub struct PtyPool {
    agents: Vec<AgentInstance>,
    selected: usize,
}

impl PtyPool {
    /// Create a new, empty pool.
    pub fn new() -> Self {
        Self {
            agents: Vec::new(),
            selected: 0,
        }
    }

    /// Spawn a new agent in its own PTY.
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

        // Auto-select the newly spawned agent
        self.selected = idx;

        Ok(idx)
    }

    /// Kill the agent at `idx`, dropping the PTY and removing it from the pool.
    pub fn kill(&mut self, idx: usize) -> anyhow::Result<()> {
        if idx >= self.agents.len() {
            anyhow::bail!("Agent index {} out of range (pool size: {})", idx, self.agents.len());
        }

        // Remove the agent — dropping PtyManager closes the PTY fd and kills the child.
        let _agent = self.agents.remove(idx);
        // The reader_handle's JoinHandle is dropped here; the reader thread will
        // terminate when the PTY master fd is closed (read returns EOF/error).

        // Adjust selected index to stay in bounds.
        if self.agents.is_empty() {
            self.selected = 0;
        } else if self.selected >= self.agents.len() {
            self.selected = self.agents.len() - 1;
        }

        Ok(())
    }

    /// Set the selected agent index (bounds-checked, clamped to valid range).
    pub fn select(&mut self, idx: usize) {
        if self.agents.is_empty() {
            self.selected = 0;
        } else {
            self.selected = idx.min(self.agents.len() - 1);
        }
    }

    /// Get the vt100 parser for the currently selected agent.
    pub fn selected_parser(&self) -> Option<&Arc<Mutex<vt100::Parser>>> {
        self.agents.get(self.selected).map(|a| &a.parser)
    }

    /// Get a reference to the currently selected agent.
    pub fn selected_agent(&self) -> Option<&AgentInstance> {
        self.agents.get(self.selected)
    }

    /// Get a mutable reference to the currently selected agent.
    pub fn selected_agent_mut(&mut self) -> Option<&mut AgentInstance> {
        self.agents.get_mut(self.selected)
    }

    /// Get a slice of all agents.
    pub fn agents(&self) -> &[AgentInstance] {
        &self.agents
    }

    /// Get a mutable slice of all agents.
    #[allow(unused)]
    pub fn agents_mut(&mut self) -> &mut [AgentInstance] {
        &mut self.agents
    }

    /// Number of agents in the pool.
    pub fn len(&self) -> usize {
        self.agents.len()
    }

    /// Whether the pool has no agents.
    pub fn is_empty(&self) -> bool {
        self.agents.is_empty()
    }

    /// The currently selected index.
    pub fn selected_index(&self) -> usize {
        self.selected
    }

    /// Find an agent's index by its clone branch name.
    #[allow(unused)]
    pub fn find_by_branch(&self, branch: &str) -> Option<usize> {
        self.agents.iter().position(|a| a.clone_branch == branch)
    }

    /// Write bytes to the selected agent's PTY.
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
}

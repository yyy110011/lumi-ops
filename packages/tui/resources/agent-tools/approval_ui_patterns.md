# TmuxCC — Approval UI Patterns

> **Repo:** https://github.com/nyanko3141592/tmuxcc
> **License:** MIT
> **Tech Stack:** Rust, ratatui 0.29, crossterm 0.28, tokio, parking_lot, sysinfo
> **Binary:** `tmuxcc` (v0.1.7)

## Architecture Overview

A **focused** TUI for approval management — the smallest Rust tool in this survey (~30 source files). Its primary innovation is centralized approval/rejection of AI agent requests across multiple tmux panes.

```
src/
├── agents/
│   ├── mod.rs          # Agent detection and content parsing
│   ├── subagent.rs     # Subagent (Task tool) detection
│   └── types.rs        # AgentType, AgentStatus, ApprovalType, MonitoredAgent
├── app/
│   ├── mod.rs          # Main app loop (tokio + crossterm events)
│   ├── state.rs        # AppState, AgentTree, FocusedPanel
│   ├── actions.rs      # Action enum (Approve, Reject, ApproveAll, etc.)
│   └── config.rs       # TOML config (polling, capture lines, custom patterns)
├── monitor/
│   ├── mod.rs          # Background monitoring loop
│   ├── task.rs         # Async monitoring task
│   └── system_stats.rs # CPU/memory via sysinfo
├── parsers/
│   ├── claude_code.rs  # Claude Code output parser
│   ├── codex_cli.rs    # Codex CLI parser
│   ├── gemini_cli.rs   # Gemini CLI parser
│   └── opencode.rs     # OpenCode parser
├── tmux/
│   ├── client.rs       # tmux CLI wrapper (list-panes, send-keys, capture-pane)
│   └── pane.rs         # TmuxPane data model
└── ui/
    ├── app.rs          # Main render loop
    ├── layout.rs       # Responsive layout (sidebar + preview)
    ├── styles.rs       # Color scheme
    └── components/
        ├── agent_tree.rs    # Hierarchical tree view
        ├── pane_preview.rs  # Live pane content preview
        ├── header.rs        # Status header
        ├── footer.rs        # Keybinding help
        ├── help.rs          # Help overlay
        ├── input.rs         # Text input component
        └── subagent_log.rs  # Subagent activity log
```

## Unique Patterns

### 1. ApprovalType Classification

TmuxCC classifies pending requests by type, enabling smart key handling:

```rust
pub enum ApprovalType {
    FileEdit,
    FileCreate,
    FileDelete,
    ShellCommand,
    McpTool,
    UserQuestion { choices: Vec<String>, selected: Option<usize> },
    Other(String),
}
```

The `UserQuestion` variant is special: it carries choice options (e.g., `[1] Yes, [2] No, [3] Skip`) and allows selection by number key.

### 2. Batch Approval Operations

```rust
pub enum Action {
    Approve,          // Approve current or all selected
    Reject,           // Reject current or all selected
    ApproveAll,       // Approve ALL pending requests globally
    ToggleSelection,  // Multi-select via Space
    SelectAll,        // Select all agents
    ClearSelection,   // Deselect all
    SendNumber(u8),   // Send choice number (for UserQuestion)
    SendInput,        // Send text to agent's tmux pane
    // ...
}
```

Workflow:
1. Select multiple agents (Space to toggle, Ctrl+A to select all)
2. Press `Y` to approve all selected, or `N` to reject
3. Or press `A` to approve *all* pending globally (skip selection)

### 3. AgentStatus with Needs-Attention Flag

```rust
pub enum AgentStatus {
    Idle,
    Processing { activity: String },
    AwaitingApproval { approval_type: ApprovalType, details: String },
    Error { message: String },
    Unknown,
}

impl AgentStatus {
    pub fn needs_attention(&self) -> bool {
        matches!(self, AwaitingApproval { .. } | Error { .. })
    }
    
    pub fn indicator(&self) -> &str {
        match self {
            Idle => "●",
            Processing { .. } => "◐",
            AwaitingApproval { .. } => "⚠",
            Error { .. } => "✗",
            Unknown => "?",
        }
    }
}
```

### 4. Subagent Tracking

TmuxCC detects Claude's Task tool (subagent spawning) from pane content:

```rust
pub struct Subagent {
    pub name: String,
    pub status: SubagentStatus,
    pub description: String,
}

pub enum SubagentStatus {
    Running,
    Completed,
    Failed,
}
```

Displayed in a collapsible log panel.

### 5. Hierarchical Agent Tree

```rust
pub struct AgentTree {
    pub root_agents: Vec<MonitoredAgent>,
}

impl AgentTree {
    pub fn total_count(&self) -> usize;     // Including subagents
    pub fn active_count(&self) -> usize;    // Needing attention
    pub fn processing_count(&self) -> usize;
    pub fn running_subagent_count(&self) -> usize;
}
```

Tree display organized by Session → Window → Pane, with subagents nested under their parent agent.

### 6. MonitoredAgent Model

```rust
pub struct MonitoredAgent {
    pub id: String,
    pub target: String,           // "main:0.1"
    pub session: String,
    pub window: u32,
    pub window_name: String,
    pub pane: u32,
    pub path: String,
    pub agent_type: AgentType,    // ClaudeCode, OpenCode, CodexCli, GeminiCli
    pub status: AgentStatus,
    pub subagents: Vec<Subagent>,
    pub last_content: String,
    pub pid: u32,
    pub started_at: Instant,
    pub last_updated: Instant,
    pub context_remaining: Option<u8>,  // 0-100%
}
```

Notable: `context_remaining` tracks Claude's remaining context window percentage (detected from pane output).

### 7. Input Forwarding

The input panel allows typing text that gets sent to the selected agent's tmux pane via `tmux send-keys`. This enables responding to agent questions without leaving the TUI.

### 8. Per-Agent Parser Strategy

```
src/parsers/
├── claude_code.rs   # Regex patterns for Claude Code output
├── codex_cli.rs     # Codex-specific patterns
├── gemini_cli.rs    # Gemini-specific patterns
└── opencode.rs      # OpenCode-specific patterns
```

Each parser knows the output format of its agent type and extracts status, activity description, and approval details.

## Code Snippets Worth Borrowing

- **`src/agents/types.rs`** — Complete `AgentStatus`, `ApprovalType`, `MonitoredAgent` model.
- **`src/app/actions.rs`** — Clean Action enum with description method.
- **`src/app/state.rs`** — `AppState` with `AgentTree`, multi-select, resizable sidebar.
- **`src/parsers/claude_code.rs`** — Claude Code pane output parser.
- **`src/agents/subagent.rs`** — Subagent detection from pane content.
- **`src/ui/components/agent_tree.rs`** — Hierarchical tree rendering.

## Relevance to Lumi TUI

| Feature | Relevance |
|---------|-----------|
| Approval workflow (Y/N/A) | **High** — Maps directly to our review protocol (approve/reject/revise) |
| Batch operations | **High** — Managing multiple clones simultaneously |
| ApprovalType classification | **High** — Could adapt for our review status categories |
| Subagent tracking | **Medium** — Could track sub-tasks within a clone |
| Context remaining % | **Medium** — Useful status indicator |
| Input forwarding | **Medium** — Send messages to agent's pane |
| Per-agent parsers | **Medium** — We'd need per-agent output parsing |

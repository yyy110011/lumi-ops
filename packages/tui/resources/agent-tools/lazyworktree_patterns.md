# lazyworktree — Patterns

> **Repo:** https://github.com/chmouel/lazyworktree
> **License:** Apache 2.0
> **Tech Stack:** Go 1.25, BubbleTea v2, Lipgloss v2, fsnotify
> **Binary:** `lazyworktree`

## Architecture Overview

A **keyboard-first worktree TUI** built with BubbleTea. The most complete worktree management tool, with deep CI/PR integration and agent session awareness. Well-structured codebase with clear separation of concerns.

```
internal/
├── app/
│   ├── commands/         # Command palette (registry, palette UI)
│   ├── handlers/         # Input handler dispatch (diff, etc.)
│   ├── screen/           # Screen stack (checklist, commit, confirm, help, etc.)
│   ├── services/         # Business logic services
│   │   ├── agent_processes.go  # Live process detection for agents
│   │   ├── agent_sessions.go   # Transcript-based session discovery
│   │   ├── agent_watch.go      # File watcher for agent changes
│   │   ├── ci_cache.go         # CI result caching
│   │   ├── ci_data.go          # CI status icons and sorting
│   │   ├── ci_fetch.go         # GitHub Actions / GitLab CI fetcher
│   │   ├── status_tree.go      # Git status tree builder
│   │   └── worktree.go         # Worktree CRUD operations
│   └── state/            # View state management
├── config/               # YAML config with gitconfig integration
├── models/               # Data models (worktree, agent_session, CI checks)
├── multiplexer/          # tmux, zellij, container (docker/podman)
├── security/             # Trust system for custom commands
└── theme/                # Auto-detect dark/light theme
```

## Unique Patterns

### 1. CI/PR Status Integration

lazyworktree is the only tool that integrates CI pipeline status directly into the worktree view.

#### CI Data Model

```go
// internal/models/status.go
type CICheck struct {
    Name       string
    Status     string    // success, failure, pending, skipped, cancelled
    Link       string    // URL to CI run
    StartedAt  time.Time
    FinishedAt time.Time
}

type PRInfo struct {
    Number    int
    Title     string
    State     string    // open, closed, merged
    URL       string
    IsDraft   bool
    CIChecks  []*CICheck
}
```

#### CI Fetch Service

Three-tier caching:
1. In-memory cache with TTL
2. Background fetch to avoid blocking UI
3. Rate limiting to respect API quotas

```go
type CIFetchService interface {
    // Fetch CI checks for a branch (GitHub Actions or GitLab CI)
    FetchChecks(owner, repo, branch string) ([]*CICheck, error)
    // Fetch PR info including CI status
    FetchPR(owner, repo string, number int) (*PRInfo, error)
}
```

Supports both **GitHub Actions** and **GitLab CI** by detecting the remote URL.

#### CI Status Icons

```go
func StatusIcon(status string, isDraft, useIcons bool, ...) string {
    if isDraft { return "D" }
    switch status {
    case "success":   return "S"  // or nerd font icon
    case "failure":   return "F"
    case "pending":   return "P"
    case "skipped":   return "-"
    case "cancelled": return "C"
    }
}
```

### 2. Agent Session Discovery (Transcript-Based)

Discovers Claude and pi sessions by scanning transcript files on disk:

```go
type AgentSession struct {
    ID             string
    Agent          AgentKind           // Claude, Pi
    JSONLPath      string              // Path to transcript file
    CWD            string
    Model          string
    GitBranch      string
    DisplayName    string
    LastPromptText string
    LastReplyText  string
    TaskLabel      string
    CurrentTool    string
    Status         AgentSessionStatus  // running, idle, waiting, finished
    Activity       AgentActivity       // reading, writing, running, searching, browsing, spawning
    IsOpen         bool                // Matched to live process
    OpenConfidence AgentOpenConfidence // exact, cwd, none
}
```

#### Discovery Strategy

1. Scan `~/.claude/projects/` for JSONL transcripts
2. Scan pi session directory for pi transcripts
3. Parse last few lines of JSONL to extract status, model, last tool
4. Match against live processes (`ps` output) for `IsOpen` detection
5. Confidence levels: `exact` (transcript open), `cwd` (directory match), `none`

#### Activity Tracking

```go
const (
    AgentActivityReading   = "reading"
    AgentActivityWriting   = "writing"
    AgentActivityRunning   = "running"
    AgentActivitySearching = "searching"
    AgentActivityBrowsing  = "browsing"
    AgentActivitySpawning  = "spawning"
)
```

### 3. Command Palette

k9s-style command palette (`?` key) with fuzzy search:

```go
type CommandRegistry struct {
    commands map[string]Command
}

type Command struct {
    Name        string
    Description string
    Key         string   // Keyboard shortcut
    Action      func()
    Hidden      bool     // Only visible in palette (prefixed with _)
}
```

Custom commands can be defined in config and bound to keys or shown only in the palette.

### 4. Worktree Metadata System

Rich per-worktree metadata: description, color, icon, tags, notes (markdown), tasks (checklist).

### 5. Security Trust System

```go
// internal/security/trust.go
```

Custom commands require explicit user trust before execution — prevents malicious `.wt` hook files.

### 6. Shell Integration

```bash
cd "$(lazyworktree)"  # Jump to selected worktree
```

Shell completion for bash, zsh, and fish.

## Code Snippets Worth Borrowing

- **`internal/app/services/ci_fetch.go`** — CI pipeline status fetching (GitHub Actions + GitLab).
- **`internal/app/services/ci_data.go`** — CI status icon mapping and sorting.
- **`internal/app/services/agent_sessions.go`** — Transcript-based agent session discovery.
- **`internal/models/agent_session.go`** — Rich agent session model with activity tracking.
- **`internal/app/commands/registry.go`** — Command palette registry pattern.
- **`internal/app/services/agent_processes.go`** — Live process matching for agents.

## Relevance to Lumi TUI

| Feature | Relevance |
|---------|-----------|
| CI/PR status integration | **High** — Could show PR/CI status alongside worktrees |
| Agent session discovery | **High** — Transcript-based detection complements our file protocol |
| Activity tracking enum | **High** — Rich status beyond just running/idle |
| Command palette | **Medium** — Nice UX pattern for action discovery |
| Worktree metadata | **Medium** — Our `.lumi-metadata.json` serves similar purpose |
| Trust system | **Low** — We don't execute arbitrary hooks |

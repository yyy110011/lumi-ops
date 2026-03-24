# claude-dashboard — Patterns

> **Repo:** https://github.com/seunggabi/claude-dashboard
> **License:** MIT
> **Tech Stack:** Go 1.24, BubbleTea, Lipgloss, charmbracelet/bubbles
> **Binary:** `claude-dashboard`

## Architecture Overview

A **k9s-inspired TUI** for managing Claude Code sessions via tmux. Focused and minimal — ~20 Go source files. Key architectural choice: process-based session detection rather than file-based.

```
internal/
├── app/          # BubbleTea model (Init, Update, View)
├── config/       # YAML config for session prefix, poll interval
├── conversation/ # JSONL transcript reader
├── monitor/      # Process table scanning (ps -eo)
├── session/      # Session model, detector, manager
├── setup/        # Auto-configures tmux (mouse mode, status bar, helpers)
├── styles/       # Lipgloss styles (k9s color scheme)
├── tmux/         # tmux CLI client wrapper
└── ui/           # Dashboard, detail, logs, help, statusbar views
```

## Unique Patterns

### 1. Dual Detection: tmux + Terminal Processes

claude-dashboard doesn't just scan tmux sessions. It also scans the process table (`ps -eo pid,ppid,tty,args`) to detect Claude processes running outside tmux (in plain terminals):

```go
// Session types
type Session struct {
    Name      string
    Project   string
    Status    Status    // active | idle | waiting | unknown | terminal
    StartedAt time.Time
    Activity  time.Time
    Attached  bool
    PID       string
    CPU       float64
    Memory    float64
    Path      string
    Managed   bool      // true = tmux (can attach/detach), false = terminal (read-only)
}
```

Process deduplication: tmux PIDs are collected first, then terminal detection skips those PIDs.

### 2. Process Table Scanning

```go
func (d *Detector) DetectTerminalSessions(tmuxPIDs map[string]bool) []Session {
    cmd := exec.Command("ps", "-eo", "pid,ppid,tty,args")
    // Parse output, filter for claude processes, skip tmux PIDs
}
```

Uses hierarchical PID matching via `buildProcChildren()` to find child processes of tmux sessions.

### 3. Conversation Log Reader

Reads Claude's JSONL transcript files to show conversation history in the TUI:

```
internal/conversation/reader.go
```

Parses Claude's session transcript format to extract human/assistant messages for display.

### 4. k9s-Style Table Layout

The dashboard mimics k9s with:
- Fixed-width columns (#, STATUS, UPTIME, CPU, MEM)
- Flexible-width columns (NAME, PATH) that auto-fill remaining space
- Scroll indicators (▲ ▼) when content exceeds viewport
- Color-coded rows by status (green=active, yellow=waiting, gray=idle)

```go
var DashboardColumns = []struct {
    Title string
    Width int
}{
    {"#", 4},
    {"NAME", 0},      // flexible
    {"PROJECT", 35},
    {"STATUS", 12},
    {"UPTIME", 10},
    {"CPU", 8},
    {"MEM", 8},
    {"PATH", 0},      // flexible
}
```

### 5. tmux Auto-Setup

On first run, claude-dashboard auto-configures tmux:
- Installs helper scripts to `~/.local/bin/`
- Configures `~/.tmux.conf` (mouse toggle, history save)
- Adds status bar with version info

### 6. Session Manager with Input Validation

```go
const dangerousShellChars = "`;|&(){}$<>\n\r"

func validateClaudeArgs(args string) error {
    if strings.ContainsAny(args, dangerousShellChars) {
        return fmt.Errorf("claudeArgs contains dangerous shell characters")
    }
    return nil
}
```

Shell injection prevention when creating sessions with custom Claude arguments.

## Code Snippets Worth Borrowing

- **`internal/session/detector.go`** — Dual detection pattern (tmux + terminal processes).
- **`internal/session/session.go`** — Clean Session model with status display helpers.
- **`internal/ui/dashboard.go`** — k9s-style flexible table layout with scroll indicators.
- **`internal/styles/styles.go`** — Cohesive k9s-inspired color scheme.
- **`internal/monitor/process.go`** — Process table construction and child PID mapping.

## Relevance to Lumi TUI

| Feature | Relevance |
|---------|-----------|
| Process table detection | **High** — Detect running agents even outside tmux |
| k9s-style table layout | **High** — Design inspiration for our clone status panel |
| Conversation reader | **Medium** — Could show agent conversation in preview pane |
| Session CRUD via tmux | **Medium** — We have similar tmux session management needs |
| tmux auto-setup | **Low** — Nice UX pattern but not critical |

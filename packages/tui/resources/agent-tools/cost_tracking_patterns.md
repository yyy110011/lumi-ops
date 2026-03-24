# agent-deck — Cost Tracking Patterns

> **Repo:** https://github.com/asheshgoplani/agent-deck
> **License:** MIT
> **Tech Stack:** Go 1.24, BubbleTea, Lipgloss, SQLite (modernc.org), fsnotify
> **Binary:** `agent-deck`

## Architecture Overview

agent-deck is the **most feature-rich** tool in this survey — a full "AI agent command center" with TUI, web dashboard, conductor (Telegram bridge), MCP proxy, session forking, and comprehensive cost tracking. It's significantly larger than the other tools.

```
internal/
├── costs/           # Cost computation engine (SQLite, parsers, pricing, budget)
├── session/         # Session storage (SQLite), instance model, worktree support
├── statedb/         # State database abstraction
├── ui/              # BubbleTea TUI (home, list, preview, dialogs, settings)
├── web/             # HTTP web dashboard (WebSocket, push notifications)
├── hooks/           # Git hooks integration
├── logging/         # Structured logging by component
├── update/          # Self-update mechanism
└── mcp/             # MCP tool server proxy
conductor/           # Telegram bridge (Python) for remote agent control
```

## Unique Patterns: Cost Tracking System

### 1. Cost Data Model (Microdollars)

agent-deck stores costs in **microdollars** (millionths of a dollar) for precision without floating-point errors:

```go
type CostEvent struct {
    ID                string
    SessionID         string
    Timestamp         time.Time
    Model             string
    InputTokens       int64
    OutputTokens      int64
    CacheReadTokens   int64
    CacheWriteTokens  int64
    CostMicrodollars  int64  // 1 USD = 1,000,000 microdollars
}

type CostSummary struct {
    TotalCostMicrodollars int64
    EventCount            int
}

type SessionCost struct {
    SessionID        string
    SessionTitle     string
    GroupPath        string
    CostMicrodollars int64
    EventCount       int
}
```

### 2. SQLite Cost Store

All cost data is persisted in SQLite with time-windowed aggregation queries:

```go
// Time-windowed queries
TotalToday()     // WHERE timestamp >= date('now', 'start of day')
TotalThisWeek()  // WHERE timestamp >= date('now', 'weekday 1', '-7 days')
TotalThisMonth() // WHERE timestamp >= date('now', 'start of month')

// Analysis queries
TopSessionsByCost(limit int)   // Top N sessions by total cost
CostByModel()                  // Breakdown by model name
ProjectedMonthly()             // Linear projection from this month's data
```

### 3. Multi-Provider Transcript Parsers

Separate parsers for each AI provider's transcript format:

```
internal/costs/
├── parser_claude.go   # Parse Claude conversation JSONL
├── parser_gemini.go   # Parse Gemini transcript format
├── parser_openai.go   # Parse OpenAI/Codex transcript format
├── pricing.go         # Per-model pricing table with user overrides
└── sync.go            # Batch sync from transcripts to SQLite
```

### 4. Pricing Engine with User Overrides

```go
type PricerConfig struct {
    Overrides map[string]PriceOverride
}

type PriceOverride struct {
    InputPerMtok      float64  // $/million tokens
    OutputPerMtok     float64
    CacheReadPerMtok  float64
    CacheWritePerMtok float64
}
```

The pricing engine has built-in defaults for known models and supports user-configurable overrides via `config.toml`.

### 5. Cost Sync Pipeline

```go
func SyncFromTranscripts(store *Store, pricer *Pricer, sessions []SyncSession) SyncResult {
    // 1. For each session, find the JSONL transcript file
    // 2. Parse transcript entries (model, tokens used)
    // 3. Calculate cost using Pricer
    // 4. Write CostEvent to SQLite (deduplicated by event ID)
}
```

### 6. Budget Alerts

```
internal/costs/budget.go
```

Supports configurable budget thresholds with alerts when spending approaches limits.

### 7. Real-time Cost Watcher

```
internal/costs/watcher.go     # File-system watcher for new transcripts
internal/costs/poller.go      # Polling fallback for environments without inotify
internal/costs/collector.go   # Aggregates cost events from watcher + poller
```

Two-strategy approach: inotify/fsnotify for immediate detection, with polling fallback for network filesystems (9p, NFS, WSL).

## Other Unique Features

### Conductor (Remote Agent Control)

A Python-based Telegram bridge that allows controlling agent sessions remotely:
- Forward Telegram messages → agent-deck conductor session
- Forward agent responses → Telegram
- Periodic heartbeat for status checks
- Multi-profile support

### Session Forking

Press `f` to fork any Claude conversation — each fork inherits full conversation history.

### Web Dashboard

Full HTTP web dashboard with WebSocket real-time updates and push notifications.

### MCP Proxy

`internal/mcp/` — Proxies MCP tool calls, enabling session sharing across agents.

### Storage Watcher (Polling-based)

Replaced fsnotify with SQLite metadata timestamp polling for cross-filesystem reliability:

```go
const pollInterval = 2 * time.Second
const ignoreWindow = 3 * time.Second  // Ignore self-triggered changes
```

## Code Snippets Worth Borrowing

- **`internal/costs/store.go`** — SQLite cost event storage with time-windowed queries.
- **`internal/costs/pricing.go`** — Per-model pricing table with override mechanism.
- **`internal/costs/sync.go`** — Batch transcript-to-cost sync pipeline.
- **`internal/ui/storage_watcher.go`** — Polling-based change detection (more reliable than fsnotify).
- **`cmd/agent-deck/costs_cmd.go`** — CLI cost summary with projected monthly spend.

## Relevance to Lumi TUI

| Feature | Relevance |
|---------|-----------|
| Cost tracking system | **High** — Key differentiator we can adopt for our TUI |
| Microdollar precision | **High** — Correct way to handle money in software |
| Multi-provider parsers | **High** — We support multiple agent types too |
| SQLite store pattern | **Medium** — We might use file-based storage instead |
| Conductor (Telegram) | **Low** — Interesting but out of scope for v0.6 |
| Web dashboard | **Low** — We're TUI-focused |

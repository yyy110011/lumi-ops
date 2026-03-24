---
name: agent-tools-survey
description: Condensed survey of 6 agent dashboard tools (workmux, claude-dashboard, agent-deck, lazyworktree, TmuxCC, AoE). Patterns prioritized for Lumi-TUI adoption.
---

# Agent Dashboard Tools — Survey Reference

> 6 tools analyzed at source-code level. All are MIT/Apache 2.0 licensed.

## Comparison Matrix

| Feature | workmux | claude-dashboard | agent-deck | lazyworktree | TmuxCC | AoE |
|---------|:-------:|:----------------:|:----------:|:------------:|:------:|:---:|
| **Language** | Rust | Go | Go | Go | Rust | Rust |
| **TUI Framework** | ratatui | BubbleTea | BubbleTea | BubbleTea v2 | ratatui | ratatui |
| **Worktree mgmt** | ✅ | ❌ | ✅ | ✅ | ❌ | ✅ |
| **Multi-agent** | ✅ | Claude | ✅ | Claude+pi | 4 agents | 8 agents |
| **Approval UI** | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| **Cost tracking** | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ |
| **CI/PR status** | GH | ❌ | ❌ | GH+GL | ❌ | ❌ |
| **Docker sandbox** | Lima | ❌ | ❌ | Docker/Podman | ❌ | ✅ |
| **Mux abstraction** | 4 backends | tmux | tmux | tmux+zellij | tmux | tmux |
| **Conversation reader** | ❌ | ✅ | ❌ | ✅ | ❌ | ❌ |

---

## Must-Adopt Patterns (Top 5)

### 1. Status Poller — Background Non-Blocking Detection (AoE, workmux)

The TUI sends the current instance list to a background thread via `mpsc::Sender`, the poller runs `tmux capture-pane` + regex parsing on that thread, and returns `StatusUpdate { id, status }` via a result channel. The UI never blocks on subprocess calls. AoE adds container health checks with rate-limited batch queries (5s interval, all containers in one call). **This is the foundation of any responsive agent dashboard.**

### 2. Multiplexer Abstraction Trait (workmux)

workmux defines a `Multiplexer` trait with implementations for tmux, wezterm, kitty, and zellij. Each exposes `AgentPane { session, pane_id, worktree_path, status, status_ts }` and `AgentStatus { Active, Idle, Waiting }`. This lets the dashboard work on any terminal multiplexer. Key types live in `src/multiplexer/agent.rs`. **Start with tmux-only, but design the trait boundary now.**

### 3. Stable Selection Tracking by ID (workmux)

Track `selected_pane_id: Option<String>` instead of `selected_index: usize`. After each list refresh, restore cursor position by searching for the saved ID. This prevents the selection from jumping when agents appear/disappear. **Must-have for any live-updating list in ratatui.**

### 4. Event-Driven Architecture with `AppEvent` (workmux)

All background results flow through a single typed channel: `AppEvent::AgentList(Vec<AgentPane>)`, `AppEvent::WorktreeList(...)`, `AppEvent::Error(...)`. The main loop drains events with `try_recv()` and applies them to cached state. `AtomicBool` flags prevent concurrent fetches for the same data source. **Proven pattern for separating IO from rendering.**

### 5. Batch Approval Workflow (TmuxCC)

Multi-select agents with `Space`/`Ctrl+A`, then `Y` to approve all or `N` to reject. Maps directly to our review protocol: `needsReview` → approve (done) / reject (needsRevision). TmuxCC classifies requests via `ApprovalType { FileEdit, ShellCommand, McpTool, UserQuestion { choices } }` which enables smart key handling (number keys for choices). **Adopt the batch select + Y/N/A pattern for clone review management.**

---

## Status Detection Approaches

| Approach | Tools | Method | Pros | Cons |
|----------|-------|--------|------|------|
| **Pane content** | workmux, TmuxCC, AoE | `tmux capture-pane -p -e -J` → regex | Real-time, agent-agnostic | Brittle to output format changes |
| **Process table** | claude-dashboard | `ps -eo pid,ppid,tty,args` → PID tree | Detects agents outside tmux | Platform-specific, no status detail |
| **Transcript file** | lazyworktree, agent-deck | Parse `~/.claude/projects/` JSONL | Rich metadata (model, tokens, tools) | Claude-specific, read latency |
| **Hybrid** | lazyworktree | Transcript + process matching | Confidence levels (exact/cwd/none) | Complex implementation |

**Recommendation:** Start with **pane content analysis** (matches our tmux-based v0.6 Drivers). Design status detection as a `trait StatusDetector` so transcript-based and process-based strategies can be added later.

---

## Cost Tracking Architecture (agent-deck)

**Core principle:** Store costs in **microdollars** (i64, 1 USD = 1,000,000) to avoid floating-point errors.

**Data flow:**
```
Transcript files (JSONL) → Parser (per-provider) → Pricer (model→rate lookup) → CostEvent → SQLite
```

**Key types:**
- `CostEvent { session_id, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_microdollars }`
- `CostSummary { total_cost_microdollars, event_count }`

**SQLite queries:** `TotalToday()`, `TotalThisWeek()`, `TotalThisMonth()`, `TopSessionsByCost(N)`, `CostByModel()`, `ProjectedMonthly()` — all use `WHERE timestamp >= date(...)`.

**Pricing engine:** Built-in per-model rates + user override via config. Supports Claude, Gemini, OpenAI with separate parsers (`parser_claude.go`, `parser_gemini.go`, `parser_openai.go`).

**Real-time detection:** Two strategies — `fsnotify` watcher for immediate detection + polling fallback (2s) for network filesystems.

---

## Approval/Review UI Pattern (TmuxCC)

TmuxCC's approval workflow maps to our review protocol:

| TmuxCC Action | Lumi-Ops Equivalent |
|---------------|---------------------|
| `AwaitingApproval` status | `needsReview` review status |
| `Y` (Approve) | Set status → `done`, merge clone |
| `N` (Reject) | `request_revision` → `needsRevision` |
| `A` (Approve All) | Batch approve all `needsReview` clones |
| `Space` multi-select | Select multiple clones for batch operation |

**Key implementation details:**
- `AgentStatus::AwaitingApproval { approval_type, details }` — carries context about what needs approval
- `needs_attention()` method filters the list to show only actionable items
- `MonitoredAgent.context_remaining: Option<u8>` — tracks remaining context window (0-100%)
- Hierarchical tree: Session → Window → Pane → Subagents (collapsible)
- Input forwarding: type text in TUI → `tmux send-keys` to selected agent's pane

---

## Multiplexer Abstraction (workmux)

```
src/multiplexer/
├── mod.rs       # Multiplexer trait
├── tmux.rs      # tmux: capture-pane, send-keys, list-panes
├── wezterm.rs   # wezterm: CLI pane commands
├── kitty.rs     # kitty: remote control protocol
├── zellij.rs    # zellij: CLI actions
├── agent.rs     # AgentPane, AgentStatus (shared types)
├── types.rs     # MultiplexerType enum
├── handle.rs    # Window/pane handle abstraction
└── handshake.rs # Initial multiplexer detection
```

**Core types:**
- `AgentPane { session, window, pane_id, worktree_path, status, status_ts }` — unified pane model across all backends
- `AgentStatus { Active, Idle, Waiting }` — detected via pane content regex
- `is_stale(status_ts, threshold_secs, now)` — configurable stale detection with timestamp tracking

**Detection flow:**
1. `handshake.rs` auto-detects which multiplexer is running
2. All backends expose the same `Multiplexer` trait methods
3. Background thread calls `list_agent_panes()` → returns `Vec<AgentPane>`
4. UI receives unified data regardless of backend

**For Lumi TUI Phase 1:** Implement `TmuxMultiplexer` only, behind the trait. Add zellij/wezterm later without touching UI code.

# Agent Dashboard Tools Survey

> Research conducted for the Lumi-Ops TUI dashboard.
> All tools were cloned and analyzed at source-code level (March 2026).

## Comparison Matrix

| Feature | workmux | claude-dashboard | agent-deck | lazyworktree | TmuxCC | AoE |
|---------|:-------:|:----------------:|:----------:|:------------:|:------:|:---:|
| **Language** | Rust | Go | Go | Go | Rust | Rust |
| **TUI Framework** | ratatui | BubbleTea | BubbleTea | BubbleTea v2 | ratatui | ratatui |
| **License** | MIT | MIT | MIT | Apache 2.0 | MIT | MIT |
| **tmux support** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Worktree management** | ✅ | ❌ | ✅ | ✅ | ❌ | ✅ |
| **Multi-agent detection** | ✅ | Claude only | ✅ | Claude + pi | ✅ (4) | ✅ (8) |
| **Status detection** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Approval/review UI** | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| **Cost tracking** | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ |
| **CI/PR integration** | ✅ (GH) | ❌ | ❌ | ✅ (GH+GL) | ❌ | ❌ |
| **Docker sandbox** | Lima VM | ❌ | ❌ | Docker/Podman | ❌ | ✅ |
| **Diff view** | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ |
| **Subagent tracking** | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| **Web dashboard** | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ |
| **Terminal mux abstraction** | ✅ (4) | tmux only | tmux only | tmux + zellij | tmux only | tmux only |
| **Conversation reader** | ❌ | ✅ | ❌ | ✅ | ❌ | ❌ |
| **Session forking** | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ |
| **Command palette** | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| **Remote control** | ❌ | ❌ | Telegram | ❌ | ❌ | ❌ |

## Key Takeaways for Lumi TUI

### Must-Have Patterns (Adopt)

1. **Status Poller Pattern** (AoE, workmux) — Background thread/task for non-blocking status detection via mpsc channels.
2. **Multiplexer/Container Abstraction** (workmux, AoE) — Trait-based abstraction over terminal multiplexers and container runtimes.
3. **Stable Selection Tracking** (workmux) — Track selected item by ID, not index, to survive list updates.
4. **Event-Driven Architecture** (workmux) — Background fetches → channel events → UI state updates.
5. **Approval Workflow** (TmuxCC) — Batch approve/reject with multi-select, maps to our review protocol.

### Should-Have Patterns (Consider)

6. **Cost Tracking** (agent-deck) — Microdollar precision, SQLite storage, per-model pricing, time-windowed queries.
7. **CI/PR Status** (lazyworktree) — Inline CI status in worktree view.
8. **Dual View Mode** (AoE) — Agent view vs Terminal view toggle.
9. **Process Table Detection** (claude-dashboard) — Detect agents running outside tmux.
10. **Transcript-Based Discovery** (lazyworktree) — Parse JSONL transcripts for rich session metadata.

### Nice-to-Have Patterns (Later)

11. **Command Palette** (lazyworktree) — k9s-style action discovery.
12. **Context Remaining %** (TmuxCC) — Show how much context window is left.
13. **Subagent Tracking** (TmuxCC) — Track Task tool sub-processes.
14. **Diff View** (workmux, AoE) — Review changes without leaving TUI.
15. **Conversation Reader** (claude-dashboard, lazyworktree) — Show agent conversation history.

## Architecture Insights

### Tech Stack Convergence

All three Rust tools chose **ratatui + crossterm + tokio**. All three Go tools chose **BubbleTea + Lipgloss**. These are clearly the dominant stacks for TUI development.

### Status Detection Approaches

| Approach | Tools | How |
|----------|-------|-----|
| **Pane content analysis** | workmux, TmuxCC, AoE | `tmux capture-pane` → regex parsing |
| **Process table scanning** | claude-dashboard | `ps -eo pid,ppid,tty,args` |
| **Transcript file parsing** | lazyworktree, agent-deck | Read `~/.claude/projects/.../` JSONL |
| **Hybrid** | lazyworktree | Transcript + process matching with confidence levels |

**Recommendation for Lumi TUI:** Start with pane content analysis (same as our v0.6 Drivers approach), but design the status detection as a trait/strategy so we can add transcript-based and process-based detection later.

### Storage Approaches

| Approach | Tools | When to Use |
|----------|-------|-------------|
| **JSON files** | AoE, workmux | Simple session state, low write frequency |
| **SQLite** | agent-deck | Cost tracking, complex queries, relational data |
| **`.lumi-metadata.json`** | Lumi-Ops | Our existing centralized metadata |

**Recommendation:** Keep `.lumi-metadata.json` for clone metadata (it's our protocol). If we add cost tracking, SQLite is the right choice.

## Per-Tool Documents

| File | Tool | Focus |
|------|------|-------|
| [workmux_patterns.md](workmux_patterns.md) | workmux | Multiplexer abstraction, dashboard architecture |
| [claude_dashboard_patterns.md](claude_dashboard_patterns.md) | claude-dashboard | k9s-style design, process detection |
| [cost_tracking_patterns.md](cost_tracking_patterns.md) | agent-deck | Cost computation, SQLite storage, pricing engine |
| [lazyworktree_patterns.md](lazyworktree_patterns.md) | lazyworktree | CI/PR integration, agent session discovery |
| [approval_ui_patterns.md](approval_ui_patterns.md) | TmuxCC | Approval workflow, batch operations |
| [aoe_patterns.md](aoe_patterns.md) | Agent of Empires | Docker sandbox, status poller, worktree automation |

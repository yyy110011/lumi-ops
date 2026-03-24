# Pertmux Architecture Analysis

> Source: [rupert648/pertmux](https://github.com/rupert648/pertmux) | License: MIT

## Overview

Pertmux is a **daemon/client TUI dashboard** for monitoring coding agent sessions in tmux. It implements a background daemon that polls tmux, forge APIs (GitHub/GitLab), and worktree state at configurable intervals, serializes everything into a `DashboardSnapshot`, and broadcasts to connected TUI clients via Unix socket.

## Architecture Diagram

```
┌──────────────────────────────────────────────────────────────┐
│                    pertmux daemon                            │
│                                                              │
│  ┌─────────┐  ┌─────────────┐  ┌──────────────┐             │
│  │  tmux   │  │ Forge APIs  │  │  worktrunk   │             │
│  │ (2s)    │  │ (60-300s)   │  │  CLI (30s)   │             │
│  └────┬────┘  └──────┬──────┘  └──────┬───────┘             │
│       │              │                │                      │
│       └──────────────┼────────────────┘                      │
│                      ▼                                       │
│              DashboardSnapshot                               │
│                      │                                       │
│              broadcast::channel                              │
│                      │                                       │
│         ┌────────────┼────────────┐                          │
│         ▼            ▼            ▼                          │
│     Client 1     Client 2     Client N                       │
│                                                              │
│  Unix Socket: /tmp/pertmux-{USER}.sock                       │
│  Protocol: LengthDelimitedCodec + JSON                       │
└──────────────────────────────────────────────────────────────┘
```

## Key Components

| Component | File | Purpose |
|-----------|------|---------|
| Daemon | `daemon.rs` | Background process, polls state, broadcasts snapshots |
| Client | `client.rs` | TUI renderer, receives snapshots, sends commands |
| Protocol | `protocol.rs` | DashboardSnapshot, ClientMsg, DaemonMsg enums |
| App State | `app.rs` | Daemon-side state (projects, panes, MR caches) |
| Config | `config/mod.rs` | Multi-project TOML config with validation |
| Tmux | `tmux.rs` | Pane discovery with child-process fallback |
| Agents | `coding_agent/` | CodingAgent trait, Claude Code + OpenCode impls |
| Worktrees | `worktrunk.rs` | wt CLI integration (list/create/remove/merge) |
| Discovery | `discovery.rs` | Port discovery via process tree + netstat |
| Types | `types.rs` | AgentPane, PaneStatus, SessionDetail |

## Polling Intervals

| Data Source | Default Interval | Configurable |
|-------------|-----------------|--------------|
| tmux panes + agent status | 2s | `refresh_interval` |
| Worktree list (wt CLI) | 30s | `worktree_interval` |
| MR detail + CI pipeline | 60s | `mr_detail_interval` |
| MR list (forge API) | 300s | `mr_list_interval` |

## Comparison: Pertmux vs Lumi-TUI

| Aspect | Pertmux | Lumi-TUI (Planned) |
|--------|---------|---------------------|
| **Architecture** | Daemon/client via Unix socket | Phase 1: direct file reads; Phase 2: daemon/client |
| **State source** | Forge APIs + tmux + wt CLI | .lumi-metadata.json + tmux + lumi-ops CLI |
| **Project discovery** | Config file (manual) | ~/.lumi-ops/.registry.json (auto-registered) |
| **Agent detection** | CodingAgent trait (Claude, OpenCode) | Similar trait (Gemini, Claude, Antigravity) |
| **Worktree mgmt** | wt CLI (worktrunk) | lumi-ops CLI |
| **Review protocol** | Forge MR status | MISSION_COMPLETE.md + reviewStatus |
| **Multi-project** | Config-defined | Auto-discovered from registry |
| **Forge integration** | GitHub + GitLab APIs | None (file-based review protocol) |
| **Pane discovery** | tmux list-panes + sysinfo | Same approach (borrow from Grove + Pertmux) |

## What to Adopt for Each Phase

### Phase 1 (Direct File Reads)
- **Agent detection patterns** — CodingAgent trait + two-phase tmux discovery
- **Claude transcript parsing** — JSONL-based status detection
- **UI patterns** — PopupState enum, notification system, age formatting
- **Async subprocess** — tokio Command pattern for lumi-ops CLI

### Phase 2 (Daemon/Client)
- **Full daemon architecture** — Unix socket, broadcast channel, multi-interval polling
- **DashboardSnapshot** — serialize ALL state into one struct
- **Protocol versioning** — Handshake with version check
- **LengthDelimitedCodec** — frame-based message passing
- **Offline change buffering** — queue notifications when no clients connected
- **Daemonize pattern** — re-exec self with `--foreground`, redirect stdout to log

## Crate Dependencies (Daemon/Client Specific)

```toml
# Only needed for Phase 2 daemon/client architecture
tokio = { version = "1", features = ["net", "sync", "signal"] }
tokio-util = { version = "0.7", features = ["codec"] }  # LengthDelimitedCodec
bytes = "1"                    # Bytes for serialized messages
futures = "0.3"                # SinkExt, StreamExt for Framed
sysinfo = "0.33"               # Process tree inspection
netstat2 = "0.10"              # Port discovery (OpenCode only)
nucleo-matcher = "0.3"         # Fuzzy search (or use fuzzy-matcher)
dirs = "5"                     # Platform data/config directories
ureq = "3"                     # HTTP client (OpenCode API)
clap = { version = "4", features = ["derive"] }  # serve/connect/stop subcommands
```

## Files in This Directory

| File | Content |
|------|---------|
| `daemon_architecture.rs` | Unix socket, broadcast, polling, DashboardSnapshot, daemonize |
| `config_system.rs` | Multi-project TOML, validation, keybindings, agent config |
| `agent_monitoring.rs` | CodingAgent trait, Claude JSONL, OpenCode HTTP, tmux discovery |
| `ui_components.rs` | PopupState, fuzzy finder, notifications, selection management |
| `worktree_integration.rs` | worktrunk CLI data types and async subprocess CRUD |
| `README.md` | This file — architecture analysis and adoption notes |

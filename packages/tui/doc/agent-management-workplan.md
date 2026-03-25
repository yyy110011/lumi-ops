# Agent Management — Work Breakdown & Progress Tracker

> @mention this file in a new chat to continue implementation.
> The agent should read this file, check progress, then spawn clones for remaining tasks.

**Design Docs**: [Phase 1](./agent-management-phase1.md) | [Phase 2](./agent-management-phase2.md)

---

## How to Use This File

1. Read the **Progress Table** below to see what's done and what's remaining
2. Pick the next `[ ]` task that has its dependencies met
3. Spawn a shadow clone for it using `lumi-ops spawn`
4. After merge, update this file: change `[ ]` → `[x]` and fill in the merge commit

---

## Phase 1: PTY Pool Agent Management

### Progress Table

| # | Task | Clone Branch | Status | Depends On | Commit |
|---|------|-------------|--------|------------|--------|
| 1 | PtyPool Core | `tui/pty-pool` | `[ ]` | — | — |
| 2 | Status Detector | `tui/status-detector` | `[ ]` | — | — |
| 3 | Config System | `tui/config` | `[ ]` | — | — |
| 4 | File Viewer Tabs | `tui/file-tabs` | `[ ]` | — | — |
| 5 | Agent List Panel | `tui/agent-list` | `[ ]` | #1 | — |
| 6 | App Integration | `tui/app-integration` | `[ ]` | #1, #2, #3 | — |
| 7 | Log Writer | `tui/log-writer` | `[ ]` | #1 | — |
| 8 | Agent Status Files | `tui/agent-status` | `[ ]` | #1, #7 | — |
| 9 | Final Integration & Polish | `tui/final-integration` | `[ ]` | All above | — |

### Parallel Execution Plan

```
Independent (can run in parallel):
  #1 PtyPool Core
  #2 Status Detector
  #3 Config System
  #4 File Viewer Tabs

After #1 merges:
  #5 Agent List Panel
  #7 Log Writer

After #1 + #2 + #3 merge:
  #6 App Integration

After #1 + #7 merge:
  #8 Agent Status Files

After all merge:
  #9 Final Integration & Polish
```

---

### Task Details

#### Task 1: PtyPool Core
**Branch**: `tui/pty-pool`
**File**: `packages/tui/src/app/pty_pool.rs`

**Deliverables**:
- `PtyPool` struct with `agents: Vec<AgentInstance>`, `selected: usize`
- `AgentInstance` struct: `id`, `clone_branch`, `worktree_path`, `driver`, `pty_manager`, `parser`, `status`, `created_at`, `last_activity`
- `DriverName` enum: `Gemini`, `Claude`
- `AgentStatus` enum: `Running`, `AwaitingInput`, `Completed`, `Error`, `Idle`
- Methods: `spawn()`, `kill()`, `select()`, `selected_parser()`, `selected_agent()`, `agents()` getter
- `spawn()` takes: branch name, worktree path, driver, command string, terminal size
- `kill()` drops the PtyManager and cleans up
- Unit tests for spawn/kill/select logic (mock PTY if needed)

**Key Design**:
- Reuse existing `PtyManager` from `pty.rs` — one instance per agent
- `spawn()` builds the command string based on driver:
  - Gemini: `cd {worktree} && gemini -p "Read MISSION.md and execute the mission" --sandbox=none`
  - Claude: `cd {worktree} && claude -p "Read MISSION.md and execute the mission" --dangerously-skip-permissions`
- Each agent gets its own reader thread (via PtyManager.spawn)

---

#### Task 2: Status Detector
**Branch**: `tui/status-detector`
**File**: `packages/tui/src/app/status_detector.rs`

**Deliverables**:
- `detect_status(screen_text: &str, driver: DriverName) -> AgentStatus`
- Regex patterns (use `LazyLock<Regex>` for compile-once):
  - `SPINNER_CHARS`: `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏◐◓◑◒⣾⣽⣻⢿⡿⣟⣯⣷`
  - `WORKING_INDICATORS`: `✻ *ing…` patterns
  - `TOOL_PATTERNS`: `⏺ Read/Write/Edit/Bash/Search`
  - `QUESTION_PATTERNS`: `(y/n)`, `Allow?`, `Run this command?`, `Enter to confirm`
  - `COMPLETION_PATTERNS`: `✓`, `done`, `completed successfully`
  - `ERROR_PATTERNS`: `✗`, `Error:`, `FAILED`, `panicked at`
  - `PROMPT_CHARS`: `>`, `›`, `❯`, `$`, `%`, `➜`
- Gemini-specific: `action required`, `waiting for confirmation`, `esc to cancel, \d+s`
- Claude-specific: uses shared patterns only
- Unit tests with real example screen captures from each agent

**Reference**: `resources/grove/SKILL.md` lines 56–153 for pattern details.

---

#### Task 3: Config System
**Branch**: `tui/config`
**File**: `packages/tui/src/app/config.rs`

**Deliverables**:
- `TuiConfig` struct:
  ```rust
  struct TuiConfig {
      agent: AgentConfig,
      keybindings: KeybindingsConfig,
  }
  struct AgentConfig {
      default_driver: DriverName,
      no_permissions: bool,
      gemini: GeminiConfig,
      claude: ClaudeConfig,
  }
  struct GeminiConfig { sandbox: String }
  struct ClaudeConfig { max_turns: Option<u32>, max_budget_usd: Option<f64> }
  ```
- `TuiConfig::load()` → reads `~/.lumi-ops/tui-config.toml`, returns defaults if file missing
- `TuiConfig::default()` → sensible defaults (gemini, no_permissions=true)
- Add `toml` and `dirs` crates to Cargo.toml
- Unit tests for parsing valid/invalid/missing config

---

#### Task 4: File Viewer Tabs
**Branch**: `tui/file-tabs`
**File**: `packages/tui/src/ui/file_tabs.rs` (new) + modify `src/ui/mod.rs`

**Deliverables**:
- `FileTab` enum: `Mission`, `Complete`, `Log`
- `FileTabsState` struct: `active_tab`, `scroll_positions: [u16; 3]`, `content_cache: [Option<String>; 3]`
- Tab bar widget rendering: `[MISSION] [COMPLETE] [LOG]` with active tab highlighted
- Content rendering with scroll support
- LOG tab: auto-scroll to bottom when new content arrives
- COMPLETE tab: show "No report yet" placeholder if file doesn't exist
- Methods: `next_tab()`, `prev_tab()`, `refresh(worktree_path: &str)`
- `refresh()` reads files from disk, caches content
- Independent of PtyPool — works with any worktree path

---

#### Task 5: Agent List Panel
**Branch**: `tui/agent-list`
**Files**: `packages/tui/src/ui/agents.rs` (new or modify existing)

**Deliverables**:
- Render `PtyPool.agents` instead of clone metadata
- Each row: `{status_icon} {branch}  {driver}  {status_label}`
- Status icons: `●` green (Running), `⚠` yellow (AwaitingInput), `✓` cyan (Completed), `✗` red (Error), `○` gray (Idle)
- Header: `🤖 Agents ({count} running)`
- Footer hints: `[a]Launch [x]Kill [Enter]Attach`
- Selection state (up/down navigation)
- Empty state: "No agents running. Select a clone and press 'a' to launch."

**Depends on**: #1 (needs PtyPool types for rendering)

---

#### Task 6: App Integration
**Branch**: `tui/app-integration`
**Files**: `packages/tui/src/app/mod.rs`, `src/main.rs`

**Deliverables**:
- Replace `pty_manager: Option<PtyManager>` / `pty_parser: Option<Arc<..>>` with `pty_pool: PtyPool`
- Load `TuiConfig` on startup
- Wire keybindings:
  - `a` → launch agent (build command from config + driver, call `pty_pool.spawn()`)
  - `x` → kill selected agent (`pty_pool.kill()`)
  - `Enter` in Agent List → select agent + focus Terminal
  - `[` / `]` in File Viewer → `file_tabs.next_tab()` / `file_tabs.prev_tab()`
  - `S` → toggle settings popup
- Terminal panel: render `pty_pool.selected_parser()` instead of single parser
- Tick handler: call `detect_status()` for each agent every 100ms (selected) / 2s (background)
- Remove auto-spawn-on-startup logic
- Add `FileTabsState` to AppState, refresh on clone selection change

**Depends on**: #1, #2, #3

---

#### Task 7: Log Writer
**Branch**: `tui/log-writer`
**File**: Modify `packages/tui/src/app/pty.rs` or `pty_pool.rs`

**Deliverables**:
- Background thread that tees PTY output to `.lumi/agent.log`
- Integrate into `PtyManager::spawn()` — when `log_path` is provided, start tee writer
- Ensure log is flushed periodically (not just on exit)
- Handle log rotation (optional: truncate if >10MB)

**Depends on**: #1

---

#### Task 8: Agent Status Files
**Branch**: `tui/agent-status`
**File**: Modify `packages/tui/src/app/pty_pool.rs`

**Deliverables**:
- On `spawn()`: write `.lumi/agent-status.json`:
  ```json
  { "driver": "gemini", "tmuxSession": "", "startedAt": "...", "status": "running", "logFile": ".lumi/agent.log" }
  ```
- On agent exit: write `.lumi/agent-exit-code` (exit code as string)
- On agent exit: update `.lumi/agent-status.json` → `status: "completed"` or `"failed"`
- Match the `AgentStatus` interface from `packages/cli/src/drivers/types.ts`
- Integration test: spawn → verify file written → kill → verify updated

**Depends on**: #1, #7

---

#### Task 9: Final Integration & Polish
**Branch**: `tui/final-integration`

**Deliverables**:
- All components wired together and working end-to-end
- Smooth panel switching with agents
- File Viewer tabs auto-refresh when switching agents
- Agent List selection syncs with File Viewer (show selected agent's MISSION/COMPLETE/LOG)
- Settings popup renders current config
- `cargo test` passes all tests
- Manual testing: spawn 2+ agents, switch between them, interact, kill
- Update `SKILL.md` with new module descriptions

**Depends on**: All above

---

## Phase 2: Daemon/Client (Future)

Phase 2 tasks are NOT broken down here yet. After Phase 1 is complete and stable, create a new work breakdown for Phase 2 based on `agent-management-phase2.md`.

Rough scope:
- [ ] Daemon main loop + Unix socket listener
- [ ] Protocol types (ClientMsg, DaemonMsg)
- [ ] PtyPool migration into daemon
- [ ] TUI client (ProxyPtyPool)
- [ ] Auto-start/stop daemon lifecycle
- [ ] CLI commands: `lumi-tui daemon start/stop/status`
- [ ] VS Code extension integration
- [ ] Screen streaming optimization

---

## Notes for Agents

- **Build check**: Always run `cargo check` before submitting
- **Test**: Run `cargo test` — currently 56 tests, all must pass
- **Existing PTY code**: `src/app/pty.rs` has a working `PtyManager`. Reuse it, don't rewrite.
- **Resources**: `resources/grove/SKILL.md` has Grove's patterns. `resources/pertmux/SKILL.md` has Pertmux's daemon patterns.
- **Design docs**: Read the Phase 1/2 docs linked at the top for full context.
- **Don't touch**: `src/app/tmux.rs` — dead-code-gated, kept for Phase 2 reference.

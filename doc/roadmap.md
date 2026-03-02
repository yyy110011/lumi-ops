# Lumi-Ops Roadmap

> Based on current feature status, design documents, and recent refactoring.

## Current (v0.3.8)

✅ Spawn / Kill / Merge — Full lifecycle management
✅ Review Status Tracking & Metadata Management
✅ Conflict Auto-Detection
✅ **Prompt Library** (Global & Project dual-scope, cross-window sync, inline creation, per-item actions)
✅ **Mission Template System** (Custom editor, dual-scope, fork/edit/delete/copy, structured Task/Rules/Instructions)
✅ **Clone Path Convention** (Standardized `.worktrees/` directory, compatible with native VS Code Git)
✅ **Shadow Mode UI** (Unified layout with Root Mode — full functionality inside clones, current clone marked with ★)
✅ **Return to Root** (🏠 Instant navigation back to main repo)
✅ **Copy Branch Name** (Right-click to copy branch name)
✅ **Migration Module** (Auto-migrate legacy worktrees / global prompts / project prompts)
✅ **Worktree Manager (Beta)** (Multi-repo dashboard with global repo registry)
✅ **Copy on Spawn** (Configurable folders/files to copy from root to clone)
✅ **StatusEventBus** (Centralized cross-view sync for metadata changes)
✅ Initial MCP Server

---

## Shadow Mode UI Enhancements (Optional)

**Status**: Nice-to-have, not a priority.

- [ ] MISSION.md preview summary in Webview
- [ ] Clone-specific quick action bar (run tests, Git operations, etc.)
- [ ] Show diff status against base branch
- [ ] Prompt Library categorization (This Clone / Project / Global grouping)

---

## v0.5 — Background Agent Automation

**Goal**: Launch background agents with `--driver` via `spawn` (e.g., Antigravity or tmux) for fully automated background work.
**Reference**: [Background-Agent-Plan.md](./Background-Agent-Plan.md)

### Phase 1: CLI Agent Launch & Basic State
- [ ] Extend `lumi-ops spawn`: support `--driver` (antigravity/tmux) and `--prompt` options
- [ ] Standardize agent status file (`.lumi-status.json`) format
- [ ] MISSION.md template improvements (ensure agent runs in the correct working directory)

### Phase 2: Extension UI Integration & Monitoring
- [ ] ShadowCreatorProvider: add driver selection (Antigravity / Tmux / Manual)
- [ ] Status icon updates: scan `.lumi-status.json` to show agent running or blocked state
- [ ] Agent control commands: `Attach`, `Kill Session`, `Watch Logs`, `Jump In`

### Phase 3: GC (Garbage Collection)
- [ ] CLI: add `lumi-ops gc` command to clean up orphaned `.worktrees/` and stale tmux sessions
- [ ] Integrate `git worktree prune` into the cleanup flow

---

## v0.6 — MCP Agent Sandbox

**Goal**: Ensure AI-controlled agents execute external commands exclusively through the Root-side MCP Server, preventing system-wide or main project impact.
**Reference**: [mcp-agent-sandbox.md](./mcp-agent-sandbox.md)

- [ ] **Agent Registry**: Auto-register valid `branch → path` mapping after spawn
- [ ] **MCP `exec` Tool**: Restrict command execution to the designated worktree scope
- [ ] **Security Measures**: Path traversal defense and unauthorized access blocking

---

## Backlog & Quick Wins

**Reference**: [feature-candidates.md](./feature-candidates.md)

- [ ] Reveal in Finder + Copy Path
- [ ] Post-create command (e.g., auto-run `install` after spawn)
- [x] ~~File copy patterns~~ → Implemented as `lumi-ops.copyOnSpawn` setting
- [ ] Quick switch (Telescope / fuzzy search for clone directories)
- [ ] i18n support

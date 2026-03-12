# Lumi-Ops Roadmap

> Based on current feature status, design documents, and recent refactoring.

## Current (v0.4.0)

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
✅ **MCP Server** (11 tools: spawn, kill, list, merge, review, revision, status, prompts, file diff)
✅ **Clone Agent Rules** (Auto-inject executor rules into clones)
✅ **Root Agent Mode** (Strategist rules for main workspace)
✅ **Auto-Status Transitions** (`todo` → `inProgress` on workspace open)
✅ **Review Protocol** (`MISSION_COMPLETE.md` → `needsReview` → `review_clone` → `request_revision`)

---

## Shadow Mode UI Enhancements (Optional)

**Status**: Nice-to-have, not a priority.

- [ ] MISSION.md preview summary in Webview
- [ ] Clone-specific quick action bar (run tests, Git operations, etc.)
- [ ] Show diff status against base branch
- [ ] Prompt Library categorization (This Clone / Project / Global grouping)

---

## v0.4.1 — Onboarding & Polish

**Goal**: Make the extension usable out-of-the-box for new users.

- [ ] **VS Code Walkthrough** (Getting Started step-by-step: enable settings, set up MCP, create first prompt, spawn first clone)
- [x] **Example Prompt** (Seed `~/.lumi-ops/.prompts/` with a starter template on first activation)
- [x] **`cloneAgentRules` default → `true`**
- [x] **MCP Server npm publish** (`npx @lumi-ops/mcp-server` or `npm install -g`)
- [x] **MCP Server unit tests** (33 tests: pure functions + tool handler logic)

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
- [ ] Post-spawn hooks (auto-run commands like `npm i`, `uv sync`, etc. after clone creation)
- [x] ~~File copy patterns~~ → Implemented as `lumi-ops.copyOnSpawn` setting
- [ ] Quick switch (Telescope / fuzzy search for clone directories)
- [ ] Adopt existing worktrees (right-click → add metadata for manually-created worktrees)
- [ ] i18n support

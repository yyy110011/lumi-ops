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
✅ **MCP Server** (15 tools, 6 resources, 4 prompts — [strategy](./mcp-server-strategy.md))
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

## v0.4.5 — Cross-Repo Operations

- [x] **`repo` parameter on all tools** — All 13 branch-targeting tools now require a `repo` parameter for explicit repo context
- [x] **`describe_clone` tool** — New read-only tool for full clone details (MISSION.md + MISSION_COMPLETE.md)
- [x] **Slimmed `list_clones`** — Returns `title` instead of full description to reduce context waste
- [x] **`resolveEffectiveRoot` error handling** — Descriptive error messages for invalid repo paths

---

## v0.4.4 — MCP Server Refactoring & Bug Fix ✅

- [x] **Modular Refactoring** — Split `index.ts` into `state.ts`, `tools/`, `prompts.ts`, `resources.ts`
- [x] **Fix empty annotations bug** — `typedHandler is not a function` caused by SDK `isZodRawShapeCompat({})` treating `{}` as Zod schema
- [x] **SDK regression test** — Real `McpServer` test to catch handler registration bugs

---

## v0.4.3 — MCP Resources & Prompts ✅

### Resources (read-only data exposure)
- [x] `lumi://clones` — Clone list (lighter than tool call for agent context)
- [x] `lumi://clones/{branch}/mission` — Read a clone's MISSION.md
- [x] `lumi://clones/{branch}/report` — Read MISSION_COMPLETE.md
- [x] `lumi://clones/{branch}/feedback` — Read REVIEW_FEEDBACK.md
- [x] `lumi://prompts/{scope}/{name}` — Read a specific prompt file
- [x] `lumi://config` — Server configuration (rootDir, detection method, version)

### Prompts (workflow guidance)
- [x] `review-and-merge` — Guide agent through review → approve/revise → merge flow
- [x] `spawn-with-context` — Guide agent to spawn a clone from a task description
- [x] `multi-clone-strategy` — Guide root agent to plan multi-clone parallel strategy
- [x] `resolve-conflict` — Guide agent through merge conflict resolution

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

- [ ] **Auto-Close Clone Window on Kill** — see design below
- [ ] Reveal in Finder + Copy Path
- [ ] Post-spawn hooks (auto-run commands like `npm i`, `uv sync`, etc. after clone creation)
- [x] ~~File copy patterns~~ → Implemented as `lumi-ops.copyOnSpawn` setting
- [ ] Quick switch (Telescope / fuzzy search for clone directories)
- [ ] Adopt existing worktrees (right-click → add metadata for manually-created worktrees)
- [ ] i18n support

---

## Design: Auto-Close Clone Window on Kill

**Problem**: When a clone is killed (from root workspace, MCP, or CLI), its VS Code window stays open pointing to a deleted directory — causing confusing errors as the filesystem is gone.

**Approach**: File watcher self-destruct pattern. The clone window detects its own deletion and closes itself.

### How It Works

1. During `activate()`, the extension already detects clone workspaces via `.worktrees/` path matching (L121 in `extension.ts`).
2. When `isCloneWorkspace` is true, register a **file watcher** on the clone's own `.git` file (the worktree link file, not a directory).
3. When the file is deleted (i.e. the worktree is removed by `kill`), the watcher fires.
4. Show a brief notification: `"⚡ This shadow clone has been removed."`, then execute `workbench.action.closeWindow` to close the VS Code window.

### Implementation Details

| Aspect | Detail |
|---|---|
| **Trigger file** | `<worktreePath>/.git` (a file in worktrees, not a dir) |
| **Watch method** | `fs.watchFile()` (polling, works for deletions) or `vscode.workspace.createFileSystemWatcher` |
| **Fallback** | If `fs.watchFile` misses the event, the existing 5s polling loop (L353) can also check `fs.existsSync(currentWorkspacePath)` |
| **Guard** | Debounce + only trigger once (prevent double-close race) |
| **Files changed** | 1 (`extension.ts`) — add ~20 lines in the `isCloneWorkspace` block |
| **New tests** | 0 (pure VS Code API interaction, not unit-testable) |
| **Effort** | ⭐ Minimal |
| **Confidence** | 95% |

### Why `fs.watchFile` over `fs.watch`

`fs.watch` (used elsewhere in the extension) is efficient but doesn't reliably detect file **deletion** on all platforms. `fs.watchFile` uses stat polling (we can set a 2s interval) and reliably detects when the `.git` file disappears. Since this runs only in clone windows (not root), the single extra poll is negligible.

### Alternative Considered

Watching the metadata file for clone removal was considered, but the `.git` file approach is simpler — it doesn't require parsing metadata, and the `.git` file is guaranteed to be deleted by `git worktree remove`.

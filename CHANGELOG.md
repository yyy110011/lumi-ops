# Changelog

All notable changes to this project will be documented in this file.

## v0.4.5 (Unreleased)

### ⚠️ Breaking Changes
- **`repo` parameter now required** — All branch-targeting MCP tools now require a `repo` parameter. If you were relying on auto-detected `rootDir` alone, you must now pass `repo` on every call. Tools affected: `spawn_clone`, `list_clones`, `kill_clone`, `merge_clone`, `set_clone_status`, `review_clone`, `get_clone_file_diff`, `request_revision`, `get_clone_log`, `read_clone_file`, `list_prompts`, `save_prompt`, `describe_clone`.

### ✨ Features
- **Cross-Repo Operations** — Pass any path inside a target repository as the `repo` parameter and it will be automatically resolved to the main repo root. Makes multi-repo workflows first-class — no more `set_project_root` switching.
- **`describe_clone` Tool** — New read-only tool that returns full details for a single clone including MISSION.md description and MISSION_COMPLETE.md content. Use after `list_clones` to drill into specific clones.
- **Slimmed `list_clones`** — Response now returns a `title` (first heading from description) instead of the full MISSION.md content, reducing context waste when scanning multiple clones.

### 🔧 Improvements
- **`resolveEffectiveRoot` error handling** — Descriptive error messages when the `repo` parameter points to an invalid path: "Could not resolve repo root from path: '/path'. Ensure the path is inside a valid git repository."
- **MCP Server Modular Refactoring** — Split the monolithic `index.ts` (1437 lines) into focused modules:
  - `state.ts` — Shared server state singleton (rootDir, metadata helpers)
  - `tools/clone-ops.ts` — Clone lifecycle tools (spawn, list, kill, merge)
  - `tools/prompt-ops.ts` — Prompt tools (list_prompts, save_prompt, set_project_root)
  - `tools/review-ops.ts` — Review tools (set_status, review, diff, revision, log, read_file)
  - `prompts.ts` — MCP Prompt templates (review-and-merge, resolve-conflict, spawn-with-context, multi-clone-strategy)
  - `resources.ts` — MCP Resources (lumi://clones, clone files, prompts, config)

### 🐛 Bug Fixes
- **Fix `typedHandler is not a function`** — MCP SDK v1.27.1's `isZodRawShapeCompat()` treats empty `{}` as a Zod raw shape, causing `server.tool(name, desc, schema, {}, callback)` to misassign the handler. Removed all empty `{}` annotations from 6 tool registrations across 3 files. Affected tools: `spawn_clone`, `merge_clone`, `request_revision`.

### 🧪 Tests
- **SDK Regression Test** — New `sdk-regression.test.ts` using the real `McpServer` (not mocks) to verify tool handler registration patterns. Documents the SDK bug and protects against reintroduction.

## v0.4.3

### ✨ Features
- **MCP Resources** — 6 new read-only MCP Resources for agent context awareness:
  - `lumi://clones` — Clone list with metadata and status
  - `lumi://clones/{branch}/mission` — Read a clone's MISSION.md
  - `lumi://clones/{branch}/report` — Read MISSION_COMPLETE.md
  - `lumi://clones/{branch}/feedback` — Read REVIEW_FEEDBACK.md  
  - `lumi://prompts/{scope}/{name}` — Read a specific prompt file
  - `lumi://config` — Server configuration (rootDir, detection method, version)
- **MCP Workflow Prompts** — 4 MCP Prompt templates that appear in the client's prompt menu:
  - `review-and-merge` — Guide agent through review → approve/revise → merge flow
  - `spawn-with-context` — Guide agent to spawn a clone from a task description
  - `multi-clone-strategy` — Guide root agent to plan multi-clone parallel strategy
  - `resolve-conflict` — Guide agent through merge conflict resolution

## v0.4.0 (Unreleased)

### ✨ Features
- **MCP Server** — New `@lumi-ops/mcp-server` package with tools for spawn, kill, list, merge, review, and status management. Published to npm — install via `npx @lumi-ops/mcp-server`. Supports Antigravity, VS Code, Cursor, Windsurf, and Claude Desktop.
- **Auto-Status Transitions** — Clone status auto-transitions from `todo` → `inProgress` when workspace opens.
- **Status-Aware Prompt** — Copy prompt varies based on clone's review status (normal vs revision).
- **Merge Improvements** — Auto-exclude clone artifacts from merges, slim conflict response.
- **Generated Prompt Lifecycle** — Agent prompts in `_generated/` with auto-cleanup on kill.
- **Clone Agent Rules** — New `lumi-ops.cloneAgentRules` setting to inject rules for clone agents.
- **Root Agent Mode** — Setting to inject strategist rules for main workspace agents.
- **Rebase Conflict UX** — Manual conflict resolution instead of auto-abort.
- **Review Tools** — `review_clone` and `get_clone_file_diff` MCP tools for structured review and diff inspection.

### 🐛 Bug Fixes
- Fixed stale `statusCache` after kill+respawn.
- Fixed settings page showing unrelated results.
- MCP diff now uses caller's HEAD instead of `baseBranch`.

## [0.3.8] - 2026-03-02

### ✨ New Features
- **Mission Template System** — Define custom MISSION.md templates with structured Task / Rules / Instructions fields. Templates live in `.prompts/_missions/` with dual-scope (Global + Project) support. Fork, edit, delete, and copy templates across scopes. Active template is stored per-workspace in `lumi-ops.activeMissionTemplate` setting.
- **Mission Template Custom Editor** — Opening any `.prompts/_missions/*.md` file renders a structured form editor instead of raw markdown. Changes are synced in real-time with VS Code's native dirty-state handling.
- **Worktree Manager (Beta)** — A multi-repo dashboard (`Open Worktree Manager` button in sidebar) that shows all registered repos and their worktrees in one panel. Supports review status cycling, inline notes, and cross-repo overview via a global repo registry (`~/.lumi-ops/.registry.json`).
- **Copy on Spawn** — Configure folders/files to automatically copy from root into shadow clones on spawn. Set via `lumi-ops.copyOnSpawn` (multiline text, one path per line) or the `Browse workspace folders` command link in settings.

### 🔧 Improvements
- **Prompt Library Redesign** — New dedicated `PromptLibraryViewProvider` with per-item action icons (copy scope, edit, delete), scope filter toggles, and an integrated Mission Template dropdown with inline template management.
- **StatusEventBus** — Centralized event bus for cross-view metadata synchronization. All subscribers (sidebar, Worktree Manager, prompt library) react to a single event source for consistent state updates.
- **Default Mission Template** — Extracted into `missionDefaults.ts` as the single source of truth, shared by both CLI and Extension.
- **Global Repo Registry** — New `registry.ts` module auto-registers repos on spawn for use by the Worktree Manager multi-repo dashboard.
- **ShadowCreatorProvider Refactor** — Simplified spawn form, reduced file size by ~400 lines through extraction of prompt library and mission template logic into dedicated providers.
- **ShadowTreeProvider Unit Tests** — Added Vitest-based unit tests for the sidebar tree provider.

## [0.3.7] - 2026-02-28

### 🐛 Bug Fixes
- **Symlink Workspace Support** — Resolve symlinks on the workspace root path using `fs.realpathSync()` so that `getClonesDir()` and `git worktree list` return matching paths. Previously, opening a workspace via a symlink (e.g. `~/app` → `/mnt/data/app`) caused the Tree View to show no clones because the path comparison (`startsWith`) failed silently.

### 🧪 Tests
- Added e2e test for symlink resolution that proves both the bug and the fix.

## [0.3.6] - 2026-02-27

### 🐛 Bug Fixes
- **Remote SSH Support** — Added `extensionKind: ["workspace"]` so the extension runs on the remote machine when using VS Code Remote SSH. Previously, the extension could run locally, causing the Active Clones tree to appear empty.
- **Empty Repo Support** — `getCurrentBranch()` now uses `git branch --show-current` instead of `git rev-parse --abbrev-ref HEAD`, which crashed on repositories with zero commits. This also fixes the Base Branch dropdown being stuck on "loading..." in new repos.
- **Spawn Error Visibility** — Spawn now throws errors instead of calling `process.exit(1)`, so the VS Code extension can display the actual error message instead of a false "created successfully" notification.
- **Empty Repo Guard** — Added a pre-spawn check (`hasCommits()`) that shows a clear error when attempting to create a Shadow Clone in a repository with no commits, since `git worktree add` requires at least one commit.

## [0.3.5] - 2026-02-24

### 📝 Documentation
- **README updates** — Updated Shadow Mode description to reflect v0.3.4 UX improvements (visible clones, ★ indicator, no popup).
- **English docs** — Translated all internal docs (`roadmap.md`, `feature-candidates.md`, `Background-Agent-Plan.md`, `mcp-agent-sandbox.md`) to English.

## [0.3.4] - 2026-02-24

### 🔧 Improvements
- **Shadow Mode — Active Clones visible** — The sidebar Tree View now shows all clones in Shadow Mode (same layout as Root). Click any clone to open it in a new window; the current clone is marked with `★`.
- **Shadow Mode — No right-click** — Context menu actions (Kill, Merge, Copy Branch Name) are hidden in Shadow Mode to prevent accidental operations.
- **Return to Root — No popup** — The 🏠 Return to Root action now executes immediately without a confirmation dialog.
- **Cleaner Webview** — Removed the redundant Shadow Mode header from the Webview since navigation is now handled by the Tree View.

## [0.3.3] - 2026-02-23

### ✨ New Features
- **Shadow Mode UI** — When opened inside a Shadow Clone (Git Worktree), the extension automatically switches to a focused Prompt Library view, hiding Spawn/Kill/Merge controls.
- **Return to Root** — A 🏠 button in the Shadow Mode header lets you return to the main repository window (with confirmation dialog).
- **Copy Branch Name** — Right-click any clone in the sidebar to copy its branch name to the clipboard.
- **Cross-Window Prompt Sync** — Prompts are synced in real-time across Root and Shadow Clone windows via file system watchers.
- **Inline Prompt Creation** — Double-click the prompt list to create a new prompt inline from the dropdown.

### 🔧 Improvements
- **Project Prompts Path** — Moved project prompts from `<repo>.worktrees/.prompts/` to `<repoRoot>/.prompts/` for simpler cross-worktree access. Automatic migration included.
- **Migration Refactor** — Consolidated all one-time migrations (legacy worktrees, global prompts, project prompts) into a dedicated `migrations.ts` module.


## [0.3.2] - 2026-02-22

### 🐛 Bug Fixes
- **Prompt Import Failure** — Fixed a bug where importing prompts failed on certain file system mounts or symbolic links due to strict `vscode.FileType` equality checks, replacing them with proper bitwise logic.
- **Extension Crash** — Fixed a critical crash during extension activation by restoring the missing `LUMI_OPS_HOME` constant export from the `@lumi-ops/cli` package, ensuring successful command registration.

## [0.2.6] - 2026-02-12

### ✨ New Features
- **Merge Target Selection** — Squash & Merge now lets you choose which branch to merge into, not just the current branch. The recorded base branch is marked as `← recommended`.
- **Merge Conflict Detection** — `hasConflicts()` API detects unresolved merge conflicts. Active Clones tree shows ⚠️ indicator on conflicted worktrees.
- **Dropdown Search Filter** — Branch Name and Base Branch fields now act as live search inputs. Click to open the dropdown, type to filter branches in real-time.
- **Existing Branch Base Handling** — Spawning from an existing branch no longer incorrectly records a base branch. Base is left empty (unknown).

### 🎨 UX Improvements
- **Simplified Merge Flow** — Reduced from 2 steps (select branch + fill message) to 1 step (select branch). Default commit message `feat: merged <branch> (squash)` is applied automatically.
- **Removed ▾ Buttons** — Branch Name and Base Branch inputs open their dropdown on focus, making dedicated browse buttons redundant.
- **Enter/Tab Dismisses Dropdown** — Pressing Enter or Tab closes the active dropdown. Focusing one input auto-closes the other's dropdown.
- **Create New Branch Hint** — When typed branch name matches no existing branches, dropdown shows `+ Create new branch: <name>` instead of "No matching branches".

### 🧪 Testing
- Added 4 new e2e tests: custom `commitMessage`, `cwd` merge into different branch, conflict `CONFLICT` throw, and `hasConflicts()` auto-detect + auto-clear.
- Added unit tests for metadata read/write with existing branches (empty `baseBranch`).

### 🐛 Bug Fixes
- Fixed existing branch spawn incorrectly setting `baseBranch` to the current branch.

---

## [0.2.5] - 2026-02-11

### ✨ New Features
- **Review Status Tracking** — Click clones to cycle through Todo → In Progress → Done → Won't Do.
- **Remote Branch Support** — Browse and select remote branches in the dropdown.
- **Base Branch Selection** — Pick any branch as the base for new clones.
- **Existing Branch Support** — Attach worktrees to existing branches.
- **Flexible Kill Options** — Choose to keep or delete the branch when killing a clone.
- **Centralized Metadata** — Single `.lumi-metadata.json` at `.shadow-clones/` root.

### 🐛 Bug Fixes
- Fixed focus-then-click guard for status cycling.
- Fixed worktree-occupied branches appearing in Branch Name dropdown.


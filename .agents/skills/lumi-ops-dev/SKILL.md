---
name: lumi-ops-dev
description: Architecture map and patterns for the Lumi-Ops VS Code extension. Read this FIRST before touching any extension source file.
---

# Lumi-Ops Extension Architecture

## File Map

| File | Size | Responsibility |
|------|------|----------------|
| `extension.ts` | ~434 lines | Activation, provider instantiation, fs.watch watchers, polling, command module registration via `CommandDeps` |
| `commands/types.ts` | ~18 lines | `CommandDeps` interface — shared dependency bag passed to all command modules |
| `commands/spawn.ts` | ~4.6KB | `lumi-ops.spawn` + `lumi-ops.refresh` commands |
| `commands/kill.ts` | ~1.9KB | `lumi-ops.kill` command (two-choice modal) |
| `commands/merge.ts` | ~7.7KB | `lumi-ops.merge` command (QuickPick target, temp worktree, post-merge delete) |
| `commands/rebase.ts` | ~2.9KB | `lumi-ops.rebase` + `lumi-ops.abortRebase` commands |
| `commands/navigation.ts` | ~2.1KB | `lumi-ops.open`, `cycleReviewStatus`, `copyBranchName`, `returnToRoot` |
| `commands/branches.ts` | ~2.1KB | `lumi-ops.getBranches` (local + remote, worktree filtering) |
| `commands/settings.ts` | ~2.6KB | `lumi-ops.openSettings`, `pickCopyFolders` |
| `commands/promptLibrary.ts` | ~10KB | All prompt library commands (CRUD, import, copy scope, inline create) |
| `commands/missionTemplate.ts` | ~6.9KB | All mission template commands (switch, edit, fork, copy scope, delete) |
| `rootAgentMode.ts` | ~2.5KB | Root Agent Mode rule file injection/removal based on setting |
| `autoStatus.ts` | ~1.7KB | `deriveCloneId()` + `setStatusIfApplicable()` — auto status transitions |
| `autoCloseWatcher.ts` | ~1.7KB | `setupAutoCloseWatcher()` — auto-close window when worktree is removed |
| `workspaceRoots.ts` | ~3.6KB | `resolveWorkspaceRoots()` — multi-root dedup, `pickRoot()` QuickPick |
| `ShadowTreeProvider.ts` | ~15KB | TreeDataProvider for "Active Clones" sidebar, multi-root grouping, `EnrichedClone` type, composite cache keys |
| `ShadowCreatorProvider.ts` | ~24KB | WebviewViewProvider for "Create Shadow Clone" form |
| `PromptLibraryViewProvider.ts` | ~29KB | WebviewViewProvider for "Prompt Library" sidebar (HTML/CSS/JS inline) |
| `PromptLibraryProvider.ts` | ~6.6KB | Prompt CRUD logic (list, save, delete, copy, scope resolution) |
| `MissionTemplateProvider.ts` | ~8.9KB | Mission template CRUD, dual-scope, active template tracking |
| `MissionTemplateEditorProvider.ts` | ~8.5KB | CustomTextEditorProvider for `.prompts/_missions/*.md` |
| `missionTemplateUtils.ts` | ~2.3KB | Shared parse/serialize for mission template markdown format |
| `WorktreeManagerPanel.ts` | ~35KB | Full WebviewPanel for multi-repo worktree dashboard |
| `StatusEventBus.ts` | ~735B | EventEmitter wrapper; fire('*') for broad refresh, fire(branch) for targeted |
| `migrations.ts` | ~3KB | One-time settings migrations across version upgrades |

## extension.ts Structure (Line Map)

After the command extraction refactor, `extension.ts` is now a clean orchestrator:

| Lines | Section |
|-------|---------|
| 1-33 | Imports (providers, commands, utilities) |
| 34-48 | Dev mode hack: auto-open monorepo root |
| 50-104 | Shadow clone MISSION.md auto-open + status-aware prompt (revision detection) |
| 109-121 | Multi-root workspace resolution via `resolveWorkspaceRoots()` |
| 122-128 | Migrations + Root Agent Mode registration |
| 130-159 | Auto-status transitions (todo→inProgress) + auto-close watcher for clone workspaces |
| 161-197 | Provider instantiation (StatusEventBus, ShadowTree, Creator, PromptLibrary, MissionTemplate, CustomEditor) |
| 199-340 | fs.watch watchers: prompts (global + project), metadata, git refs (needsRebase detection) |
| 342-365 | Polling interval (5s) for live refresh + branch change detection |
| 367-390 | WorktreeManagerPanel registration + repo auto-register |
| 392-414 | `CommandDeps` construction + all command module registration |
| 416-433 | Test API return + `deactivate()` |

## Command Registry (All Registered Commands)

### Public (user-facing, in package.json)
| Command ID | Module | Description |
|------------|--------|-------------|
| `lumi-ops.spawn` | `commands/spawn.ts` | Spawn shadow clone |
| `lumi-ops.kill` | `commands/kill.ts` | Kill shadow clone (two-choice: Clone Only / Clone + Branch) |
| `lumi-ops.merge` | `commands/merge.ts` | Squash merge with target picker |
| `lumi-ops.rebase` | `commands/rebase.ts` | Rebase clone onto its base branch |
| `lumi-ops.abortRebase` | `commands/rebase.ts` | Abort an in-progress rebase |
| `lumi-ops.refresh` | `commands/spawn.ts` | Refresh Active Clones view |
| `lumi-ops.open` | `commands/navigation.ts` | Open clone in new window |
| `lumi-ops.cycleReviewStatus` | `commands/navigation.ts` | Cycle review status badge |
| `lumi-ops.copyBranchName` | `commands/navigation.ts` | Copy branch name to clipboard |
| `lumi-ops.returnToRoot` | `commands/navigation.ts` | Navigate back to root workspace |
| `lumi-ops.openWorktreeManager` | `extension.ts` | Open multi-repo dashboard panel |
| `lumi-ops.openSettings` | `commands/settings.ts` | Open workspace settings |
| `lumi-ops.pickCopyFolders` | `commands/settings.ts` | Browse untracked items for copyOnSpawn |
| `lumi-ops.openPromptFile` | `commands/promptLibrary.ts` | Open prompt file in editor |
| `lumi-ops.saveAsPrompt` | `commands/promptLibrary.ts` | Save content as prompt template |
| `lumi-ops.getBranches` | `commands/branches.ts` | Fetch branch list for spawn form |

### Internal (webview ↔ extension, prefixed with `_`)
| Command ID | Module | Description |
|------------|--------|-------------|
| `lumi-ops._getPrompts` | `commands/promptLibrary.ts` | Fetch prompt list → webview |
| `lumi-ops._selectPrompt` | `commands/promptLibrary.ts` | Load prompt into spawn form |
| `lumi-ops._createPromptInline` | `commands/promptLibrary.ts` | Create empty prompt file |
| `lumi-ops._importFolder` | `commands/promptLibrary.ts` | Import .md files from folder |
| `lumi-ops._addPrompt` | `commands/promptLibrary.ts` | Add prompt via InputBox |
| `lumi-ops._deletePrompt` | `commands/promptLibrary.ts` | Delete prompt with confirmation |
| `lumi-ops._copyPromptScope` | `commands/promptLibrary.ts` | Copy prompt between scopes |
| `lumi-ops._editPrompt` | `commands/promptLibrary.ts` | Open prompt in text editor |
| `lumi-ops._getCloneBranches` | `commands/promptLibrary.ts` | Fetch clone branches for ✦ indicators |
| `lumi-ops._getMissionTemplates` | `commands/missionTemplate.ts` | Fetch mission template list |
| `lumi-ops._switchMission` | `commands/missionTemplate.ts` | Switch active mission template |
| `lumi-ops._editMission` | `commands/missionTemplate.ts` | Edit active mission in custom editor |
| `lumi-ops._forkMission` | `commands/missionTemplate.ts` | Fork default template to new name |
| `lumi-ops._copyMissionScope` | `commands/missionTemplate.ts` | Copy mission between scopes |
| `lumi-ops._editMissionByName` | `commands/missionTemplate.ts` | Edit specific mission by name+scope |
| `lumi-ops._deleteMission` | `commands/missionTemplate.ts` | Delete mission template |

## Command Module Pattern

All commands are organized into `commands/*.ts` modules. Each module exports a `register*Commands()` function:

```typescript
// commands/types.ts — shared dependency bag
interface CommandDeps {
  rootPath: string | undefined;
  allRoots: string[];
  shadowTreeProvider: ShadowTreeProvider;
  creatorProvider: ShadowCreatorProvider;
  promptLibraryProvider: PromptLibraryProvider;
  promptLibraryViewProvider: PromptLibraryViewProvider;
  missionTemplateProvider: MissionTemplateProvider;
  statusBus: StatusEventBus;
}

// Each module follows this pattern:
export function registerXxxCommands(
  context: vscode.ExtensionContext,
  deps: CommandDeps
): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand('lumi-ops.xxx', async () => { ... }),
  ];
}
```

## Utility Modules

### autoStatus.ts
- `deriveCloneId(wtPath)` — extracts clone ID from worktree path (e.g., `/repo.worktrees/feat/task` → `feat/task`)
- `setStatusIfApplicable(mainRepoRoot, cloneId, newStatus, eligibleFrom)` — guarded status transition

### autoCloseWatcher.ts
- `setupAutoCloseWatcher(worktreePath, deps?)` — watches parent dir; auto-closes VS Code window when worktree is removed
- Injectable `AutoCloseWatcherDeps` for testing

### workspaceRoots.ts
- `resolveWorkspaceRoots()` → `ResolvedRoot[]` — deduplicates multi-root workspace folders to repo roots
- `pickRoot(roots)` — QuickPick for multi-root selection
- `ResolvedRoot` interface: `{ rootPath, cloneWorkspacePath?, shadowBranchName?, isClone }`

## ShadowTreeProvider Key Types

```typescript
// EnrichedClone extends CLI's ShadowClone with extension-specific fields
interface EnrichedClone extends ShadowClone {
  repoRoot: string;    // multi-root: which repo this clone belongs to
  hasConflict?: boolean; // detected via GitUtils.hasConflicts()
}

// Composite cache key for multi-root isolation: "repoRoot::dirName"
function cacheKey(repoRoot: string, dirName: string): string;

// ShadowItem roles determine tree behavior
type Role = 'currentBranch' | 'shadowClone' | 'repoHeader';
```

## Webview Communication Pattern

All webviews use the same `postMessage` / `onDidReceiveMessage` pattern:

```
Extension → Webview:  webview.postMessage({ type: 'updateX', data: ... })
Webview → Extension:  vscode.postMessage({ command: 'doX', payload: ... })
```

Handler in extension.ts uses `vscode.commands.executeCommand()` to bridge.

## VS Code Views (sidebar)

| View ID | Type | Provider |
|---------|------|----------|
| `lumi-ops.activeClones` | TreeView | ShadowTreeProvider |
| `lumi-ops.creator` | WebviewView | ShadowCreatorProvider |
| `lumi-ops.promptLibrary` | WebviewView | PromptLibraryViewProvider |

## TreeView Context Values

Used in `package.json` `menus.view/item/context` for conditional menu items:

| contextValue | Meaning |
|-------------|---------|
| `shadowClone` | A worktree clone item in Active Clones view |
| `shadowClone-detached` | A clone in detached HEAD state (rebasing) |
| `repoHeader` | Multi-root repo grouping header |

## Configuration Keys

| Key | Type | Description |
|-----|------|-------------|
| `lumi-ops.activeMissionTemplate` | string | Active template in `name:scope` format |
| `lumi-ops.copyOnSpawn` | string | Newline-separated folders/files to copy |
| `lumi-ops.rootAgentMode` | boolean | Inject `.agents/rules/lumi-ops-root-agent.md` in main workspace |

## Key Patterns

### Build & Verify
Always follow the `/build-and-verify` workflow for verification.
Do NOT improvise build commands from package.json — the monorepo has specific build order requirements.

### Adding a New Command
1. Create `commands/<name>.ts` with `registerXxxCommands(context, deps)` returning `Disposable[]`
2. Import and spread into the registration block in `extension.ts` (line ~404-414)
3. Add to `contributes.commands` in `packages/extension/package.json`
4. Add menu binding in `contributes.menus` if needed
5. For internal webview commands, prefix with `_` (e.g., `lumi-ops._doThing`)

### Provider ↔ CLI Boundary
Extension Providers call CLI functions (`spawn`, `kill`, `merge`) from `@lumi-ops/cli`.
Git operations go through `GitUtils` (also from CLI). Never call git directly.

### StatusEventBus
- `statusBus.fire('*')` → all views refresh
- `statusBus.fire(branchName)` → targeted refresh
- Subscribe: `statusBus.onDidChange(handler)`

### Multi-Root Support
- `resolveWorkspaceRoots()` deduplicates workspace folders to repo roots
- `ShadowTreeProvider` uses composite cache keys (`repoRoot::dirName`) for isolation
- `EnrichedClone.repoRoot` tracks which repo each clone belongs to
- Multi-root tree shows repo headers as expandable parents

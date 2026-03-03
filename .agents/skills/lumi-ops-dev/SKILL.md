---
name: lumi-ops-dev
description: Architecture map and patterns for the Lumi-Ops VS Code extension. Read this FIRST before touching any extension source file.
---

# Lumi-Ops Extension Architecture

## File Map

| File | Size | Responsibility |
|------|------|----------------|
| `extension.ts` | ~1091 lines | Activation, all command registrations, file watchers, polling |
| `ShadowTreeProvider.ts` | ~11KB | TreeDataProvider for "Active Clones" sidebar view |
| `ShadowCreatorProvider.ts` | ~23KB | WebviewViewProvider for "Create Shadow Clone" form |
| `PromptLibraryViewProvider.ts` | ~28KB | WebviewViewProvider for "Prompt Library" sidebar (HTML/CSS/JS inline) |
| `PromptLibraryProvider.ts` | ~6KB | Prompt CRUD logic (list, save, delete, copy, scope resolution) |
| `MissionTemplateProvider.ts` | ~8KB | Mission template CRUD, dual-scope, active template tracking |
| `MissionTemplateEditorProvider.ts` | ~8KB | CustomTextEditorProvider for `.prompts/_missions/*.md` |
| `missionTemplateUtils.ts` | ~2KB | Shared parse/serialize for mission template markdown format |
| `WorktreeManagerPanel.ts` | ~35KB | Full WebviewPanel for multi-repo worktree dashboard |
| `StatusEventBus.ts` | ~700B | EventEmitter wrapper; fire('*') for broad refresh, fire(branch) for targeted |
| `migrations.ts` | ~3KB | One-time settings migrations across version upgrades |

## extension.ts Structure (Line Map)

Use this to jump directly to the relevant section instead of reading the whole file.

| Lines | Section |
|-------|---------|
| 1-15 | Imports |
| 16-61 | Dev mode hack + Shadow clone MISSION.md auto-open |
| 62-97 | Root path detection, worktree-to-root resolution, migrations |
| 98-134 | Provider instantiation (ShadowTree, Creator, PromptLibrary, MissionTemplate, CustomEditor) |
| 136-186 | fs.watch watchers (prompts, metadata) for cross-window sync |
| 188-211 | Polling interval (5s) for live refresh + branch change detection |
| 213-236 | WorktreeManagerPanel registration + repo auto-register |
| 238-299 | Commands: `openSettings`, `pickCopyFolders` |
| 301-399 | Command: `spawn` (branch fetch, base branch handling, progress) |
| 401-438 | Command: `kill` (two-choice modal: Remove Clone Only / Kill Clone + Branch) |
| 441-619 | Command: `merge` (QuickPick target, worktree detection, temp worktree, post-merge delete) |
| 621-654 | Commands: `open`, `cycleReviewStatus`, `copyBranchName`, `returnToRoot` |
| 658-700 | Command: `getBranches` (local + remote, worktree filtering) |
| 702-939 | Prompt Library commands: `_getPrompts`, `_selectPrompt`, `_createPromptInline`, `openPromptFile`, `_importFolder`, `_addPrompt`, `_deletePrompt`, `saveAsPrompt`, `_copyPromptScope`, `_editPrompt`, `_getCloneBranches` |
| 941-1087 | Mission Template commands: `_getMissionTemplates`, `_switchMission`, `_editMission`, `_forkMission`, `_copyMissionScope`, `_editMissionByName`, `_deleteMission` |
| 1090-1091 | `deactivate()` |

## Command Registry (All Registered Commands)

### Public (user-facing, in package.json)
| Command ID | Line | Description |
|------------|------|-------------|
| `lumi-ops.spawn` | 308 | Spawn shadow clone |
| `lumi-ops.kill` | 402 | Kill shadow clone (two-choice) |
| `lumi-ops.merge` | 442 | Squash merge with target picker |
| `lumi-ops.refresh` | 302 | Refresh Active Clones view |
| `lumi-ops.open` | 622 | Open clone in new window |
| `lumi-ops.cycleReviewStatus` | 632 | Cycle review status badge |
| `lumi-ops.copyBranchName` | 639 | Copy branch name to clipboard |
| `lumi-ops.returnToRoot` | 648 | Navigate back to root workspace |
| `lumi-ops.openWorktreeManager` | 215 | Open multi-repo dashboard panel |
| `lumi-ops.openSettings` | 242 | Open workspace settings |
| `lumi-ops.pickCopyFolders` | 249 | Browse untracked items for copyOnSpawn |
| `lumi-ops.openPromptFile` | 780 | Open prompt file in editor |
| `lumi-ops.saveAsPrompt` | 873 | Save content as prompt template |

### Internal (webview ↔ extension, prefixed with `_`)
| Command ID | Line | Description |
|------------|------|-------------|
| `lumi-ops._getPrompts` | 726 | Fetch prompt list → webview |
| `lumi-ops._selectPrompt` | 738 | Load prompt into spawn form |
| `lumi-ops._createPromptInline` | 752 | Create empty prompt file |
| `lumi-ops._importFolder` | 793 | Import .md files from folder |
| `lumi-ops._addPrompt` | 820 | Add prompt via InputBox |
| `lumi-ops._deletePrompt` | 848 | Delete prompt with confirmation |
| `lumi-ops._copyPromptScope` | 890 | Copy prompt between scopes |
| `lumi-ops._editPrompt` | 922 | Open prompt in text editor |
| `lumi-ops._getCloneBranches` | 936 | Fetch clone branches for ✦ indicators |
| `lumi-ops._getMissionTemplates` | 963 | Fetch mission template list |
| `lumi-ops._switchMission` | 969 | Switch active mission template |
| `lumi-ops._editMission` | 977 | Edit active mission in custom editor |
| `lumi-ops._forkMission` | 996 | Fork default template to new name |
| `lumi-ops._copyMissionScope` | 1024 | Copy mission between scopes |
| `lumi-ops._editMissionByName` | 1056 | Edit specific mission by name+scope |
| `lumi-ops._deleteMission` | 1069 | Delete mission template |
| `lumi-ops.getBranches` | 659 | Fetch branch list for spawn form |

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

## Configuration Keys

| Key | Type | Description |
|-----|------|-------------|
| `lumi-ops.activeMissionTemplate` | string | Active template in `name:scope` format |
| `lumi-ops.copyOnSpawn` | string | Newline-separated folders/files to copy |

## Key Patterns

### Adding a New Command
1. Add to `contributes.commands` in `packages/extension/package.json`
2. Add menu binding in `contributes.menus` if needed
3. Register handler inside `activate()` in `extension.ts`
4. For internal webview commands, prefix with `_` (e.g., `lumi-ops._doThing`)

### Provider ↔ CLI Boundary
Extension Providers call CLI functions (`spawn`, `kill`, `merge`) from `@lumi-ops/cli`.
Git operations go through `GitUtils` (also from CLI). Never call git directly.

### StatusEventBus
- `statusBus.fire('*')` → all views refresh
- `statusBus.fire(branchName)` → targeted refresh
- Subscribe: `statusBus.onDidChange(handler)`

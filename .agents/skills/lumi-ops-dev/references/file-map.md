# Lumi-Ops Extension — File Map

## Source Files

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

After the command extraction refactor, `extension.ts` is a clean orchestrator:

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

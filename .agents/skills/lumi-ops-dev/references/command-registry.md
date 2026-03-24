# Lumi-Ops Extension — Command Registry

## Public Commands (user-facing, in package.json)

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

## Internal Commands (webview ↔ extension, prefixed with `_`)

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

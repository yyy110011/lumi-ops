---
name: lumi-ops-dev
description: Architecture map and patterns for the Lumi-Ops VS Code extension. Use when modifying extension commands, adding new webview providers, fixing sidebar issues, touching ShadowTreeProvider, updating the spawn/kill/merge flow, or working on any file under packages/extension/src/. Read this FIRST before touching any extension source file.
---

# Lumi-Ops Extension Architecture

## Instructions

### Step 1: Understand the Architecture

The extension lives in `packages/extension/src/`. After the command extraction refactor, `extension.ts` is a clean orchestrator — it wires up providers, watchers, and delegates all command logic to `commands/*.ts` modules.

For the full file-by-file map, consult `references/file-map.md`.
For the complete command registry (public + internal), consult `references/command-registry.md`.

### Step 2: Follow the Command Module Pattern

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

### Step 3: Adding a New Command

1. Create `commands/<name>.ts` with `registerXxxCommands(context, deps)` returning `Disposable[]`
2. Import and spread into the registration block in `extension.ts` (line ~404-414)
3. Add to `contributes.commands` in `packages/extension/package.json`
4. Add menu binding in `contributes.menus` if needed
5. For internal webview commands, prefix with `_` (e.g., `lumi-ops._doThing`)

### Step 4: Verify Changes

Always follow the `/build-and-verify` workflow for verification.
Do NOT improvise build commands from package.json — the monorepo has specific build order requirements.

## Key Patterns

### Provider ↔ CLI Boundary
Extension Providers call CLI functions (`spawn`, `kill`, `merge`) from `@lumi-ops/cli`.
Git operations go through `GitUtils` (also from CLI). Never call git directly.

### StatusEventBus
- `statusBus.fire('*')` → all views refresh
- `statusBus.fire(branchName)` → targeted refresh
- Subscribe: `statusBus.onDidChange(handler)`

### Webview Communication
All webviews use the same `postMessage` / `onDidReceiveMessage` pattern:

```
Extension → Webview:  webview.postMessage({ type: 'updateX', data: ... })
Webview → Extension:  vscode.postMessage({ command: 'doX', payload: ... })
```

### Multi-Root Support
- `resolveWorkspaceRoots()` deduplicates workspace folders to repo roots
- `ShadowTreeProvider` uses composite cache keys (`repoRoot::dirName`) for isolation
- `EnrichedClone.repoRoot` tracks which repo each clone belongs to

### VS Code Views (sidebar)

| View ID | Type | Provider |
|---------|------|----------|
| `lumi-ops.activeClones` | TreeView | ShadowTreeProvider |
| `lumi-ops.creator` | WebviewView | ShadowCreatorProvider |
| `lumi-ops.promptLibrary` | WebviewView | PromptLibraryViewProvider |

### Configuration Keys

| Key | Type | Description |
|-----|------|-------------|
| `lumi-ops.activeMissionTemplate` | string | Active template in `name:scope` format |
| `lumi-ops.copyOnSpawn` | string | Newline-separated folders/files to copy |
| `lumi-ops.rootAgentMode` | boolean | Inject `.agents/rules/lumi-ops-root-agent.md` in main workspace |

## Troubleshooting

| Symptom | Cause | Solution |
|---------|-------|----------|
| Extension not activating | Not in a git repo or missing workspace folder | Ensure VS Code has a folder open that is a git repository |
| Active Clones view empty | Metadata file not found or wrong root | Check that `<repo>.worktrees/.lumi-metadata.json` exists; run `lumi-ops list` from CLI |
| Webview not updating | StatusEventBus event not fired | Ensure `statusBus.fire('*')` is called after mutations |
| Build fails | Wrong build order in monorepo | Follow `/build-and-verify` workflow — CLI must build before extension |
| Command not found | Missing registration in `package.json` | Add to `contributes.commands` AND register in `extension.ts` |

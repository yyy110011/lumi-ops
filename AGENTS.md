# AGENTS.md

AI Agent Development Guide for the Lumi-Ops project.

## Project Overview

Lumi-Ops implements the **Shadow Clone Protocol** — a workflow that uses Git Worktrees to create isolated, ephemeral workspaces for parallel AI-assisted development. It consists of a **CLI** and a **VS Code Extension**.

## Monorepo Structure

```
lumi-ops/
├── packages/
│   ├── cli/                  # Core logic (TypeScript, published as @lumi-ops/cli)
│   │   └── src/
│   │       ├── commands/     # spawn, kill, list, merge (+tests side-by-side)
│   │       ├── utils/git.ts  # GitUtils wrapper class
│   │       ├── constants.ts  # SHADOW_CLONES_DIR, METADATA_FILE, ReviewStatus
│   │       └── index.ts      # CLI entry + library exports
│   ├── extension/            # VS Code Extension (depends on @lumi-ops/cli)
│   │   └── src/
│   │       ├── extension.ts           # Activation, command registration
│   │       ├── ShadowTreeProvider.ts  # Tree view (Active Clones dashboard)
│   │       └── ShadowCreatorProvider.ts # Webview (Spawn form)
│   └── mcp-server/           # MCP server (in development)
├── doc/                      # Design documents and feature proposals
├── package.json              # Workspace root (pnpm monorepo)
└── pnpm-workspace.yaml
```

## Tech Stack

- **Language**: TypeScript (strict mode)
- **Package Manager**: pnpm (workspace protocol)
- **CLI Framework**: Commander.js
- **Extension Bundler**: esbuild
- **Test Framework**: Vitest (CLI), Mocha (Extension)
- **Git Operations**: `child_process.execFile` wrapping git commands via `GitUtils`

## Key Conventions

### 1. CLI is the source of truth
All git worktree logic lives in `packages/cli`. The extension imports from `@lumi-ops/cli` — never calls git directly. If you need new git functionality, add it to `GitUtils` first, then consume it in the extension.

### 2. Test files are co-located
Tests sit next to their source: `spawn.ts` → `spawn.test.ts`. Run with `pnpm test` from the CLI package or the repo root.

### 3. Constants are centralized
`SHADOW_CLONES_DIR` (`.shadow-clones`) and `METADATA_FILE` (`.lumi-metadata.json`) are defined in `constants.ts`. Never hardcode these strings.

### 4. Shadow clones directory
All worktrees are created under `<repo>/.shadow-clones/<branch-name>/`. This directory is gitignored. Metadata for all clones is stored in `.shadow-clones/.lumi-metadata.json` (centralized, not per-clone).

### 5. Extension activation
The extension auto-detects whether it's in a **root workspace** (shows Active Clones + Spawn form) or a **shadow clone** (opens MISSION.md automatically). Detection is done by checking for MISSION.md in the workspace root.

## Common Tasks

### Adding a new CLI command
1. Create `packages/cli/src/commands/<name>.ts` with an exported async function
2. Create `packages/cli/src/commands/<name>.test.ts` with Vitest tests
3. Export from `packages/cli/src/index.ts`
4. Register in the Commander program in `index.ts`

### Adding a new extension command
1. Define the command in `packages/extension/package.json` under `contributes.commands`
2. Add menu bindings under `contributes.menus` (e.g., `view/item/context`)
3. Register the handler in `extension.ts` with `vscode.commands.registerCommand`

### Adding a new config setting
1. Define in `packages/extension/package.json` under `contributes.configuration`
2. Read with `vscode.workspace.getConfiguration('lumi-ops')`

## Build & Test

```bash
# Install dependencies
pnpm install

# Run all tests
pnpm test

# Run CLI tests only
cd packages/cli && pnpm test

# Build extension
cd packages/extension && pnpm run build

# Watch mode (extension)
cd packages/extension && pnpm run watch
```

## Debugging the Extension

1. Open the monorepo root in VS Code
2. Press `F5` — this launches the Extension Development Host
3. The extension auto-opens the monorepo root in dev mode if no folder is open

## Important Rules

- **Never nest worktrees**: Do not spawn a shadow clone from inside another shadow clone.
- **Current branch is protected**: The branch checked out in the main workspace cannot be killed or merged.
- **Graceful failures**: All git operations should fail gracefully with user-friendly messages. Never `process.exit(1)` from library code (only from CLI entry point).
- **Cross-platform**: Use `path.join` / `path.resolve` for all paths. Do not hardcode `/` or `\\`.

## Release Process

Releases are triggered by **pushing a Git tag** (e.g., `git tag v0.2.6 && git push origin v0.2.6`). CI automatically builds, bumps versions, and publishes to the VS Code Marketplace and Open VSX.

**Before tagging a release, you MUST update user-facing documentation:**

1. **`packages/extension/README.md`** — This is what users see on the **Marketplace page**. Add/update feature descriptions, usage instructions, and screenshots.
2. **`README.md`** (root) — Repo landing page on GitHub. Keep the features list and CLI examples in sync.
3. **`CHANGELOG.md`** — Add a new version section documenting new features, improvements, and bug fixes.

**Do NOT** manually bump `version` in `package.json` — CI handles this based on the tag.

## References

### Core Technologies
- [VS Code Extension API](https://code.visualstudio.com/api)
- [VS Code TreeView Guide](https://code.visualstudio.com/api/extension-guides/tree-view)
- [VS Code Webview Guide](https://code.visualstudio.com/api/extension-guides/webview)
- [Git Worktree Documentation](https://git-scm.com/docs/git-worktree)
- [Commander.js](https://github.com/tj/commander.js)

### Testing
- [Vitest](https://vitest.dev/) — CLI test framework
- [VS Code Extension Testing](https://code.visualstudio.com/api/working-with-extensions/testing-extension)

### Project Resources
- [GitHub Repository](https://github.com/yyy110011/lumi-ops)
- [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=ZunRenYao.lumi-ops)
- [`doc/`](./doc/) — Design documents and feature proposals

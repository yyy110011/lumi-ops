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
│   │       ├── commands/     # spawn, kill, list, merge, migration (+tests side-by-side)
│   │       ├── utils/git.ts  # GitUtils wrapper class (simple-git)
│   │       ├── constants.ts  # SHADOW_CLONES_DIR, METADATA_FILE, ReviewStatus
│   │       └── index.ts      # CLI entry + library exports
│   ├── extension/            # VS Code Extension (depends on @lumi-ops/cli)
│   │   └── src/
│   │       ├── extension.ts                  # Activation, command registration
│   │       ├── ShadowTreeProvider.ts         # Tree view (Active Clones dashboard)
│   │       ├── ShadowCreatorProvider.ts      # Webview (Spawn form)
│   │       ├── PromptLibraryProvider.ts      # Prompt Library data (list, CRUD, copy)
│   │       ├── PromptLibraryViewProvider.ts  # Prompt Library & Mission Template UI
│   │       └── migrations.ts                # Settings migrations across versions
│   └── mcp-server/           # MCP server (planned)
├── .prompts/                 # Reusable task prompts (project scope)
├── doc/                      # Design documents and feature proposals
├── package.json              # Workspace root (pnpm monorepo)
└── pnpm-workspace.yaml
```

## Tech Stack

- **Language**: TypeScript (strict mode)
- **Package Manager**: pnpm (workspace protocol)
- **CLI Framework**: Commander.js
- **Git Operations**: `simple-git` library, wrapped via `GitUtils` class
- **Extension Bundler**: esbuild
- **Test Framework**: Vitest

## Key Conventions

### 1. CLI is the source of truth
All git worktree logic lives in `packages/cli`. The extension imports from `@lumi-ops/cli` — never calls git directly. If you need new git functionality, add it to `GitUtils` first, then consume it in the extension.

### 2. Test files are co-located
Tests sit next to their source: `spawn.ts` → `spawn.test.ts`. Run with `pnpm test` from the CLI package or the repo root.

### 3. Constants are centralized
`METADATA_FILE` (`.lumi-metadata.json`) is defined in `constants.ts`. Never hardcode these strings.

### 4. Shadow clones directory
All worktrees are created under `<repo>.worktrees/<branch-name>/`. This directory lives outside the source repository. Metadata for all clones is stored in `<repo>.worktrees/.lumi-metadata.json` (centralized, not per-clone).

### 5. Extension activation
The extension auto-detects whether it's in a **root workspace** (shows Active Clones + Spawn form + Prompt Library) or a **shadow clone** (opens MISSION.md automatically). Detection is done by checking for MISSION.md in the workspace root.

### 6. Prompt Library & Mission Templates
- Prompts and mission templates support **dual scope**: Project (`<repo>/.prompts/`) and Global (`~/.lumi-ops/.prompts/`).
- Mission templates live in `_missions/` subdirectory within the prompts directory.
- P and G scope items are **independent objects** — they are listed separately, can be copied cross-scope, and are never implicitly moved.
- The active mission template is stored as `"name:scope"` format in `lumi-ops.activeMissionTemplate` workspace setting.

### 7. Task prompts go in `.prompts/`
When creating reusable task prompts for shadow clones, save them as `.md` files in the `.prompts/` directory at the project root. Use kebab-case naming (e.g., `fix-auth-bug.md`, `add-feature-x.md`). These prompts can be used by the Prompt Library to generate MISSION.md files for shadow clones.

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
3. Use `ConfigurationTarget.Workspace` for project-specific settings (never Global for project state)

## Build & Test

```bash
# Install dependencies
pnpm install

# Run all tests
pnpm -r test

# Run CLI tests only
cd packages/cli && npx vitest run

# Build CLI (required before extension build)
cd packages/cli && npm run build

# Build extension
cd packages/extension && npm run package

# Package extension as VSIX
cd packages/extension && npx @vscode/vsce package --no-dependencies

# Watch mode (extension)
cd packages/extension && npm run watch
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
- **Workspace-scoped settings**: Use `ConfigurationTarget.Workspace` for any project-specific state. Never `ConfigurationTarget.Global` for settings that should differ between projects.

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
- [simple-git](https://github.com/steveukx/git-js)

### Testing
- [Vitest](https://vitest.dev/) — Test framework

### Project Resources
- [GitHub Repository](https://github.com/yyy110011/lumi-ops)
- [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=ZunRenYao.lumi-ops)
- [`doc/`](./doc/) — Design documents and feature proposals

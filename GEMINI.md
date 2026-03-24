# Lumi-Ops Context for Gemini

## Project Overview

**Lumi-Ops** (Luminescent Operations) is a **Shadow Clone Protocol** for AI Agents. It is designed to enable a workflow where multiple AI agents can work on different features simultaneously in isolated **Git Worktrees** ("Shadow Clones"), without interfering with the user's main development environment.

### Key Concepts
*   **Shadow Clones:** Isolated git worktrees created in a `<repo>.worktrees/` directory directly alongside the workspace. Each clone has its own branch and working directory.
*   **Agent Context:** Automatically generates a `MISSION.md` file in the clone to guide the AI agent.
*   **Prompt Library:** A system to save, reuse, and manage task prompts (templates), supporting both global (`~/.lumi-ops/.prompts/`) and project-local (`<repo>.worktrees/.prompts/`) scopes.
*   **Workflow:** Spawn -> Work (Agent) -> Squash & Merge -> Kill.
*   **Monorepo:** The project is a monorepo managed with **pnpm workspaces**.

## Repository Structure

```
/Users/ryan/project_in_progress/lumi-ops/
├── packages/
│   ├── cli/             # Core logic and CLI tool (npm package: @lumi-ops/cli)
│   │   ├── src/         # Source code (TypeScript)
│   │   ├── dist/        # Compiled output
│   │   └── package.json # Dependencies: simple-git, commander, etc.
│   ├── extension/       # VS Code Extension (npm package: lumi-ops)
│   │   ├── src/         # Extension source (TypeScript)
│   │   ├── media/       # Icons and assets
│   │   └── package.json # VS Code specific config (activationEvents, contributes)
│   └── mcp-server/      # MCP server (published as @lumi-ops/mcp-server)
├── doc/                 # Design documents and roadmaps
├── package.json         # Root configuration (scripts, devDependencies)
├── pnpm-workspace.yaml  # Workspace definition
└── README.md            # Project documentation
```

## Development & Build

### Prerequisites
*   Node.js & pnpm
*   Git

### Core Commands (Root)
*   **Install Dependencies:** `pnpm install`
*   **Build All Packages:** `pnpm -r build` (builds CLI first, then Extension)
*   **Run Tests:** `pnpm -r test`
*   **Development Watch Mode:** `pnpm -r dev`

### Package-Specifics

**CLI (`packages/cli`):**
*   **Build:** `npm run build` (uses `tsc`)
*   **Test:** `vitest run` (excludes e2e by default)
*   **E2E Test:** `npm run test:e2e`
*   **Usage:** `lumi-ops spawn <branch>`, `lumi-ops list`, `lumi-ops kill`, `lumi-ops merge`

**Extension (`packages/extension`):**
*   **Build/Package:** `npm run package` (uses `esbuild` to bundle)
*   **Watch:** `npm run watch`
*   **Debugging:** Open the project in VS Code and press **F5** to launch the "Extension Development Host".

## Architecture & Roadmap

### Current Status (v0.5.4)
*   **MCP Server:** `@lumi-ops/mcp-server` — 15 tools, 6 resources, 4 prompt templates. Cross-repo support via required `repo` parameter on all branch-targeting tools.
*   **Mission Template System:** Custom MISSION.md templates with structured fields, dual-scope, custom editor, fork/copy.
*   **Prompt Library:** Redesigned with per-item actions, scope badges, integrated mission dropdown.
*   **Review Protocol:** Agent writes `MISSION_COMPLETE.md` → sets `needsReview` → root agent reviews via `review_clone` → approves or `request_revision`.
*   **Clone Agent Rules:** Auto-inject executor rules into clones.
*   **Root Agent Mode:** Strategist rules for main workspace.
*   **Worktree Manager (Beta):** Multi-repo dashboard with global repo registry.
*   **Copy on Spawn:** Configurable folders/files to copy from root to clone.
*   **Auto-Close Window:** Clone windows auto-close when the worktree is killed via `fs.watch`.
*   **Beta CI:** `develop` branch builds and uploads `.vsix` artifact for manual testing (no marketplace publishing).
*   **Core Ops:** Spawn, Kill, List, Merge (Squash) are functional.
*   **UI:** VS Code sidebar with "Active Clones" view, "Create Shadow Clone" webview, and Prompt Library webview.

### Future Plans
*   **v0.6 Background Agents:** Introduce "Drivers" (e.g., `antigravity`, `tmux`) to automate agent startup and execution in the background immediately after spawning a clone.
*   **v0.7 MCP Agent Sandbox:** Allow agents to safely execute commands via `exec_in_clone` with path traversal defense.

## ⛔ Release Rules (MANDATORY)
*   **NEVER manually bump `version` in any `package.json`** — CI handles version bumping automatically.
*   **Stable release:** merge to `main`, then `git tag -a vX.Y.Z -m "..." && git push origin vX.Y.Z`.
*   **Beta build:** push to `develop` — CI builds and uploads `.vsix` artifact for manual testing (no marketplace publishing).

## Coding Conventions
*   **Language:** TypeScript throughout.
*   **Style:** Follows standard TypeScript/ESLint practices.
*   **Testing:** `vitest` is the test runner.
*   **Separation of Concerns:** Core logic resides in `cli` and should be reusable; `extension` handles UI and VS Code integration.

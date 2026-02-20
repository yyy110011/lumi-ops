# Lumi-Ops Context for Gemini

## Project Overview

**Lumi-Ops** (Luminescent Operations) is a **Shadow Clone Protocol** for AI Agents. It is designed to enable a workflow where multiple AI agents can work on different features simultaneously in isolated **Git Worktrees** ("Shadow Clones"), without interfering with the user's main development environment.

### Key Concepts
*   **Shadow Clones:** Isolated git worktrees created in a `.shadow-clones/` directory. Each clone has its own branch and working directory.
*   **Agent Context:** Automatically generates a `MISSION.md` file in the clone to guide the AI agent.
*   **Prompt Library:** A system to save, reuse, and manage task prompts (templates), supporting both global (`~/.lumi-ops/`) and project-local (`.lumi-ops/`) scopes.
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
│   └── mcp-server/      # Future Module: MCP Agent Sandbox (currently stub/artifacts)
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

### Current Status (v0.3.x)
*   **Prompt Library:** Implemented dual-scope storage and UI integration.
*   **Core Ops:** Spawn, Kill, List, Merge (Squash) are functional.
*   **UI:** VS Code sidebar with "Active Clones" view and "Create Shadow Clone" webview.

### Future Plans
*   **v0.4 Shadow Mode:** Distinct UI when VS Code is opened inside a shadow clone (worktree).
*   **v0.5 MCP Agent Sandbox:** Allow agents to safely execute commands via the Model Context Protocol (MCP).
*   **Background Agents:** Plans to introduce "Drivers" (e.g., `antigravity`, `tmux`) to automate agent startup and execution in the background immediately after spawning a clone.

## Coding Conventions
*   **Language:** TypeScript throughout.
*   **Style:** Follows standard TypeScript/ESLint practices.
*   **Testing:** `vitest` is the test runner.
*   **Separation of Concerns:** Core logic resides in `cli` and should be reusable; `extension` handles UI and VS Code integration.

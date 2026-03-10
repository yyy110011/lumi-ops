# 👻 Lumi-Ops

[![CI Build](https://github.com/yyy110011/lumi-ops/actions/workflows/ci.yml/badge.svg)](https://github.com/yyy110011/lumi-ops/actions/workflows/ci.yml)
[![Publish](https://github.com/yyy110011/lumi-ops/actions/workflows/publish.yml/badge.svg)](https://github.com/yyy110011/lumi-ops/actions/workflows/publish.yml)
[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/ZunRenYao.lumi-ops?style=flat&label=VS%20Code&logo=visualstudiocode)](https://marketplace.visualstudio.com/items?itemName=ZunRenYao.lumi-ops)
[![Open VSX](https://img.shields.io/open-vsx/v/ZunRenYao/lumi-ops?style=flat&label=Open%20VSX&logo=eclipse-ide)](https://open-vsx.org/extension/ZunRenYao/lumi-ops)
[![npm](https://img.shields.io/npm/v/@lumi-ops/mcp-server?style=flat&label=npm&logo=npm)](https://www.npmjs.com/package/@lumi-ops/mcp-server)
[![Downloads](https://img.shields.io/open-vsx/dt/ZunRenYao/lumi-ops?style=flat&label=Downloads)](https://open-vsx.org/extension/ZunRenYao/lumi-ops)
[![License: GPL-3.0](https://img.shields.io/badge/License-GPL--3.0-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)
[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-☕-yellow?style=flat)](https://buymeacoffee.com/ryanzryao)

**Lumi-Ops** (Luminescent Operations) is a **Shadow Clone Protocol** for AI Agents.

Spawn isolated **Git Worktrees** ("Shadow Clones") so multiple AI Agents can work on different features simultaneously — without interfering with your main development environment.

### 🆕 v0.3.8 — Mission Templates & Worktree Manager
- **Mission Template System** — Custom MISSION.md templates with structured fields (Task/Rules/Instructions), dual-scope, and a built-in form editor.
- **Worktree Manager (Beta)** — Multi-repo dashboard to monitor all worktrees across projects in one panel.
- **Copy on Spawn** — Auto-copy configured folders/files from root into new clones.
- **Prompt Library Redesign** — Per-item actions (copy scope, edit, delete) and integrated mission template dropdown.

## 📦 Monorepo Structure

```
packages/
├── cli/         # Core logic & CLI (spawn, kill, list, merge)
├── extension/   # VS Code / Antigravity Extension UI
└── mcp-server/  # MCP Server (published as @lumi-ops/mcp-server)
```

## 🔌 MCP Server

Let your AI agent spawn, review, and merge clones for you — hands-free. Connect any MCP-compatible agent:

```bash
npx @lumi-ops/mcp-server
```

See [`packages/mcp-server/README.md`](packages/mcp-server/README.md) for config examples (Antigravity, VS Code, Cursor, Windsurf, Claude Desktop).

## 🚀 Getting Started (Development)

```bash
pnpm install
pnpm -r build
```

Press **F5** in VS Code / Antigravity to launch the Extension Development Host.

## ✨ Features

- **Spawn Shadow Clones** — Create a new branch + worktree instantly from the sidebar.
- **Agent Context** — Auto-generates `MISSION.md` with the task objective for your AI Agent.
- **Mission Templates** — Define reusable MISSION.md templates with Task / Rules / Instructions fields. Dual-scope (Global + Project), custom editor, fork & copy across scopes.
- **Shadow Mode UI** — When opened inside a Shadow Clone, the UI is fully unified with Root Mode. All operations (Spawn, Kill, Merge) are available. Your current clone is marked with `★`.
- **Prompt Library** — Save and reuse task descriptions as templates. Dual-scope storage (Global `~/.lumi-ops/.prompts/` + Project `<repoRoot>/.prompts/`). Per-item scope badges, edit, copy, and delete actions. Cross-window sync.
- **Worktree Manager (Beta)** — Multi-repo dashboard showing all registered repos and worktrees in one panel. Review status cycling and inline notes.
- **Non-Blocking** — Main window stays on your current branch. Spawn as many agents as you want.
- **Squash & Merge** — Select a target branch and merge with one click. Base branch shown as `← recommended`.
- **Conflict Detection** — Unresolved merge conflicts are detected and shown with ⚠️ in the sidebar.
- **Copy on Spawn** — Configure folders/files to auto-copy from root to clone via `lumi-ops.copyOnSpawn` setting.
- **Dropdown Search** — Branch Name and Base Branch inputs filter branches in real-time as you type. Press Esc to dismiss.
- **Copy Branch Name** — Right-click any clone to copy its branch name to the clipboard.
- **Current Branch Protection** — Your active branch cannot be accidentally killed from the sidebar.
- **Branches from Current** — Clones branch off your current branch, not hardcoded `main`.

## 🛠️ CLI Usage

```bash
# Spawn a shadow clone
lumi-ops spawn feat/login --description "Implement OAuth login"

# List active clones
lumi-ops list

# Kill a clone
lumi-ops kill feat/login

# Squash & merge (into current branch by default)
lumi-ops merge feat/login

# Squash & merge into a specific target branch
lumi-ops merge feat/login --cwd /path/to/target
```

## ⚙️ Requirements

- Git installed and available in PATH.
- An AI-enabled IDE (Antigravity, Cursor, Windsurf, VS Code) for best results.

## 📄 License

[GPL-3.0-or-later](LICENSE)

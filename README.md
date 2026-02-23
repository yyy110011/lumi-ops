# 👻 Lumi-Ops

[![CI Build](https://github.com/yyy110011/lumi-ops/actions/workflows/ci.yml/badge.svg)](https://github.com/yyy110011/lumi-ops/actions/workflows/ci.yml)
[![Publish](https://github.com/yyy110011/lumi-ops/actions/workflows/publish.yml/badge.svg)](https://github.com/yyy110011/lumi-ops/actions/workflows/publish.yml)
[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/ZunRenYao.lumi-ops?style=flat&label=VS%20Code&logo=visualstudiocode)](https://marketplace.visualstudio.com/items?itemName=ZunRenYao.lumi-ops)
[![Open VSX](https://img.shields.io/open-vsx/v/ZunRenYao/lumi-ops?style=flat&label=Open%20VSX&logo=eclipse-ide)](https://open-vsx.org/extension/ZunRenYao/lumi-ops)
[![Downloads](https://img.shields.io/open-vsx/dt/ZunRenYao/lumi-ops?style=flat&label=Downloads)](https://open-vsx.org/extension/ZunRenYao/lumi-ops)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-☕-yellow?style=flat)](https://buymeacoffee.com/ryanzryao)

**Lumi-Ops** (Luminescent Operations) is a **Shadow Clone Protocol** for AI Agents.

Spawn isolated **Git Worktrees** ("Shadow Clones") so multiple AI Agents can work on different features simultaneously — without interfering with your main development environment.

## 📦 Monorepo Structure

```
packages/
├── cli/         # Core logic & CLI (spawn, kill, list, merge)
└── extension/   # VS Code / Antigravity Extension UI
```

## 🚀 Getting Started (Development)

```bash
pnpm install
pnpm -r build
```

Press **F5** in VS Code / Antigravity to launch the Extension Development Host.

## ✨ Features

- **Spawn Shadow Clones** — Create a new branch + worktree instantly from the sidebar.
- **Agent Context** — Auto-generates `MISSION.md` with the task objective for your AI Agent.
- **Prompt Library** — Save and reuse task descriptions as templates. Dual-scope storage (Global `~/.lumi-ops/.prompts/` + Project `<repo>.worktrees/.prompts/`). Select prompts from a dropdown, import folders, and move between scopes.
- **Non-Blocking** — Main window stays on your current branch. Spawn as many agents as you want.
- **Squash & Merge** — Select a target branch and merge with one click. Base branch shown as `← recommended`.
- **Conflict Detection** — Unresolved merge conflicts are detected and shown with ⚠️ in the sidebar.
- **Dropdown Search** — Branch Name and Base Branch inputs filter branches in real-time as you type. Press Esc to dismiss.
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

MIT

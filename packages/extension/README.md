# 👻 Lumi-Ops

**Shadow Clone Protocol for AI Agents.**
Scale your development by spawning isolated "Shadow Clones" for your AI Agents.

[![CI Build](https://github.com/yyy110011/lumi-ops/actions/workflows/ci.yml/badge.svg)](https://github.com/yyy110011/lumi-ops/actions/workflows/ci.yml)
[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/ZunRenYao.lumi-ops?style=flat&label=VS%20Code&logo=visualstudiocode)](https://marketplace.visualstudio.com/items?itemName=ZunRenYao.lumi-ops)
[![Open VSX](https://img.shields.io/open-vsx/v/ZunRenYao/lumi-ops?style=flat&label=Open%20VSX&logo=eclipse-ide)](https://open-vsx.org/extension/ZunRenYao/lumi-ops)
[![Downloads](https://img.shields.io/open-vsx/dt/ZunRenYao/lumi-ops?style=flat&label=Downloads)](https://open-vsx.org/extension/ZunRenYao/lumi-ops)
[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-☕-yellow?style=flat)](https://buymeacoffee.com/ryanzryao)

### 🆕 v0.3.8 — Mission Templates & Worktree Manager
- **Mission Template System** — Custom MISSION.md templates with structured fields (Task/Rules/Instructions), dual-scope, and a built-in form editor.
- **Worktree Manager (Beta)** — Multi-repo dashboard to monitor all worktrees across projects in one panel.
- **Copy on Spawn** — Auto-copy configured folders/files from root into new clones.
- **Prompt Library Redesign** — Per-item actions (copy scope, edit, delete) and integrated mission template dropdown.

---

## 💡 What is Lumi-Ops?

Lumi-Ops enables a **Multi-Threaded Coding Workflow**. Instead of blocking your main editor while an AI Agent writes code, you can "Spawn a Shadow Clone" — an isolated **Git Worktree** with a `MISSION.md` file containing your instructions. Let AI work there, and squash merge it back when done.

![Sidebar Overview](https://raw.githubusercontent.com/yyy110011/lumi-ops/main/packages/extension/media/sidebar-overview.png)

---

## 🚀 Quick Start

**1. Spawn** — Fill in a branch name and task description, then click **Spawn Agent**.

![Spawn Flow](https://raw.githubusercontent.com/yyy110011/lumi-ops/main/packages/extension/media/spawn-flow.png)

**2. Work** — Open the clone in a new window. Tag `@MISSION.md` in your AI chat to give the agent its instructions.

**3. Merge** — Right-click the clone → **Squash & Merge** → select target branch. Done.

> **Tip**: Leave the description empty and click **Create Clone Only** to create a worktree without `MISSION.md` — useful when you just need an isolated workspace.

---

## ✨ Features

### ⚡ Spawn in Seconds
- **No Stashing** — Keep your current work as-is.
- **Base Branch Selection** — Pick any local or remote branch as the base, defaulting to your current branch.
- **Existing Branch Support** — Select an existing branch or type a new name to create a fresh branch.
- **Copy on Spawn** — Configure folders/files to auto-copy from root to clone via `lumi-ops.copyOnSpawn` setting.

### 📄 Mission Templates
Define reusable MISSION.md templates with **Task / Rules / Instructions** fields. Templates support dual-scope (Global + Project), and open in a built-in form editor.

![Mission Template Editor](https://raw.githubusercontent.com/yyy110011/lumi-ops/main/packages/extension/media/mission-template.png)

### 📚 Prompt Library
Save and reuse task descriptions as prompt templates. Click a prompt to load it into the spawn form. Manage templates with per-item copy, edit, and delete actions.

![Prompt Library](https://raw.githubusercontent.com/yyy110011/lumi-ops/main/packages/extension/media/prompt-library.png)

- **Dual-Scope** — Global (`~/.lumi-ops/.prompts/`) + Project (`<repoRoot>/.prompts/`). Each prompt shows a **[G]** or **[P]** badge.
- **Cross-Window Sync** — Prompts sync in real-time across Root and Clone windows.
- **Mission Dropdown** — Switch mission templates directly from the Prompt Library panel.

### 📋 Review Status Tracking
Click a clone to cycle through: **○ Todo** → **🔄 In Progress** → **✓ Done** → **✗ Won't Do**

### 🔀 Squash & Merge
- **Target Branch Selection** — Choose which branch to merge into. Base branch is marked `← recommended`.
- **Conflict Detection** — Clones with unresolved conflicts show ⚠️ in the sidebar.

### 👻 Shadow Mode
When opened inside a Shadow Clone, the UI is fully unified with Root Mode — all operations available, current clone marked with `★`. Click 🏠 to return to root.

### 🗂️ Worktree Manager (Beta)
A multi-repo dashboard to monitor all your worktrees from a single panel.

![Worktree Manager](https://raw.githubusercontent.com/yyy110011/lumi-ops/main/packages/extension/media/worktree-manager.png)

### 🔍 Other Features
- **Dropdown Search** — Branch inputs filter in real-time as you type.
- **Copy Branch Name** — Right-click any clone to copy its branch name.
- **Current Branch Protection** — Your active branch cannot be accidentally killed.
- **Flexible Kill** — Choose to keep or delete the branch when removing a clone.

---

## ⚙️ Requirements

- Git installed and available in your PATH.
- An AI-enabled IDE (Antigravity, Cursor, Windsurf, VS Code) for best results.

## 🔗 Links

- [GitHub Repository](https://github.com/yyy110011/lumi-ops)
- [Issues](https://github.com/yyy110011/lumi-ops/issues)

**Enjoy Multi-Threaded Coding!** 👻

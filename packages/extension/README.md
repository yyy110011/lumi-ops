# 👻 Lumi-Ops

**Shadow Clone Protocol for AI Agents.**
Scale your development by spawning isolated "Shadow Clones" for your AI Agents.

[![CI Build](https://github.com/yyy110011/lumi-ops/actions/workflows/ci.yml/badge.svg)](https://github.com/yyy110011/lumi-ops/actions/workflows/ci.yml)
[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/ZunRenYao.lumi-ops?style=flat&label=VS%20Code&logo=visualstudiocode)](https://marketplace.visualstudio.com/items?itemName=ZunRenYao.lumi-ops)
[![Open VSX](https://img.shields.io/open-vsx/v/ZunRenYao/lumi-ops?style=flat&label=Open%20VSX&logo=eclipse-ide)](https://open-vsx.org/extension/ZunRenYao/lumi-ops)
[![Downloads](https://img.shields.io/open-vsx/dt/ZunRenYao/lumi-ops?style=flat&label=Downloads)](https://open-vsx.org/extension/ZunRenYao/lumi-ops)
[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-☕-yellow?style=flat)](https://buymeacoffee.com/ryanzryao)

## 💡 What is Lumi-Ops?

Lumi-Ops enables a **Multi-Threaded Coding Workflow**. Instead of blocking your main editor while an AI Agent writes code, you can "Spawn a Shadow Clone".

This creates a **Git Worktree** in a hidden folder, equipped with a `MISSION.md` file containing your instructions. Open that folder in a new window, let the AI work there, and squash merge it back when done.

## ✨ Key Features

### ⚡ Spawn in Seconds
Create a new branch and fresh worktree instantly from the Sidebar.
- **No Stashing** — Keep your current work as-is.
- **Base Branch Selection** — Pick any local or remote branch as the base, defaulting to your current branch.
- **Remote Branch Support** — Browse and select remote branches directly from the dropdown. They are fetched automatically without switching your working directory.
- **Existing Branch Support** — Select an existing branch to attach a worktree to it, or type a new name to create a fresh branch.

### 📝 Agent Context (`MISSION.md`)
When you spawn a clone with a task description, Lumi-Ops auto-generates a `MISSION.md` file in the new clone with your mission objective. Tag `@MISSION.md` in your AI chat to give the agent its instructions.

> **Tip**: Leave the description empty and click **Create Clone Only** to create a worktree without `MISSION.md` — useful when you just need an isolated workspace.

### 📚 Prompt Library
Save and reuse task descriptions as **prompt templates** across projects:
- **Dual-Scope Storage** — Global prompts (`~/.lumi-ops/.prompts/*.md`) are shared across all projects. Project prompts (`<repoRoot>/.prompts/*.md`) are repo-specific.
- **Cross-Window Sync** — Prompts are synced in real-time across Root and Shadow Clone windows via file system watchers.
- **Inline Creation** — Double-click the prompt list to create a new prompt inline, right from the dropdown.
- **Scope Badges** — Each prompt shows a **[G]** or **[P]** badge. Click the badge to move a prompt between Global and Project scope.
- **Select & Compose** — Click a prompt from the dropdown to load it into the task description. The selected prompt’s content is injected into `MISSION.md`.
- **Import & Save** — Import existing `.md` files or folders into the library. Use **Save as Template** to save the current description as a reusable prompt.
- **Filter Bar** — Toggle **Project** / **Global** filters and search prompts by name.

### 📋 Review Status Tracking
Track the progress of each shadow clone with a visual status cycle:
- **○ Todo** → **🔄 In Progress** → **✓ Done** → **✗ Won't Do**

Click a clone in the sidebar to cycle through statuses. A focus-then-click guard prevents accidental state changes — the first click selects, subsequent clicks cycle.

### 🛡️ Non-Blocking Workflow
Your main editor window remains free. Spawn 5 agents working on 5 different features simultaneously in their own isolated windows. Click the **📂 Open Clone** button to open any clone in a new window.

### 🔀 Merge & Cleanup
Right-click a clone in the **Active Clones** view and select **Squash & Merge**:
- **Target Branch Selection** — Choose which branch to merge into. The recorded base branch is highlighted as `← recommended`.
- **One-Step Flow** — Select a branch and merge immediately. A default commit message (`feat: merged <branch> (squash)`) is applied automatically.
- **Conflict Detection** — If conflicts are detected, the clone shows a ⚠️ indicator in the sidebar.

### 🔍 Dropdown Search Filter
Branch Name and Base Branch fields double as **live search inputs**:
- **Click to open** — Click the input to reveal the full branch list.
- **Type to filter** — Narrow down branches in real-time as you type.
- **Create new branch** — When no match is found, the dropdown shows `+ Create new branch: <name>`.
- **Esc / Enter / Tab to dismiss** — Press Escape, Enter, or Tab to close the dropdown.

### 🗑️ Flexible Kill Options
When removing a clone, choose whether to:
- **Remove Clone Only** — Delete the worktree but keep the branch for later.
- **Remove Clone & Delete Branch** — Full cleanup.

### 📋 Copy Branch Name
Right-click any clone in the sidebar to **Copy Branch Name** to the clipboard.

### 🏠 Current Branch Protection
Your active workspace branch is displayed at the top of the sidebar with a 🏠 icon and **cannot** be accidentally killed or merged.

### 👻 Shadow Mode
When Lumi-Ops detects you are inside a **Shadow Clone** (Git Worktree), the UI automatically adapts:
- **Sidebar** — The Active Clones list remains visible with the same layout as Root Mode. Click any clone to open it in a new window. Right-click actions (Kill, Merge) are hidden. Your current clone is marked with `★`.
- **Webview** — The Spawn Form is replaced by a focused **Prompt Library**. Clicking a prompt opens the `.md` file directly in the editor.
- **Return to Root** — Click the 🏠 Root row in the sidebar to return to the main repository window instantly.

## 🚀 Usage

1. **Open the "Shadow Ops" Sidebar** from the activity bar.
2. **Create a Shadow Clone**:
   - Enter a **Branch Name** (e.g., `feat/login`), or click the field to browse existing branches.
   - Optionally select a **Base Branch** (defaults to your current branch).
   - Optionally click **Prompts** to select a saved template, or type a **Task Description** for `MISSION.md`.
   - Click **Spawn Agent** (or **Create Clone Only** if no description).
3. **Open the Clone**: Click the **📂** button next to the clone in the sidebar.
4. **Let AI Work**: Tag `@MISSION.md` in your AI chat to provide the mission context.
5. **Track Progress**: Click the clone row to cycle its review status.
6. **Merge**: Right-click the clone → **Squash & Merge** → select target branch.

> **Tip**: When opened inside a Shadow Clone, Lumi-Ops automatically switches to **Shadow Mode** — showing only the Prompt Library and a Return to Root button.

## ⚙️ Requirements

- Git installed and available in your PATH.
- An AI-enabled IDE (Antigravity, Cursor, Windsurf, VS Code) for best results.

## 🔗 Links

- [GitHub Repository](https://github.com/yyy110011/lumi-ops)
- [Issues](https://github.com/yyy110011/lumi-ops/issues)

**Enjoy Multi-Threaded Coding!** 👻

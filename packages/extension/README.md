# 👻 Lumi-Ops

**Shadow Clone Protocol for AI Agents.**
Scale your development by spawning isolated "Shadow Clones" for your AI Agents.

[![CI Build](https://github.com/yyy110011/lumi-ops/actions/workflows/ci.yml/badge.svg)](https://github.com/yyy110011/lumi-ops/actions/workflows/ci.yml)
[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/ZunRenYao.lumi-ops?style=flat&label=VS%20Code&logo=visualstudiocode)](https://marketplace.visualstudio.com/items?itemName=ZunRenYao.lumi-ops)
[![Open VSX](https://img.shields.io/open-vsx/v/ZunRenYao/lumi-ops?style=flat&label=Open%20VSX&logo=eclipse-ide)](https://open-vsx.org/extension/ZunRenYao/lumi-ops)
[![Downloads](https://img.shields.io/open-vsx/dt/ZunRenYao/lumi-ops?style=flat&label=Downloads)](https://open-vsx.org/extension/ZunRenYao/lumi-ops)

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

### 📋 Review Status Tracking
Track the progress of each shadow clone with a visual status cycle:
- **○ Todo** → **🔄 In Progress** → **✓ Done** → **✗ Won't Do**

Click a clone in the sidebar to cycle through statuses. A focus-then-click guard prevents accidental state changes — the first click selects, subsequent clicks cycle.

### 🛡️ Non-Blocking Workflow
Your main editor window remains free. Spawn 5 agents working on 5 different features simultaneously in their own isolated windows. Click the **📂 Open Clone** button to open any clone in a new window.

### 🔀 Merge & Cleanup
Right-click a clone in the **Active Clones** view and select **Squash & Merge**. Lumi-Ops brings the changes back to your branch and cleans up the worktree.

### 🗑️ Flexible Kill Options
When removing a clone, choose whether to:
- **Remove Clone Only** — Delete the worktree but keep the branch for later.
- **Remove Clone & Delete Branch** — Full cleanup.

### 🏠 Current Branch Protection
Your active workspace branch is displayed at the top of the sidebar with a 🏠 icon and **cannot** be accidentally killed or merged.

## 🚀 Usage

1. **Open the "Shadow Ops" Sidebar** from the activity bar.
2. **Create a Shadow Clone**:
   - Enter a **Branch Name** (e.g., `feat/login`), or browse existing branches with **▾**.
   - Optionally select a **Base Branch** (defaults to your current branch).
   - Optionally enter a **Task Description** for `MISSION.md`.
   - Click **Spawn Agent** (or **Create Clone Only** if no description).
3. **Open the Clone**: Click the **📂** button next to the clone in the sidebar.
4. **Let AI Work**: Tag `@MISSION.md` in your AI chat to provide the mission context.
5. **Track Progress**: Click the clone row to cycle its review status.
6. **Merge**: Right-click the clone → **Squash & Merge**.

## ⚙️ Requirements

- Git installed and available in your PATH.
- An AI-enabled IDE (Antigravity, Cursor, Windsurf, VS Code) for best results.

## 🔗 Links

- [GitHub Repository](https://github.com/yyy110011/lumi-ops)
- [Issues](https://github.com/yyy110011/lumi-ops/issues)

**Enjoy Multi-Threaded Coding!** 👻

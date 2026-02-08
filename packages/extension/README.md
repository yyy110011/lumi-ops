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

### 1. ⚡ Spawn in Seconds
Create a new branch and fresh worktree instantly from the Sidebar.
- **No Stashing**: Keep your current work as-is.
- **Branches from Current**: Clones branch off your current branch, not `main`.

### 2. 📝 Agent Context (`MISSION.md`)
When you spawn a clone, you provide a task description.
Lumi-Ops auto-generates a `MISSION.md` file in the new clone with your mission objective.
Tag `@MISSION.md` in your AI chat to give the agent its instructions.

### 3. 🛡️ Non-Blocking Workflow
Your main editor window remains free. Spawn 5 agents working on 5 different features simultaneously in their own isolated windows.

### 4. 🔀 Merge & Cleanup
Right-click the branch in the "Active Clones" view and select **Squash & Merge**.
Lumi-Ops brings the changes back to your branch and cleans up the worktree.

### 5. 🏠 Current Branch Protection
Your active workspace branch is displayed at the top of the sidebar with a 🏠 icon and **cannot** be accidentally killed or merged.

## 🚀 Usage

1. **Open the "Shadow Ops" Sidebar**.
2. **Create Shadow Clone**:
   - Enter a Branch Name (e.g., `feat/login`).
   - Enter a Description (e.g., "Implement OAuth login").
   - Click **Spawn Agent**.
3. **Open the Clone**: Click the new item in the sidebar.
4. **Let AI Work**: Tag `@MISSION.md` in your AI chat to provide the mission context.
5. **Merge**: Right-click the item in the sidebar → **Squash & Merge**.

## ⚙️ Requirements

- Git installed and available in your PATH.
- An AI-enabled IDE (Antigravity, Cursor, Windsurf, VS Code) for best results.

## 🔗 Links

- [GitHub Repository](https://github.com/yyy110011/lumi-ops)
- [Issues](https://github.com/yyy110011/lumi-ops/issues)

**Enjoy Multi-Threaded Coding!** 👻

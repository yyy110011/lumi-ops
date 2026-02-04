# 👻 Lumi-Ops

**Shadow Clone Protocol for AI Agents.**
Scale your development by spawning isolated "Shadow Clones" for your AI Agents.

![Lumi-Ops Icon](icon.png)

[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/ZunRenYao.lumi-ops?style=flat&label=VS%20Code%20Marketplace&logo=visual-studio-code)](https://marketplace.visualstudio.com/items?itemName=ZunRenYao.lumi-ops)


## 💡 What is Lumi-Ops?

Lumi-Ops enables a **Multi-Threaded Coding Workflow**. Instead of blocking your main editor while an AI Agent (like Cursor Composer or Windsurf) writes code, you can "Spawn a Shadow Clone".

This creates a **Git Worktree** in a hidden folder, equipped with a dedicated context file (`.cursorrules`) containing your instructions. Open that folder in a new window, let the AI work there, and squash merge it back when done.

## ✨ Key Features

### 1. ⚡ Spawn in Seconds
Create a new branch and fresh worktree instantly from the Sidebar.
- **No Stashing**: Keep your current work as-is.
- **No Branch Switching**: Main window stays on `main`.

### 2. 📝 Auto-Context (`.cursorrules`)
When you spawn a clone, you provide a task description.
Lumi-Ops auto-generates a `.cursorrules` file in the new clone with your mission objective.
**Bonus:** When you open the clone, this file **opens automatically**, ensuring the Agent sees the instructions immediately.

### 3. 🛡️ Non-Blocking Workflow
Your main VS Code window remains free. You can spawn 5 agents working on 5 different features simultaneously in their own isolated windows.

### 4. 🔀 Merge & Cleanup
Finished? Right-click the branch in the "Active Clones" view and select **Squash & Merge**.
Lumi-Ops brings the changes back to your main branch and cleans up the worktree.

## 🚀 Usage

1. **Open the "Shadow Ops" Sidebar**.
2. **Create Shadow Clone**:
   - Enter a Branch Name (e.g., `feat/login`).
   - Enter a Description (e.g., "Implement OAuth login").
   - Click "Spawn Agent".
3. **Open the Clone**: Click the folder icon on the new item.
4. **Let AI Work**: The context file opens automatically. Tag `@.cursorrules` to guide your AI.
5. **Merge**: Right-click the item in the sidebar -> **Squash & Merge**.

## ⚙️ Requirements

- Git installed and available in your PATH.
- (Optional) An AI-enabled IDE like **Cursor** or **Windsurf** for best results.

## 🔗 Links

- [GitHub Repository](https://github.com/yyy110011/lumi-ops)
- [Issues](https://github.com/yyy110011/lumi-ops/issues)

**Enjoy Multi-Threaded Coding!** 👻

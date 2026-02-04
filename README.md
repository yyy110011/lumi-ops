# 👻 Lumi-Ops

[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/ZunRenYao.lumi-ops?style=flat&label=VS%20Code%20Marketplace&logo=visual-studio-code)](https://marketplace.visualstudio.com/items?itemName=ZunRenYao.lumi-ops)
[![Open VSX](https://img.shields.io/open-vsx/v/ZunRenYao/lumi-ops?style=flat&label=Open%20VSX&logo=eclipse-ide)](https://open-vsx.org/extension/ZunRenYao/lumi-ops)



**Lumi-Ops** (Luminescent Operations) is a **Shadow Clone Protocol** for AI Agents in VS Code.

It allows you to spawn isolated **Git Worktrees** ("Shadow Clones") for AI Agents to work on features without interfering with your main development environment.

## 📦 Monorepo Structure

This project is a monorepo managed with `pnpm workspaces`.

- `packages/cli`: The core Logic and CLI tools for managing git worktrees and spawning agents.
- `packages/extension`: The VS Code Extension UI that wraps the CLI.

## 🚀 Getting Started (Development)

1. **Install Dependencies**
   ```bash
   pnpm install
   ```

2. **Build All Packages**
   ```bash
   pnpm -r build
   ```

3. **Run Extension**
   - Open this folder in VS Code.
   - Press **F5** to launch the Extension Development Host.

## ✨ Features

- **Spawn Shadow Clones**: Create new feature branches in isolated worktrees instantly.
- **Agent Context**: Automatically generates `.cursorrules` with the mission objective.
- **Non-Blocking UI**: Use the sidebar to spawn agents while you continue working.
- **Squash & Merge**: One-click merge workflow to bring the agent's work back to main.

## 📄 License

MIT

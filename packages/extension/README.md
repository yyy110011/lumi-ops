# 👻 Lumi-Ops

**Shadow Clone Protocol for AI Agents.**
Scale your development by spawning isolated "Shadow Clones" for your AI Agents.

[![CI Build](https://github.com/yyy110011/lumi-ops/actions/workflows/ci.yml/badge.svg)](https://github.com/yyy110011/lumi-ops/actions/workflows/ci.yml)
[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/ZunRenYao.lumi-ops?style=flat&label=VS%20Code&logo=visualstudiocode)](https://marketplace.visualstudio.com/items?itemName=ZunRenYao.lumi-ops)
[![Open VSX](https://img.shields.io/open-vsx/v/ZunRenYao/lumi-ops?style=flat&label=Open%20VSX&logo=eclipse-ide)](https://open-vsx.org/extension/ZunRenYao/lumi-ops)
[![Downloads](https://img.shields.io/open-vsx/dt/ZunRenYao/lumi-ops?style=flat&label=Downloads)](https://open-vsx.org/extension/ZunRenYao/lumi-ops)
[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-☕-yellow?style=flat)](https://buymeacoffee.com/ryanzryao)

### 🆕 What's New in v0.4

- **MCP Server** — AI agents can now spawn, manage, review, and merge clones programmatically via the `@lumi-ops/mcp-server` package.
- **Review Protocol** — Structured review workflow: agent writes `MISSION_COMPLETE.md` → sets status to `needsReview` → reviewer approves or requests revision → squash merge.
- **Auto-Status Transitions** — Clone status auto-transitions from `todo` → `inProgress` when the workspace opens.
- **Status-Aware Copy Prompt** — "Copy Prompt" content adapts based on clone status — includes revision feedback when in a revision cycle.
- **Merge Improvements** — Squash merges now auto-exclude `.lumi/` artifacts and IDE ephemeral files.
- **Root Agent Mode & Clone Agent Rules** — Settings to inject role-specific rules for strategist (root) and executor (clone) agents.
- **Rebase Conflict UX** — Manual conflict resolution instead of auto-abort. Sidebar shows a `🔀 rebasing` indicator.
- **Review Tools** — `review_clone` and `get_clone_file_diff` MCP tools for structured code review.

---

## 💡 What is Lumi-Ops?

Lumi-Ops enables a **Multi-Threaded Coding Workflow**. Instead of blocking your main editor while an AI Agent writes code, you can "Spawn a Shadow Clone" — an isolated **Git Worktree** with a `MISSION.md` file containing your instructions. Let AI work there, and squash merge it back when done.

![Sidebar Overview](https://raw.githubusercontent.com/yyy110011/lumi-ops/main/packages/extension/media/sidebar-overview.png)

---

## 🚀 Quick Start

**1. Spawn** — Fill in a branch name and task description, then click **Spawn Agent**.

![Spawn Flow](https://raw.githubusercontent.com/yyy110011/lumi-ops/main/packages/extension/media/spawn-flow.png)

**2. Work** — Open the clone in a new window. Tag `@MISSION.md` in your AI chat to give the agent its instructions.

**3. Review** — When the agent finishes, it sets the clone status to `needsReview`. Review the diff and `MISSION_COMPLETE.md`, then approve or request revision.

**4. Merge** — Right-click the clone → **Squash & Merge** → select target branch. Done.

> **Tip**: Leave the description empty and click **Create Clone Only** to create a worktree without `MISSION.md` — useful when you just need an isolated workspace.

---

## ✨ Features

### ⚡ Spawn in Seconds
- **No Stashing** — Keep your current work as-is.
- **Base Branch Selection** — Pick any local or remote branch as the base, defaulting to your current branch.
- **Existing Branch Support** — Select an existing branch or type a new name to create a fresh branch.
- **Copy on Spawn** — Configure folders/files to auto-copy from root to clone via `lumi-ops.copyOnSpawn` setting.

### 🤖 MCP Server

> **Let your agent do the work.** With the MCP Server, your AI agent can spawn clones, review diffs, request revisions, and merge — all without you touching the UI. Just describe what you want, and the agent handles the rest.

```bash
npx @lumi-ops/mcp-server
```

Try telling your agent:
- *"Spawn a clone for this bug fix and write the implementation"*
- *"Review the clone on branch feat/auth and merge it if it looks good"*
- *"List all active clones and kill the ones that are done"*

Works with Antigravity, VS Code (Copilot), Cursor, Windsurf, and Claude Desktop. See the [MCP Server README](https://github.com/yyy110011/lumi-ops/tree/main/packages/mcp-server) for per-IDE configuration.

### 🔄 Review Workflow

A structured review cycle keeps humans in the loop:

1. **Clone finishes work** — The agent writes `.lumi/MISSION_COMPLETE.md` and sets the clone status to `needsReview`.
2. **Review** — You (or a root agent) review the diff and completion report. Right-click the clone in the sidebar for review actions.
3. **Approve or Revise** — Approve and squash merge, or send feedback via **Request Revision**. The agent receives `.lumi/REVIEW_FEEDBACK.md`, makes fixes, and re-submits for review.

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
Click a clone in the sidebar to cycle through statuses. The review statuses (`needsReview`, `needsRevision`) are settable via MCP or right-click context menu.

| Icon | Status | Description |
|:----:|--------|-------------|
| ⚪ | Todo | Default state for new clones |
| 🔄 | In Progress | Auto-set when the clone workspace opens |
| 🔍 | Needs Review | Agent finished — waiting for review |
| ✏️ | Needs Revision | Reviewer sent feedback — agent fixing |
| ✅ | Done | Work approved / completed |
| ⛔ | Won't Do | Cancelled or abandoned |
| ⚠️ | Conflict | Unresolved merge conflicts detected |

### 🔀 Squash & Merge
- **Target Branch Selection** — Choose which branch to merge into. Base branch is marked `← recommended`.
- **Conflict Detection** — Clones with unresolved conflicts show ⚠️ in the sidebar.
- **Clean Merges** — Automatically excludes `.lumi/` artifacts and IDE ephemeral files from the squash.

### 🧠 Agent Rules
- **Root Agent Mode** (`lumi-ops.rootAgentMode`) — Injects strategist rules for the main workspace, instructing AI agents to plan and delegate rather than implement directly.
- **Clone Agent Rules** (`lumi-ops.cloneAgentRules`) — Injects executor rules into clone workspaces, instructing agents to write `MISSION_COMPLETE.md` and set their status via MCP when done.

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
- **Rebase with Conflict UX** — Rebase a clone onto its base branch. If conflicts arise, resolve them manually; the sidebar shows a `🔀 rebasing` indicator until resolved.

---

## ⚙️ Requirements

- Git installed and available in your PATH.
- An AI-enabled IDE (Antigravity, Cursor, Windsurf, VS Code) for best results.

## 🔗 Links

- [GitHub Repository](https://github.com/yyy110011/lumi-ops)
- [Issues](https://github.com/yyy110011/lumi-ops/issues)

**Enjoy Multi-Threaded Coding!** 👻

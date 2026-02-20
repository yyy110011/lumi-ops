# Shadow Mode UI 設計草案

> 當用戶在 Shadow Clone workspace 中開啟 Lumi-Ops 時，UI 應呈現完全不同的介面。

## Shadow 偵測機制

檢查 workspace 的 `.git` 是 **file** 還是 **directory**：
- `.git` 是 file → Git Worktree → shadow mode
- `.git` 是 directory → 主 repo → root mode

從 `.git` file 內容 parse 出 parent repo path，可同時取得 root 路徑（用於「回到 Root」按鈕）。

## Root Mode vs Shadow Mode

| 區域 | Root Mode | Shadow Mode |
|---|---|---|
| **Tree View** | Active Clones 列表 | 🏠 Root link（點了回 root） |
| **Webview** | Spawn form | 📝 Prompt Library |
| **Spawn / Kill / Merge** | ✅ 全部啟用 | ❌ 全部隱藏 |

## Shadow Mode UI

### Tree View → Root Link

簡化為一行資訊 + 導航：

```
🏠 Root: main (~/project)  → Click to return
   You are: feat/login
```

### Webview → Prompt Library

取代 spawn form，顯示可用的 prompts，點了在 editor 開啟：

```
📝 Prompts
┄┄┄┄ This Clone ┄┄┄┄
📋 MISSION.md
┄┄┄┄ Project ┄┄┄┄┄┄
🔧 Run lint + fix
🔧 Zod validation pattern
┄┄┄┄ Global ┄┄┄┄┄┄┄
⚡ Run tests & fix all
⚡ Security review
⚡ Write commit message

[+ Add Prompt]
```

### 屏蔽的功能

- **Spawn** — 不在 clone 裡再建 clone
- **Kill** — 不殺自己
- **Merge** — 從 root 操作
- **Active Clones tree** — clone 內看不到其他 clone

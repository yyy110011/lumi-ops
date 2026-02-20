# MCP Agent Sandbox 設計草案

> 目標：讓 AI Agent 能在 Shadow Clone 中執行命令，繞過 IDE sandbox 限制，同時保持安全性。

## 架構

MCP server 在 root workspace 執行，擁有完整系統權限。Agent 透過 MCP tool call 執行命令，MCP server 負責驗證和限制。

```
Root Workspace (MCP server running here)
├── .shadow-clones/
│   ├── feat/login    ← Agent A 只能在這跑
│   └── fix/bug-123   ← Agent B 只能在這跑
```

## 核心 Tool: `exec`

```
Tool: exec
  - branch: string   (用來查 registry、定位 cwd)
  - command: string   (要執行的 shell command)
```

**MCP server 內部流程**：
1. 查 registry：`branch` 必須存在（spawn 時自動註冊）
2. Resolve path：`resolvedPath = path.resolve(shadowDir, branch)`
3. **安全檢查**：`resolvedPath.startsWith(shadowDir)` — 防止 path traversal
4. 執行：`child_process.exec(command, { cwd: resolvedPath })`

## Registry 機制

- **寫入時機**：`spawn_agent` 成功時自動註冊 `branch → shadow_path`
- **移除時機**：`kill_agent` 時自動移除
- **儲存方式**：待定（in-memory vs file）

## 安全約束

1. **Path 硬限制**：resolved path 必須在 `.shadow-clones/` 下
2. **Registry 限制**：只有 spawn 過的 branch 才能執行命令
3. **Branch name validation**（spawn 端）：禁止 `..`、`/` 開頭等危險字元

## Agent 識別方式

採用方案 1（Agent 自報 branch name）：
- Agent 從 MISSION.md 或 `git branch --show-current` 取得 branch name
- 傳入 `exec(branch, command)`
- MCP 用 branch 查 registry 取得 path

不需要 session token 或 register 步驟，因為 Agent 不是對手方。Registry + path validation 雙重檢查已足夠。

## 待討論

- [ ] Registry 持久化：in-memory（重啟後 re-scan `.shadow-clones/`）vs file
- [ ] `exec` 要不要支援 streaming output
- [ ] 跟現有 `spawn_agent` / `kill_agent` 的整合
- [ ] 是否需要 command 白名單或 timeout

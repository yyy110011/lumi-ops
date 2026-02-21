# Lumi-Ops Roadmap

> 根據目前功能現況、設計文件與近期重構整理。

## 現況 (v0.3.1)

✅ Spawn / Kill / Merge 完整生命週期
✅ Review Status Tracking & Metadata Management
✅ Conflict Auto-Detection
✅ **Prompt Library** (Main & Project dual-scope, template variables)
✅ **Clone Path Convention** (採用 `.worktrees/` 標準化目錄，相容原生 VS Code)
✅ 首版 MCP Server 建置

---

## v0.4 — Shadow Mode UI (工作區隔離體驗)

**目標**：在 Shadow Clone 的 workspace 中開啟 VS Code 時，顯示針對 AI Agent 協作的專屬功能，隱藏不必要的 Root 功能。
**參考文件**：[shadow-mode-ui.md](./shadow-mode-ui.md)

- [ ] 偵測當前是否為 Shadow Mode（檢查 `.git` 為檔案而非目錄）
- [ ] Tree View 簡化：不顯示所有 Clone，僅提供「回到 Root」導航
- [ ] 取代 Spawn 控制版：為 Shadow Mode 開啟 Prompt Library，快速發派次級任務
- [ ] 隱藏在 Clone 中不合理的操作指令（禁止在 clone 中再建立 clone 等）

---

## v0.5 — Background Agent 自動化 (進行中...)

**目標**：透過 `spawn` 啟動帶有 `--driver` 的 background agent（例如 antigravity 或 tmux），實現全自動化背景工作。
**參考文件**：[Background-Agent-Plan.md](./Background-Agent-Plan.md)

### 階段一：CLI Agent 啟動與基礎狀態
- [ ] 擴充 `lumi-ops spawn`: 支援 `--driver` (antigravity/tmux) 與 `--prompt` 參數
- [ ] 統一 Agent 狀態檔案 (`.lumi-status.json`) 格式
- [ ] MISSION.md 模板強化 (確保 Agent 在正確的工作目錄執行)

### 階段二：Extension 介面整合與監控
- [ ] ShadowCreatorProvider 提供 driver 選擇 (Antigravity / Tmux / Manual)
- [ ] 狀態圖示反映：透過掃描 `.lumi-status.json`，標示 Agent 運行中或被阻擋 (blocked)
- [ ] 實作 Agent 控制命令：`Attach`, `Kill Session`, `Watch Logs`, `Jump In`

### 階段三：GC (Garbage Collection) 清理工具
- [ ] CLI 擴充 `lumi-ops gc`：清理無效的 `.worktrees/` 與孤立的 tmux session
- [ ] 將 `git worktree prune` 加入清理流程中

---

## v0.6 — MCP Agent Sandbox

**目標**：確保由 AI 控制的 Agent 必須透過 Root 端的 MCP Server 執行外部指令，避免影響整個系統或主專案目錄。
**參考文件**：[mcp-agent-sandbox.md](./mcp-agent-sandbox.md)

- [ ] **Agent Registry**：Spawn 後自動向 MCP 註冊合法 `branch -> path`
- [ ] **MCP `exec` Tool**：限制只能在專屬 worktree 範圍內執行指令
- [ ] **安全防護機制**：Path traversal 防禦與未授權擋截

---

## 未來考慮 (Backlog & Quick Wins)

**參考文件**：[feature-candidates.md](./feature-candidates.md)

- [ ] Reveal in Finder + Copy Path (開啟 Clone 目錄與複製路徑)
- [ ] Post-create command (如 Spawn 後自動執行 `install`)
- [ ] File copy patterns (可自訂設定要從 Root 複製到 clone 的隱藏配置檔案如 `.env.local` 等)
- [ ] 快捷切換 (Telescope / 模糊搜尋 clone 目錄)
- [ ] 支援 i18n 多語系

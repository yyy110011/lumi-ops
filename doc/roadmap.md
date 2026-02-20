# Lumi-Ops Roadmap

> 根據目前功能現況、四份設計文件、以及開發中的 prompt library 整理。

## 現況 (v0.2.5)

✅ Spawn / Kill / Merge 完整生命週期
✅ MISSION.md 自動生成
✅ Review Status Tracking (Todo → In Progress → Done → Won't Do)
✅ Base Branch Selection (local + remote)
✅ Current Branch Protection
✅ AGENTS.md (Agent 入職文件)

---

## v0.3 — Prompt Library + Quick Wins

**目標**：完成 prompt library MVP + 低成本高價值的小功能。
**預估**：3-4 個工作時段

### Must Have
- [x] **Prompt Library (root mode)** — 已合併到 main ✅
  - ✅ Dual-scope storage (global + project)
  - ✅ Spawn form 整合（選 prompt 填入 description + multi-template tags）
  - ✅ Import file / folder、Save as Template
  - ✅ 合併到 main
- [ ] **Reveal in Finder + Copy Path** — 2 檔案，0 測試，⭐ effort
- [ ] **Prune 整合進 GC** — 1-2 檔案，1 測試，⭐ effort

### Nice to Have
- [ ] Post-create command (`lumi-ops.postCreateCmd` config)
- [ ] File copy patterns (`lumi-ops.copyPatterns` config)

### Tech Debt
- [ ] **Webview 檔案拆分** — `ShadowCreatorProvider.ts` 已膨脹到 ~590 行，HTML/CSS/JS 全部 inline 在 template literal 中。拆成獨立的 `media/creator.html` + `creator.css` + `creator.js`，用 `webview.asWebviewUri()` 載入。這是後續加功能（agent 控制面板等）的前置條件。
- [ ] **隱藏 internal commands** — `_getPrompts`、`_selectPrompt`、`_deletePrompt` 等 `_`-prefixed commands 會出現在 Command Palette。在 `package.json` 的 `menus.commandPalette` 加上 `"when": "false"` 隱藏。

---

## v0.4 — Shadow Mode

**目標**：Shadow Clone 視窗顯示專屬 UI，不再看到 spawn form。
**預估**：3-4 個工作時段
**前置**：v0.3 prompt library 完成

- [ ] **Shadow 偵測**（`.git` is file → worktree mode）
- [ ] **Root Link**（tree view 簡化為「回到 Root」導航）
- [ ] **屏蔽 Spawn / Kill / Merge** in shadow mode
- [ ] **Prompt Library (shadow mode)** — 複用 v0.3 的儲存，MISSION.md 並列顯示
- [ ] 更新 README / AGENTS.md

---

## v0.5 — MCP Agent Sandbox

**目標**：讓 Agent 透過 MCP 在 shadow clone 中執行命令，繞過 IDE sandbox 限制。
**預估**：4-5 個工作時段
**前置**：MCP server 基礎架構就緒

- [ ] **Agent registry**（spawn 自動註冊 branch → path）
- [ ] **`exec` tool**（MCP 套殼 child_process，硬限制在 `.shadow-clones/` 下）
- [ ] **Path traversal 防護**（resolve + startsWith 驗證）
- [ ] **整合 spawn / kill lifecycle**（自動 register / unregister）

---

## 未來考慮 (Backlog)

以下功能不急，視社群回饋決定：

- [ ] Quick switch 快捷鍵 (`Ctrl+Shift+R` 風格)
- [ ] Lock / Unlock worktree
- [ ] i18n 多語言 (zh-TW, zh-CN)
- [ ] SCM 面板整合
- [ ] Marketplace 頁面美化（screenshots, demo video）

---

## 設計文件索引

| 文件 | 內容 |
|---|---|
| [feature-candidates.md](./feature-candidates.md) | 四個 feature 的 effort 分析 |
| [shadow-mode-ui.md](./shadow-mode-ui.md) | Shadow/Root 模式 UI 切換設計 |
| [prompt-library.md](./prompt-library.md) | Prompt 三層儲存架構 |
| [mcp-agent-sandbox.md](./mcp-agent-sandbox.md) | MCP exec sandbox 安全設計 |

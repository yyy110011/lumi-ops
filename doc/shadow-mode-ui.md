# Shadow Mode UI

> ✅ 已於 v0.3.3 實作。以下為目前實作現況。

## Shadow 偵測機制

檢查 workspace 路徑是否包含 `.worktrees/`：
- 路徑含 `.worktrees/` → Shadow Mode（自動 resolve 回主 repo root）
- 其他 → Root Mode

透過 `vscode.commands.executeCommand('setContext', 'lumi-ops.isShadowMode', true)` 設定 context boolean。

## Root Mode vs Shadow Mode

| 區域 | Root Mode | Shadow Mode |
|---|---|---|
| **Tree View** | Active Clones 列表 | ❌ 完全隱藏（`when` 條件） |
| **Webview** | Spawn form + Prompt Library | 📝 Prompt Library only |
| **Spawn / Kill / Merge** | ✅ 全部啟用 | ❌ 全部隱藏（CSS + `when`） |
| **Header** | 無 | 🏠 Return to Root + Branch 名稱 |

## Shadow Mode Webview

### Header
顯示當前 branch 名稱 + 🏠 Return to Root 按鈕（點擊後彈出 modal 確認）。

### Prompt Library
- Spawn form 透過 CSS `display: none` 隱藏
- Prompt Library dropdown 展開為全高顯示
- 點擊 prompt → 直接在 editor 開啟 `.md` 檔案（而非載入到 textarea）
- 雙擊空白處 → inline 建立新 prompt

### 屏蔽的功能

- **Spawn** — 不在 clone 裡再建 clone
- **Kill** — 不殺自己
- **Merge** — 從 root 操作
- **Active Clones tree** — 完全隱藏

## 未來強化方向

- [ ] MISSION.md 預覽摘要
- [ ] Clone 專屬快速操作列
- [ ] 與 base branch 的 diff 狀態
- [ ] Prompt Library 分類（This Clone / Project / Global）

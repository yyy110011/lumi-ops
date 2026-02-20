# Feature Candidates — 來自 GWM 比較分析

> 來源：與 [git-worktree-manager](https://github.com/jackiotyu/git-worktree-manager) 比較後，篩選出適合 Lumi-Ops 的功能。

## 1. Reveal in Finder + Copy Path

**說明**：右鍵 Shadow Clone → 在 Finder 中顯示 / 複製路徑。

| 指標 | 值 |
|---|---|
| 改動檔案 | 2（`package.json`, `extension.ts`） |
| 新增測試 | 0 |
| 無 bug 信心 | 99% |
| Effort | ⭐ 極小 |

**實作方式**：直接呼叫 `vscode.commands.executeCommand('revealFileInOS')` 和 `vscode.env.clipboard.writeText()`，路徑從 `item.clone.path` 取得。

---

## 2. Post-create Command

**說明**：新增 config `lumi-ops.postCreateCmd`，在 worktree 建立後由 Extension 自動執行（例如 `pnpm install`）。

| 指標 | 值 |
|---|---|
| 改動檔案 | 3（`extension/package.json`, `spawn.ts`, `spawn.test.ts`） |
| 新增測試 | 2-3 |
| 無 bug 信心 | 85% |
| Effort | ⭐⭐ 小 |

**注意事項**：
- Command 由 Extension（Node.js）執行，不受 AI Agent sandbox 限制
- 用 per-workspace config（`.vscode/settings.json`），不同專案可設不同命令
- 失敗時 warn but don't block spawn
- 需考慮 timeout 機制

---

## 3. File Copy Patterns

**說明**：新增 config `lumi-ops.copyPatterns`，spawn 時自動複製 gitignored 但必要的檔案（如 `.env.local`）。

| 指標 | 值 |
|---|---|
| 改動檔案 | 3-4（`extension/package.json`, `spawn.ts`, `spawn.test.ts`, 可能新增 util） |
| 新增測試 | 4-5 |
| 無 bug 信心 | 75% |
| Effort | ⭐⭐⭐ 中等 |

**注意事項**：
- 目前 `spawn.ts` 已 hardcode 複製 `.env`，此功能替換為可設定版本
- 需引入 glob library（如 `fast-glob`）
- Default 可設為 `[".env*"]` 保持向後相容
- Edge cases：nested paths、symlinks、permission

---

## 4. Prune 整合進 GC

**說明**：在 garbage_collect 流程中加入 `git worktree prune`，清理 git 內部殘留的 worktree 記錄。

| 指標 | 值 |
|---|---|
| 改動檔案 | 1-2（MCP server gc handler） |
| 新增測試 | 1 |
| 無 bug 信心 | 95% |
| Effort | ⭐ 極小 |

**注意事項**：
- `git worktree prune` 是 git 內建安全操作，只清理 metadata 不刪檔案
- 目前 GC 邏輯在 MCP server 的 compiled JS 裡，正式整合可能需要先把邏輯移到 CLI package

---

## 總結排序（Effort 由小到大）

| # | 功能 | 檔案 | 測試 | 信心 | Effort |
|---|---|---|---|---|---|
| 4 | Prune → GC | 1-2 | 1 | 95% | ⭐ |
| 1 | Reveal + Copy | 2 | 0 | 99% | ⭐ |
| 2 | Post-create cmd | 3 | 2-3 | 85% | ⭐⭐ |
| 3 | File copy patterns | 3-4 | 4-5 | 75% | ⭐⭐⭐ |

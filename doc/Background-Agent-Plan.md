# Background Agent 自動執行 — 整合開發計畫

> 📅 2026-02-14 | 基於 `main` branch 現狀

---

## 1. Main 現狀

### 1.1 `spawn.ts` — 只建立 worktree，無 agent 啟動

目前 main 的 spawn **沒有** background mode、tmux、driver 等概念。完整流程：

1. `quickGC` — ❌ 不存在（main 無 `gc.ts`）
2. 建立 `.shadow-clones/` + 加入 `.gitignore`
3. `git worktree add` — 支援新 branch 或 attach 到既有 branch
4. 寫入 `.lumi-metadata.json`（集中化，記錄 `baseBranch`）
5. 複製 `.env`
6. 有 description 時才生成 `MISSION.md`
7. **結束** — 沒有任何 agent 啟動行為

### 1.2 CLI entry (`index.ts`) — 只有三個命令

```
lumi-ops spawn <branch> --root <path>
lumi-ops kill  <branch> --root <path>
lumi-ops list  --root <path> --json
```

沒有 `--mode`、`--driver`、`gc` 等選項。

### 1.3 Extension — 沒有 agent 監控功能

- ✅ `ShadowTreeProvider` — review status cycling、SVG icons
- ✅ `ShadowCreatorProvider` — branch dropdown、prompt template、base branch 選擇、搜尋過濾
- ❌ 沒有 `StatusWatcher`（被移除）
- ❌ 沒有 attach / killSession / watchLogs / jumpIn commands
- ❌ 沒有 tmux 相關的任何邏輯
- ❌ 沒有 MCP Server

### 1.4 GitUtils

已有：`branchExists`、`addWorktreeExisting`、`listRemoteBranches`、`fetchBranch`、`hasConflicts` 等。

---

## 2. 關鍵發現：`antigravity chat` CLI

```bash
antigravity chat [options] [prompt]
```

| Option | 說明 |
|--------|------|
| `--mode <mode>` | `ask`, `edit`, **`agent`**（預設）, 或自訂 mode ID |
| `--add-file <path>` | 附加檔案作為 context |
| `--reuse-window` | 在已開啟的視窗中啟動 |
| `--new-window` | 強制開新視窗 |
| `--maximize` | 最大化 chat 視窗 |
| stdin pipe | `cat log.txt \| antigravity chat "analyze" -` |

> [!IMPORTANT]
> **一條指令完成：開窗口 + 設定 workspace + 注入 prompt + 啟動 agent mode。**

### 理想的一條龍指令

```bash
cd /path/to/.shadow-clones/<branch>
antigravity . chat \
  --mode agent \
  --new-window \
  --add-file MISSION.md \
  "Please read @MISSION.md and start working on the objective described in it."
```

這能解決兩個核心問題：
1. **Agent 無法在新視窗執行指令** → `antigravity` 直接帶 worktree 路徑開窗，workspace context 正確
2. **需手動貼 prompt** → prompt 直接注入 chat

---

## 3. 需要開發的項目

### 3.1 CLI 層 — `spawn.ts` 新增 agent 啟動

| 項目 | 說明 |
|------|------|
| 新增 `--driver <type>` option | `antigravity`（預設）/ `tmux` / `none`（現行為） |
| 新增 `--prompt <text>` option | 傳入 prompt（可覆蓋預設 MISSION.md prompt） |
| Antigravity driver | spawn 結束後執行 `antigravity . chat --mode agent --new-window --add-file MISSION.md "<prompt>"` |
| Tmux driver | 寫 `.lumi-runner.sh`，`tmux new-session -d`，寫 `.lumi-status.json` |
| 狀態檔 `.lumi-status.json` | 統一格式：`{ status, message, session?, driver, startedAt }` |

**CLI entry 改動：**

```diff
 program
   .command('spawn')
   .argument('<branchName>')
   .option('-r, --root <path>', '...', process.cwd())
+  .option('--driver <type>', 'Agent driver: antigravity | tmux | none', 'none')
+  .option('--prompt <text>', 'Custom prompt for the agent')
   .action(spawn);
+
+ program
+   .command('gc')
+   .description('Garbage collect orphaned worktrees and sessions')
+   .option('-r, --root <path>', '...', process.cwd())
+   .option('--dry-run')
+   .action(gc);
```

### 3.2 Driver 抽象層（建議但可選）

如果未來要支援更多 driver（cursor --background 等），抽出 interface：

```typescript
interface AgentDriver {
  name: string;
  start(ctx: DriverContext): Promise<SessionInfo>;
  isAlive(session: SessionInfo): Promise<boolean>;
  kill(session: SessionInfo): Promise<void>;
}

interface DriverContext {
  worktreePath: string;
  branchName: string;
  missionFile: string;
  prompt: string;
}
```

Phase 1 可以先不抽象，直接在 `spawn.ts` 內 switch/case 處理。

### 3.3 Extension 層 — Agent 監控功能

| 項目 | 說明 |
|------|------|
| ShadowCreatorProvider 新增 driver 欄位 | dropdown: Antigravity / Tmux / Manual（不啟動 agent） |
| spawn command 傳遞 driver | `spawn(branch, { root, description, baseBranch, driver, prompt })` |
| 恢復 agent 生命週期 commands | `attach`、`killSession`、`showLogs`、`watchLogs`、`jumpIn` |
| StatusWatcher 或 polling | 監控 `.lumi-status.json` 變化，偵測 `blocked` 狀態 |
| contextValue 擴充 | 根據 `.lumi-status.json` 存在與否區分 `shadowClone` vs `activeAgent` |
| Menu contributions | activeAgent context menu: Attach / Kill Session / Watch Logs / Jump In |

### 3.4 GC（垃圾清理）

Main 上目前沒有 `gc` 命令，需要新增：
- 掃描 `.shadow-clones/` 找孤立資料夾
- 掃描 `tmux list-sessions` 找孤立 `lumi-*` session
- `--dry-run` 支援

### 3.5 MISSION.md 模板強化

```markdown
## ⚠️ Important Rules
- This worktree directory IS your workspace.
- You have FULL terminal access — run all commands directly from here.
- Do NOT create or use any other workspace or scratch directory.
- Do NOT refuse to run terminal commands.
```

---

## 4. 實作優先序

### Phase 1: Antigravity Driver 最小可用

> 目標：`lumi-ops spawn feat/xxx --driver antigravity` 能自動開 VS Code 窗口 + 注入 prompt + agent 開始工作

1. `spawn.ts` — 新增 `--driver antigravity` 邏輯
2. MISSION.md 模板調整
3. CLI entry 新增 option
4. **手動實測**：驗證 `antigravity chat` cwd 行為、prompt 注入、workspace context

### Phase 2: Extension UI 整合

1. ShadowCreatorProvider 加 driver 選擇
2. spawn command 連動 driver
3. `.lumi-status.json` 讀取 + Tree View icon 顯示

### Phase 3: Agent 監控 + GC

1. StatusWatcher 或 polling 恢復
2. attach / killSession / watchLogs / jumpIn commands
3. gc 命令
4. Menu contributions

---

## 5. 待實測確認

1. `antigravity . chat --new-window` — `antigravity` 第一個參數帶路徑能否設定 workspace？或需先 `cd` 再執行？
2. `--add-file MISSION.md` — 相對路徑是否相對於 cwd？
3. prompt 參數長度限制？
4. 多個 `--new-window` 是否各自獨立窗口？
5. 啟動後的 process 是否立即返回？（detached 行為）
6. agent 完成後如何通知？（需約定 agent 寫 `.lumi-status.json` 更新為 `done`）

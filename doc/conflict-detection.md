# Conflict Auto-Detection

## 目標

在 Active Clones tree view 中自動偵測並顯示每個 worktree（含 🏠 Home）的 git conflict 狀態。完全自動化 — 不需要使用者手動操作。

## 設計決策

- **Squash merge only** — 不支援 regular merge
- **即時偵測** — 不把 `conflict` 存進 metadata，使用 `git status --porcelain` 即時判斷
- **自動清除** — 用戶 resolve conflict + `git add` 後，下次偵測自動消失
- **需 revert** — 先前加入的 `ReviewStatus: 'conflict'` 及相關 cycle 邏輯需要移除

## UI 設計

Conflict 指標顯示在 `description` 欄位前方，不影響左側 icon：

```
正常：
  🏠 feat/unit-tests     Current Branch
  ⭕ test-task-1          ← main
  ✅ fix/typo              ← develop

有 conflict：
  🏠 feat/unit-tests     ⚠️ · Current Branch
  ⭕ test-task-1          ← main
  🔄 feature/auth         ⚠️ · ← main
  ✅ fix/typo              ← develop
```

## 偵測機制

### 方法：`git -C <path> status --porcelain`

Conflict 行的 prefix：`UU`、`AA`、`DD`、`DU`、`UD`

> [!NOTE]
> `git status --porcelain` 是唯一可靠的偵測方式。
> Squash merge 不產生 `MERGE_HEAD`，所以 file watch `.git/MERGE_HEAD` 不可行。
> Index 的 unmerged entries 不管 merge 類型都會正確反映。

### 觸發時機（事件驅動 + poll 兜底）

| 觸發條件 | 說明 |
|---|---|
| Merge 失敗後 | 立即 refresh — 即時回饋 |
| `onDidSaveTextDocument` | 用戶儲存檔案時檢查（可能在 resolve conflict） |
| 5 秒 poll（現有） | 兜底，保證不漏 |

## 改動清單

### 1. GitUtils — 新增 `hasConflicts()`

```typescript
async hasConflicts(): Promise<boolean> {
  const output = await this.git.raw(['status', '--porcelain']);
  return output.split('\n').some(line => /^(UU|AA|DD|DU|UD)/.test(line));
}
```

### 2. ShadowClone 型別 — 新增 `hasConflict`

```typescript
interface ShadowClone {
  // ...existing fields
  hasConflict?: boolean;
}
```

### 3. ShadowTreeProvider

- `getShadowClones()` 每個 worktree 呼叫 `hasConflicts()` 填入 `hasConflict`
- `ShadowItem` constructor 根據 `hasConflict` 調整 `description`
  - 有 conflict：`⚠️ · ← main` 或 `⚠️ · Current Branch`
  - 無 conflict：`← main` 或 `Current Branch`
- 🏠 Home item 也要偵測（對 rootPath 跑 `hasConflicts()`）

### 4. extension.ts

- Merge 失敗（catch CONFLICT）後呼叫 `shadowTreeProvider.refresh()`
- 移除 `setReviewStatus(branchName, 'conflict')` 邏輯
- 註冊 `onDidSaveTextDocument` listener 觸發偵測

### 5. Revert 先前的 conflict ReviewStatus

- `constants.ts`：移除 `'conflict'` from `ReviewStatus` type
- `ShadowTreeProvider.ts`：移除 `conflict` 的 icon mapping、label、cycle 邏輯
- `extension.ts`：移除 catch CONFLICT 裡的 `setReviewStatus` 呼叫
- `status-conflict.svg`：保留（用於其他潛在用途）或刪除

## 效能考量

- 每次 refresh 對 N 個 worktree 跑 N 次 `git status --porcelain`
- `git status --porcelain` 通常 < 50ms
- 10 個 clone = ~500ms，可接受
- 如果需要優化：可只在 event trigger 時偵測，poll 時不跑

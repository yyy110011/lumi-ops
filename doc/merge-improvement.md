# Merge 改進

## 目標

改進 Squash & Merge 功能，讓用戶可以選擇 merge 的目標 branch，並自動使用 metadata 中記錄的 `baseBranch` 作為預設目標。

## 現況問題

目前 `merge.ts` 直接 merge 到 root workspace 的 current branch，完全無視 spawn 時記錄在 `.lumi-metadata.json` 裡的 `baseBranch`。這導致：
1. 如果用戶 checkout 在錯誤的 branch 上，merge 就會到錯的地方
2. Spawn 時辛苦選的 base branch 資訊被浪費了

## 改動規格

### CLI (`packages/cli/src/commands/merge.ts`)

目前簽名：
```typescript
merge(branchName: string, options: { root: string })
```

改為：
```typescript
merge(branchName: string, options: { root: string; targetBranch?: string })
```

邏輯：
1. 如果有 `targetBranch`，先 `git checkout targetBranch`（在 root 執行）
2. 執行 `git merge --squash branchName`
3. Commit（commit message 應該讓 extension 傳入，不再 hardcode）
4. 如果步驟 1 有 checkout，merge 完後 `checkout` 回原本的 branch

Edge case：
- Checkout 失敗（dirty working tree）→ 拋 error，提示用戶先 commit 或 stash
- Merge conflict → 現有的 CONFLICT 處理不變

### Extension (`packages/extension/src/extension.ts`)

Merge command handler 改為：

1. 從 `.lumi-metadata.json` 讀取該 clone 的 `baseBranch`
2. 取得 root 的 current branch（`git.getCurrentBranch()`）
3. 檢查 `baseBranch` 是否在另一個 worktree 中（用 `git worktree list` 比對）
4. 顯示選項給用戶：
   - **「⚡ Squash & Merge → Base (develop)」** — 預設/推薦選項
   - **「⚡ Squash & Merge → Current (main)」** — 如果 current ≠ base 才顯示
   - 如果 current == base，只顯示一個選項
5. 如果用戶選的 target 在另一個 worktree 中 → 顯示 warning：
   > ⚠️ "develop" is currently checked out in another worktree. Merging may cause conflicts with ongoing work. Continue anyway?  [Merge Anyway] [Cancel]
   - 用戶同意 → 在那個 worktree 的 cwd 裡執行 merge（`git -C <worktree-path> merge --squash`）
   - 用戶取消 → 不做
6. Commit message 讓用戶確認/編輯（用 `showInputBox` 帶入預設值）

### 測試 (`packages/cli/src/commands/merge.test.ts`)

新增或更新：
- targetBranch 有值時 checkout → merge → checkout back
- targetBranch 為空時使用 current branch（現有行為）
- dirty working tree 時 checkout 失敗
- conflict 處理不變

## 不做的事

- 不做 rebase 功能 — 如果 base 開錯，建議用戶重開 clone
- 不做 pull remote — merge 完後續的 push / rebase 由用戶自行處理
- 不做自動偵測 base 更新 — 只負責 squash merge，不管 base 是否有新 commit

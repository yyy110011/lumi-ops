# QA Checklist — Merge Improvement (Manual Only)

> Branch: `fix/target-merge-branch`
> 前置：`cd packages/extension && pnpm run build` 後 F5 啟動 Extension Dev Host
>
> **自動化覆蓋**（不需手動測）：
> - ✅ Merge 基本功能、custom commitMessage、cwd merge → `e2e.test.ts`
> - ✅ Conflict throw、hasConflicts detect + auto-clear → `e2e.test.ts`
> - ✅ hasConflicts() 各種 porcelain 狀態 → `git.test.ts`
> - ✅ Metadata：new branch 記 baseBranch、existing branch 留空、custom baseBranch → `e2e.test.ts`
> - ✅ Review status cycle (todo/inProgress/done/wontDo) → `git.test.ts`
>
> 執行自動測試：`pnpm test && npx vitest run src/__tests__/e2e.test.ts`

---

## 1. QuickPick UI

### 1.1 兩個選項
- [ ] Root checkout 到 `develop`，Spawn clone (base = `main`)
- [ ] 右鍵 → Merge → 確認 QuickPick 顯示 Base (main) `← recommended` + Current (develop)

### 1.2 Auto-skip（Base = Current）
- [ ] Root checkout 到 `main`，Spawn clone (base = `main`)
- [ ] 右鍵 → Merge → 確認**跳過 QuickPick**，直接進 commit message

### 1.3 取消操作
- [ ] QuickPick 按 Esc → 無副作用
- [ ] Commit message 按 Esc → 無副作用

---

## 2. Worktree 衝突警告 Dialog

- [ ] 確保 target branch 已在另一個 worktree
- [ ] Merge 時確認 QuickPick 顯示 `⚠️ in another worktree`
- [ ] 選擇後確認 modal warning → Cancel 不 merge → Merge Anyway 成功

---

## 3. Existing Branch → baseBranch 留空

- [ ] 預先建 branch `feat/existing-test`，切回 main
- [ ] 從 sidebar Spawn，Branch Name 選 `feat/existing-test`
- [ ] 確認 tree view description 顯示 `Shadow Clone`（非 `← main`）
- [ ] 右鍵 → Merge → 確認 QuickPick **沒有** `← recommended`（因為 base 未知）

---

## 4. Conflict ⚠️ Tree View 顯示

### 4.1 製造 Conflict
```bash
echo "original" > conflict-test.txt && git add . && git commit -m "add"
# Spawn clone, 在 clone 改同一行, commit
# 回 root 改同一行, commit
```

### 4.2 驗證
- [ ] Merge → warning message 出現
- [ ] 🏠 Home description 顯示 `⚠️ · Current Branch`
- [ ] Source clone 的 review icon **不受影響**

### 4.3 Auto-clear
- [ ] Resolve → `git add` → 等 5 秒或 🔄 → `⚠️ ·` 消失

### 4.4 Review cycle 不受 conflict 影響
- [ ] 有 conflict 時 click clone → status 正常 cycle

---

## 5. Post-merge

- [ ] 成功 merge 後出現刪除確認 → Yes 刪除 / No 保留

---

## 6. 回歸

- [ ] Spawn / Kill 功能正常
- [ ] Rapid click debounce 正常

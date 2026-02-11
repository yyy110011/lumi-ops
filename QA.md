# QA Checklist — feat/branch-detail-management

## Creator Panel（建立 Clone）

- [ ] 1. 輸入全新 branch 名稱 → Base Branch dropdown 出現，預設為 current branch
- [ ] 2. 從 dropdown 選擇現有 branch → Base Branch dropdown 隱藏
- [ ] 3. 選了現有 branch 後清除、重新輸入新名稱 → Base Branch dropdown 重新出現
- [ ] 4. 點 Base Branch ▾ 按鈕 → 列出所有 branch（含 current 標記 + remote），current 有 `← current`
- [ ] 5. 選不同的 Base Branch，Spawn → worktree 以選定的 base 為基礎建立
- [ ] 6. 不填 description，按 Spawn → 按鈕顯示 "Create Clone Only"，clone 建立成功無 MISSION.md
- [ ] 7. 填了 description，按 Spawn → 按鈕顯示 "Spawn Agent"，clone 有 MISSION.md
- [ ] 8. Spawn 成功後 → 表單清空，dropdown 重新載入

## Active Clones Tree（左側列表）

- [ ] 9. 新建立的 clone → 顯示 `← <baseBranch>` 作為 description
- [ ] 10. 第一次點擊 clone row → 只 focus（highlight），狀態不變
- [ ] 11. 再點一次同一 row → 狀態從 ○ todo → 🔄 inProgress（spinning）
- [ ] 12. 繼續連點 → inProgress → ✓ done → ✗ wontDo → ○ todo（循環）
- [ ] 13. 點另一個 branch，再回來點原來的 → 第一次點新 branch 只 focus
- [ ] 14. 點 Open Clone 按鈕 (📂 icon) → 新視窗打開 worktree 資料夾
- [ ] 15. 點 Kill 按鈕 (🗑 icon) → 彈出確認框，可選保留或刪除 branch

## Worktree Filtering

- [ ] 16. 建兩個 clone（A 和 B），打開 Branch Name dropdown → A 和 B 不在列表中
- [ ] 17. Kill 掉 clone A，重新打開 dropdown → A 重新出現
- [ ] 18. 打開 Base Branch dropdown → A 和 B 都在列表中（不過濾 worktree）

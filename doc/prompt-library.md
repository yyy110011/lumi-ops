# Prompt Library 設計草案

> 統一管理 AI Agent 的 prompt 模板，在 root mode 和 shadow mode 共用同一套儲存。

## 儲存架構

三層結構，全部使用 `.md` 檔案（一個 prompt 一個檔案）：

| 層級 | 路徑 | Git 追蹤 | 說明 |
|---|---|---|---|
| **Global** | `~/.lumi-ops/prompts/*.md` | N/A | 跟隨用戶，所有專案共用 |
| **Project** | `<repo>/.lumi-ops/prompts/*.md` | 待定 | 某個專案內的 prompts |
| **Clone-local** | `<worktree>/MISSION.md` | 不追蹤 | 這次任務的目標 |

## 目錄結構

```
~/.lumi-ops/
└── prompts/
    ├── run-tests.md
    ├── security-review.md
    └── write-commit.md

<repo>/.lumi-ops/
└── prompts/
    ├── lint-fix.md
    └── zod-pattern.md

<repo>/.shadow-clones/          ← 維持獨立，不搬進 .lumi-ops
├── feat/login/
│   └── MISSION.md
└── metadata.json
```

## UI 行為

### Root Mode
- Prompt library 用於**撰寫 MISSION.md**（spawn 時選模板）
- 支援新增 / 編輯 / 刪除 prompts（寫入 global 或 project 層）

### Shadow Mode
- 同一套 prompt library，用於**中途指令**
- MISSION.md 排在最上方，跟其他 prompts 並列
- 點任何 prompt → 在 editor 開啟

## 與 Prompt Library Branch 的關聯

此設計需與進行中的 prompt library feature branch 整合：
- Shared prompts = Global 層
- Project prompts = Project 層
- Root 和 Shadow 模式共用同一套讀寫邏輯

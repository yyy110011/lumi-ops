# MCP Server 做到極致：完整策略分析

## 現況盤點

目前 `@lumi-ops/mcp-server` 提供 **14 個 Tools、6 個 Resources、4 個 MCP Prompts**，涵蓋 Shadow Clone 完整生命週期：

| 類別 | 現有 Tools |
|------|-----------|
| 生命週期 | `spawn_clone`, `kill_clone`, `list_clones`, `merge_clone` |
| Review 工作流 | `review_clone`, `request_revision`, `set_clone_status` |
| Prompt 管理 | `list_prompts`, `save_prompt` |
| 偵錯 | `get_clone_file_diff`, `get_clone_log`, `read_clone_file` |
| 配置 | `set_project_root`, `list_repos` |

**已實現的 MCP Protocol 功能**：Tools ✅、Resources ✅、Prompts ✅
**未使用的 MCP Protocol 功能**：Sampling、Notifications、Structured Outputs

---

## 做到極致的 8 個維度

### 📦 維度 1：善用 MCP Protocol 原生功能

目前只用了 **Tools**，但 MCP 規範提供了更多能力：

#### 1a. Resources（資源暴露） ✅ Done (v0.4.3)

讓 AI Agent 可以「讀取」而非「呼叫」：

| Resource URI | 用途 |
|---|---|
| `lumi://clones` | Clone 列表（比 tool call 更適合 Agent 主動查詢） |
| `lumi://clones/{branch}/mission` | 直接讀取特定 clone 的 MISSION.md |
| `lumi://clones/{branch}/report` | 讀取 MISSION_COMPLETE.md |
| `lumi://clones/{branch}/feedback` | 讀取 REVIEW_FEEDBACK.md |
| `lumi://prompts/{scope}/{name}` | 讀取特定 prompt 內容 |
| `lumi://config` | 當前配置（rootDir, detection method, version） |

> [!TIP]
> **Resources vs Tools 的差異**：Resources 讓 Agent 用「讀取」的方式取得上下文，不會產生 side effect。適合在 Agent 規劃階段先「看看有什麼」，而不是立刻操作。部分 MCP Client 對 Resources 有更好的 context window 管理。

#### 1b. MCP Prompts（提示模板） ✅ Done (v0.4.3)

將 Lumi-Ops 的工作流封裝為標準 MCP Prompt Template：

| Prompt 名稱 | 用途 |
|---|---|
| `review-and-merge` | 引導 Agent 完成 review → merge 流程 |
| `spawn-with-context` | 引導 Agent 從現有 issue/描述 spawn clone |
| `multi-clone-strategy` | 引導 Root Agent 規劃多 clone 並行策略 |
| `resolve-conflict` | 引導 Agent 處理 merge conflict |

這些會出現在 MCP Client 的 Prompt 選單裡，像是 Antigravity 的 slash command。

#### 1c. Notifications（變更通知）

實現 **`notifications/resources/list_changed`**，當 clone 狀態改變時主動通知 Client：

- Clone 被 spawn/kill → 通知
- Review status 變更 → 通知
- MISSION_COMPLETE.md 出現 → 通知（Agent 完成工作了！）

這讓 Root Agent 可以「等待」而非「輪詢」。

#### 1d. Structured Tool Outputs（2025.11 Spec）

目前所有 tool 都回傳 JSON text，但新規範支持 **structured output**，讓 Agent 不需要 parse JSON string：

```typescript
// 現在
{ content: [{ type: 'text', text: JSON.stringify(data) }] }

// 新規範（向後相容）
{ content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data }
```

---

### 🔧 維度 2：Post-Spawn Hooks（環境自動化）

這是**最高 ROI** 的新功能，直接解決 Python/Node/Rust 等語言的環境設定痛點：

```
spawn → create worktree → copy files → run post-spawn hooks → done
```

#### 設計方案

```yaml
# .lumi-ops.yaml（repo 根目錄）
postSpawn:
  - name: "Install Node dependencies"
    run: "npm install"
    when: "package.json"       # 當此檔案存在時執行
    
  - name: "Setup Python venv"
    run: "python -m venv .venv && .venv/bin/pip install -r requirements.txt"
    when: "requirements.txt"
    
  - name: "Poetry install"
    run: "poetry install"
    when: "pyproject.toml"
    
  - name: "Rust build"
    run: "cargo build"
    when: "Cargo.toml"
```

#### MCP Server 需要的改動

- `spawn_clone` tool 增加 `runHooks` 參數（default: true）
- Hook 執行結果回傳在 spawn response 中
- 支援 timeout 和失敗處理策略（`continueOnError: true/false`）

---

### 🤖 維度 3：Agent 編排工具

讓 Root Agent 能更有效地管理多個 Clone Agent：

| 新 Tool | 功能 | 狀態 |
|---------|------|------|
| `exec_in_clone` | 在指定 clone 的 worktree 目錄中執行命令（sandbox） | ❌ v0.6 |
| `read_clone_file` | 讀取 clone 中的特定檔案 | ✅ v0.4.3 |
| `get_clone_health` | 健康檢查：build 狀態、test 結果、lint 結果 | ❌ |
| `batch_status` | 一次更新多個 clone 的狀態 | ❌ |
| `get_clone_log` | 取得 clone 的 git log（最近 N 筆 commit） | ✅ v0.4.3 |

#### `exec_in_clone` — 核心安全考量

```typescript
server.tool('exec_in_clone', {
  branch: z.string(),
  command: z.string(),
  timeout: z.number().default(30000),
}, async ({ branch, command, timeout }) => {
  // 1. 驗證 branch 存在
  // 2. 解析 worktree path
  // 3. 路徑防護：確保 command 不會逃出 worktree
  // 4. 執行 command，設 timeout
  // 5. 回傳 stdout/stderr
});
```

> [!WARNING]
> 這就是 roadmap 中 v0.6 MCP Agent Sandbox 的核心。要做好需要：path traversal 防護、commands allowlist/denylist、resource limits。

---

### 🌐 維度 4：Multi-Repo 支援

目前 MCP Server 是 **single-repo** 設計。要支援多 repo：

| 方案 | 說明 | 複雜度 |
|------|------|--------|
| **A. 多實例** | 每個 repo 啟動一個 MCP Server | 低，Client 負責管理 |
| **B. Single Server + Repo 切換** | `set_project_root` 已部分實現 | 中，需要防止狀態混淆 |
| **C. 所有 Tool 加 `repo` 參數** | 每個 call 指定 repo | 高，API 變複雜 |

**建議**：維持方案 B，但加入 **`list_repos`** tool（讀取 `~/.lumi-ops/.registry.json`）讓 Agent 知道有哪些 repo 可以操作。 ✅ `list_repos` 已實現 (v0.4.3)

---

### 📊 維度 5：Observability（可觀測性）

#### Server 狀態 Resource

```
lumi://server/status
```

回傳：
- `rootDir` 及偵測方式
- Server 版本
- 已註冊的 clone 數量
- 上次操作時間戳

#### Tool 執行日誌

考慮加入 **`logging/message`** notification，讓 Client 可以看到 MCP Server 的操作日誌：

```typescript
server.server.sendLoggingMessage({
  level: 'info',
  data: `Spawned clone: ${branch} at ${clonePath}`
});
```

---

### 🔒 維度 6：安全增強

| 項目 | 說明 | 優先級 |
|------|------|--------|
| **Input validation** | 所有 branch name / path 要 sanitize | 🔴 高 |
| **Path traversal defence** | `exec_in_clone` 必須限制在 worktree 內 | 🔴 高（v0.6） |
| **Rate limiting** | 防止 Agent 瘋狂 spawn | 🟡 中 |
| **Operation audit log** | 記錄所有 tool 操作到 `~/.lumi-ops/audit.log` | 🟢 低 |
| **OAuth / Auth** | Remote MCP Server 場景需要認證 | 🟢 未來 |

---

### 📚 維度 7：文件與 Onboarding

要讓非 VS Code 用戶也能用好 MCP Server：

| 文件 | 內容 |
|------|------|
| **Quick Start: Antigravity + MCP** | 配置 `mcp.json`，首次使用教學 |
| **Quick Start: Claude Desktop + MCP** | 同上，Claude Desktop 配置 |
| **Quick Start: Cursor + MCP** | 同上 |
| **Quick Start: PyCharm + Junie + MCP** | 針對 PyCharm 用戶的教學 |
| **Workflow Guide: Multi-Agent** | Root Agent 如何用 MCP tools 管理多 clone |
| **Config Reference** | `.lumi-ops.yaml` 所有配置項說明 |

---

### 🗺️ 維度 8：Discovery & Discoverability

讓 Agent 在首次連接時就理解 Lumi-Ops 能做什麼：

#### Tool Descriptions 優化

目前的 tool descriptions 偏短，應加入 **使用情境** 和 **與其他 tool 的關係**：

```typescript
// 現在
'Create a new shadow clone (worktree) with optional prompt content.'

// 優化後
'Create a new isolated workspace (shadow clone) using Git worktree. ' +
'Use this when you need to work on a feature/fix in isolation. ' +
'Pair with list_prompts to find existing task prompts, ' +
'or provide a description directly. ' +
'After work is complete, use set_clone_status to mark as needsReview.'
```

#### Tool Icon Metadata（2025.11 Spec）

新規範支持為 Tool 加圖標，提升 Client UI 的可讀性。

---

## 優先級路線圖

| 優先級 | 項目 | 預估工時 | 版本 | 狀態 |
|--------|------|---------|------|------|
| 🔴 P0 | Post-spawn hooks（`.lumi-ops.yaml`） | 2-3 週 | v0.5 | ❌ |
| 🔴 P0 | Tool descriptions 優化 | 2 天 | v0.4.x | ❌ |
| 🟡 P1 | Resources 暴露（clone list, mission, config） | 1 週 | v0.4.3 | ✅ |
| 🟡 P1 | MCP Prompts（workflow templates） | 1 週 | v0.4.3 | ✅ |
| 🟡 P1 | `list_repos` tool | 2 天 | v0.4.3 | ✅ |
| 🟡 P1 | `read_clone_file` tool | 2 天 | v0.4.3 | ✅ |
| 🟡 P1 | Quick Start 文件（3-4 個 IDE） | 1 週 | v0.5 | ❌ |
| 🟢 P2 | Notifications（clone status changes） | 1 週 | v0.5+ | ❌ |
| 🟢 P2 | Structured outputs | 3 天 | v0.5+ | ❌ |
| 🟢 P2 | Logging messages | 2 天 | v0.5+ | ❌ |
| 🟢 P2 | `exec_in_clone`（sandbox） | 2-3 週 | v0.6 | ❌ |
| 🟢 P2 | `get_clone_health` | 1 週 | v0.6 | ❌ |
| ⚪ P3 | Audit logging | 3 天 | 未來 | ❌ |
| ⚪ P3 | OAuth / Remote server auth | 2 週 | 未來 | ❌ |

---

## 核心洞見

> [!IMPORTANT]
> **MCP Server 做到極致 = IDE-agnostic 的 Lumi-Ops**。投入在 MCP Server 上的每一分鐘，都同時服務於 VS Code、PyCharm、Cursor、Neovim、Claude Desktop、以及任何未來的 MCP Client。這是 **1×N** 的投資，而不是為每個 IDE 寫 extension 的 **N×N**。

最高 ROI 的三件事：
1. **Post-spawn hooks** — 解決所有語言的環境設定痛點
2. **Resources** — 讓 Agent 有更好的 context awareness
3. **Quick Start 文件** — 讓非 VS Code 用戶 5 分鐘內上手

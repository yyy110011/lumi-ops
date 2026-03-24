# Lumi-Ops TUI — Protocol Types

## `.lumi-metadata.json` — Per-repo metadata

```json
{
  "feat/my-task": {
    "baseBranch": "main",
    "description": "Add auth module",
    "reviewStatus": "inProgress",
    "sourcePrompt": "add-auth.md"
  }
}
```

**Rust struct:**
```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloneMetadata {
    pub base_branch: Option<String>,
    pub description: Option<String>,
    pub review_status: Option<ReviewStatus>,
    pub source_prompt: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ReviewStatus {
    Todo,
    InProgress,
    Done,
    WontDo,
    NeedsReview,
    NeedsRevision,
}
```

## `~/.lumi-ops/.registry.json` — Global repo registry

```json
{
  "lumi-ops": "/Users/ryan/project_in_progress/lumi-ops",
  "lumadient": "/Users/ryan/project_in_progress/lumadient"
}
```

**Rust struct:**
```rust
pub type RepoRegistry = std::collections::HashMap<String, String>;
// key = repo name, value = absolute root path
```

## Clone Directory Layout

```
<repoRoot>.worktrees/
├── .lumi-metadata.json      ← centralized metadata for ALL clones
├── feat/my-task/             ← worktree directory
│   ├── .lumi/
│   │   ├── MISSION.md
│   │   ├── MISSION_COMPLETE.md
│   │   └── REVIEW_FEEDBACK.md
│   └── (source code)
└── fix/bug-123/
```

- Clone ID = relative path under `.worktrees/` (e.g., `feat/my-task`)
- Metadata path = `<repoRoot>.worktrees/.lumi-metadata.json`
- Mission path = `<worktreePath>/.lumi/MISSION.md`

## Status Icons

| ReviewStatus | Icon |
|-------------|------|
| `todo` | 🟡 |
| `inProgress` | 🔵 |
| `needsReview` | 🟣 |
| `needsRevision` | 🟠 |
| `done` | ✅ |
| `wontDo` | ⬛ |

| Agent Status | Icon |
|-------------|------|
| Running | 🤖 |
| Waiting (input) | ⏳ |
| Completed | ✅ |
| Failed | ❌ |
| Idle (no tmux) | 💤 |

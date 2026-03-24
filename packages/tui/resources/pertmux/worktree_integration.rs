// ─── Pertmux Worktree Integration (worktrunk CLI) ────────────────────────────
// Source: https://github.com/rupert648/pertmux  |  License: MIT
//
// Pertmux integrates with the `wt` (worktrunk) CLI for worktree management.
// This is analogous to how lumi-tui integrates with `lumi-ops` CLI.

// ─── 1. Data Types ───────────────────────────────────────────────────────────
//
// Worktree state from `wt list --format=json`:
//
// pub struct WtWorktree {
//     pub branch: Option<String>,               // "feat/protocol" or null (detached)
//     pub path: Option<String>,                  // absolute worktree path
//     pub kind: String,                          // "worktree" | "branch"
//     pub commit: WtCommit,
//     pub working_tree: Option<WtWorkingTree>,   // staged/modified/untracked status
//     pub main_state: Option<String>,            // "is_main" | "diverged" | ...
//     pub main: Option<WtMain>,                  // ahead/behind vs main branch
//     pub remote: Option<WtRemote>,              // remote tracking info
//     pub worktree: Option<WtWorktreeState>,     // detached/state info
//     pub is_main: bool,
//     pub is_current: bool,
//     pub is_previous: bool,
//     pub symbols: Option<String>,               // "^|" "↕|⚑" status symbols
// }
//
// pub struct WtCommit {
//     pub sha: String,
//     pub short_sha: String,
//     pub message: String,
//     pub timestamp: i64,
// }
//
// pub struct WtWorkingTree {
//     pub staged: bool,
//     pub modified: bool,
//     pub untracked: bool,
//     pub renamed: bool,
//     pub deleted: bool,
//     pub diff: Option<WtDiff>,   // { added: u64, deleted: u64 }
// }
//
// pub struct WtMain {
//     pub ahead: u64,
//     pub behind: u64,
// }

// ─── 2. Worktree CRUD via CLI ────────────────────────────────────────────────
//
// All operations use `tokio::process::Command` (async, non-blocking):
//
// List:
//   wt -C {local_path} list --format=json
//   → parse JSON → filter kind == "worktree" (excludes plain branches)
//
// Create:
//   wt -C {local_path} switch --create {branch} --no-cd -y --no-verify
//
// Remove:
//   wt -C {local_path} remove {branch} -y -f --foreground --no-verify
//
// Merge:
//   wt -C {worktree_path} merge -y --no-verify
//
// Error handling: graceful — if `wt` not found (NotFound error), return empty vec.
// All commands: check status.success(), bail with stderr on failure.

// ─── 3. Pattern: CLI Subprocess as Data Source ───────────────────────────────
//
// pub async fn fetch_worktrees(local_path: &str) -> Result<Vec<WtWorktree>> {
//     let output = match Command::new("wt")
//         .args(["-C", local_path, "list", "--format=json"])
//         .output().await {
//         Ok(o) => o,
//         Err(e) if e.kind() == ErrorKind::NotFound => return Ok(vec![]),
//         Err(e) => return Err(e.into()),
//     };
//     if !output.status.success() { return Ok(vec![]); }
//     let all: Vec<WtWorktree> = serde_json::from_str(&stdout)?;
//     Ok(all.into_iter().filter(|w| w.kind == "worktree").collect())
// }
//
// This is the same pattern we'll use for `lumi-ops list --json` in lumi-tui.
// The daemon calls this on an interval (30s by default).

// ─── 4. Guard Rails ─────────────────────────────────────────────────────────
//
// - Cannot remove main worktree: checked in client.rs before sending command
// - Cannot merge main worktree: same guard
// - Worktree selection clamped after operations (list might shrink)

// ─── Adoption Notes for lumi-tui ─────────────────────────────────────────────
//
// Direct mapping to our architecture:
//   wt list --format=json  →  lumi-ops list --root {path} --json
//   wt switch --create     →  lumi-ops spawn {branch} --root {path}
//   wt remove              →  lumi-ops kill {branch} --root {path}
//   wt merge               →  lumi-ops merge {source} {target} --root {path}
//
// Key difference: We don't need `--format=json` because lumi-ops already
// outputs structured JSON from `list`. We also have richer metadata
// (reviewStatus, description, sourcePrompt) from .lumi-metadata.json.
//
// The async subprocess pattern and error handling are directly reusable.

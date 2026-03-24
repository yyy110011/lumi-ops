// ─── Pertmux UI Components ───────────────────────────────────────────────────
// Source: https://github.com/rupert648/pertmux  |  License: MIT

// ─── 1. Popup State Machine ─────────────────────────────────────────────────
//
// Each popup variant carries its own state. Key handler checks popup FIRST:
//
// pub enum PopupState {
//     None,
//     CreateWorktree { input: String },
//     ConfirmRemove { branch: String },
//     ConfirmMerge { branch: String, worktree_path: String },
//     ProjectFilter { input: String, filtered: Vec<(usize, String)>, selected: usize },
//     ChangeSummary { changes: Vec<MrChange>, selected: usize },
//     AgentActions { selected: usize, pane_pid: u32, session_id: String, ... },
// }
//
// Pattern: popup handlers return early → normal keys only fire when popup == None.

// ─── 2. Project Fuzzy Finder (nucleo_matcher) ────────────────────────────────
//
// Uses nucleo_matcher (same engine as Helix editor) for fuzzy search:
//
// let mut matcher = Matcher::new(nucleo_matcher::Config::DEFAULT);
// let pattern = Pattern::parse(input, CaseMatching::Ignore, Normalization::Smart);
// let matches = pattern.match_list(names, &mut matcher);
//
// For lumi-tui: fuzzy-matcher crate is simpler and sufficient for clone names.

// ─── 3. Notification System ─────────────────────────────────────────────────
//
// Timed notifications: Option<(String, Instant)>
// Auto-dismiss in draw fn after ~3 seconds elapsed.
// pub fn notify(&mut self, msg: impl Into<String>) {
//     self.notification = Some((msg.into(), Instant::now()));
// }

// ─── 4. Multi-Project Selection State ────────────────────────────────────────
//
// Per-project independent selection indices:
//   active_project: usize
//   mr_selected: Vec<usize>        // one index per project
//   worktree_selected: Vec<usize>  // one index per project
//   selection_section: Vec<SelectionSection>  // MergeRequests | Worktrees
//
// When snapshot arrives with new projects, vectors are extended with defaults.
// Existing selections are clamped to valid ranges.
// Tab toggles section within project; Left/Right switches projects.

// ─── 5. Clipboard & Browser ─────────────────────────────────────────────────
//
// Copy: pipe branch name to "pbcopy" (macOS). Cross-platform: use arboard crate.
// Open: Command::new("open").arg(url) on macOS, "xdg-open" on Linux.

// ─── 6. Last Project Persistence ─────────────────────────────────────────────
//
// Saves active project name to dirs::data_dir()/pertmux/last_project.
// Restores on next launch for seamless project switching.

// ─── 7. Agent Actions Popup ──────────────────────────────────────────────────
//
// Configurable prompts sent to agents. Template variables: {target_branch}, {mr_url}.
// Flow: select worktree → find matching tmux pane → get session_id → show actions.

// ─── 8. Age Formatting ──────────────────────────────────────────────────────
//
// fn format_age(timestamp: i64) -> String {
//     if delta < 60 { "just now" }
//     else if delta < 3600 { format!("{}m ago", delta / 60) }
//     else if delta < 86400 { format!("{}h ago", delta / 3600) }
//     else { format!("{}d ago", delta / 86400) }
// }

// ─── Adoption Notes ──────────────────────────────────────────────────────────
//
// USE: PopupState enum, notification system, per-project selection, age formatting
// SKIP: nucleo_matcher (use fuzzy-matcher), MR/pipeline UI, pbcopy (use arboard)

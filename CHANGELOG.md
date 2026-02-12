# Changelog

All notable changes to this project will be documented in this file.

## [0.2.6] - 2026-02-12

### ✨ New Features
- **Merge Target Selection** — Squash & Merge now lets you choose which branch to merge into, not just the current branch. The recorded base branch is marked as `← recommended`.
- **Merge Conflict Detection** — `hasConflicts()` API detects unresolved merge conflicts. Active Clones tree shows ⚠️ indicator on conflicted worktrees.
- **Dropdown Search Filter** — Branch Name and Base Branch fields now act as live search inputs. Click to open the dropdown, type to filter branches in real-time.
- **Existing Branch Base Handling** — Spawning from an existing branch no longer incorrectly records a base branch. Base is left empty (unknown).

### 🎨 UX Improvements
- **Simplified Merge Flow** — Reduced from 2 steps (select branch + fill message) to 1 step (select branch). Default commit message `feat: merged <branch> (squash)` is applied automatically.
- **Removed ▾ Buttons** — Branch Name and Base Branch inputs open their dropdown on focus, making dedicated browse buttons redundant.
- **Enter/Tab Dismisses Dropdown** — Pressing Enter or Tab closes the active dropdown. Focusing one input auto-closes the other's dropdown.
- **Create New Branch Hint** — When typed branch name matches no existing branches, dropdown shows `+ Create new branch: <name>` instead of "No matching branches".

### 🧪 Testing
- Added 4 new e2e tests: custom `commitMessage`, `cwd` merge into different branch, conflict `CONFLICT` throw, and `hasConflicts()` auto-detect + auto-clear.
- Added unit tests for metadata read/write with existing branches (empty `baseBranch`).

### 🐛 Bug Fixes
- Fixed existing branch spawn incorrectly setting `baseBranch` to the current branch.

---

## [0.2.5] - 2026-02-11

### ✨ New Features
- **Review Status Tracking** — Click clones to cycle through Todo → In Progress → Done → Won't Do.
- **Remote Branch Support** — Browse and select remote branches in the dropdown.
- **Base Branch Selection** — Pick any branch as the base for new clones.
- **Existing Branch Support** — Attach worktrees to existing branches.
- **Flexible Kill Options** — Choose to keep or delete the branch when killing a clone.
- **Centralized Metadata** — Single `.lumi-metadata.json` at `.shadow-clones/` root.

### 🐛 Bug Fixes
- Fixed focus-then-click guard for status cycling.
- Fixed worktree-occupied branches appearing in Branch Name dropdown.

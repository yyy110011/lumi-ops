# Design: Free-to-delete `.worktrees` + GC/reconcile + decoupled metadata

> Status: **DESIGN / PENDING APPROVAL** (no code written yet).
> Updated 2026-06-14 after the problem was reframed by the user.
> Supersedes the earlier "auto-delete empty folder on last kill" framing.

## 0. The real problem (reframed)

The original ask ("auto-delete `.worktrees` when the last clone is killed") was
only the surface. The actual requirements:

1. **A user must be able to delete `.worktrees` directly, without worry**, if
   they don't want it — no crash, no corrupted state, no lost durable data.
2. **There must be a way to tidy/clear leftover worktrees** — reconcile git's
   internal registrations and the tool's metadata after manual deletion.
3. *(Bonus)* Auto-remove the empty `.worktrees` container too.

This is **deletion-tolerance + a GC/reconcile mechanism**, not an auto-delete in
the hot `kill` path. A user-invoked GC also **dissolves the spawn/remove TOCTOU
race** that the auto-on-kill design could not safely close — GC runs when the
user chooses, never concurrently with the kill flow.

## 1. Why metadata ended up inside `.worktrees` (answering "why?")

`constants.ts:32` comment: *"Now unified with the worktrees directory."*
It was a **convenience co-location**: when `.worktrees/` became the standard
per-repo location, the metadata file was put there too because it sits outside
the repo tree (no repo pollution, no gitignore needed, never committed), one
place per repo. It works — until you want to freely delete `.worktrees`. The
coupling (`getRepoStorageDir === getClonesDir`) is exactly what makes the durable
state vulnerable to a folder the user should be free to remove.

## 2. The keystone: decouple metadata from `.worktrees`

Moving `.lumi-metadata.json` **out** of `.worktrees` is the single change that
makes everything else fall into place:

- `rm -rf .worktrees` loses **no durable state** → true "without worry".
- Auto-removing the empty container becomes **trivially safe** — `.worktrees`
  then holds only worktree subdirs, so "empty" is real; the earlier
  orphan-metadata **data-loss trap disappears entirely** (no gate (c) needed).
- GC can reconcile cleanly: drop entries whose worktree path no longer exists,
  **keep** annotations (baseBranch/description/status) for branches that survive.

### Where to move it — DECIDED: **R = `<repoRoot>/.lumi/metadata.json`**

Chosen 2026-06-14. Visible/discoverable, matches the existing `.lumi/`
convention, minimal resolver change.

**The "must be excluded or it gets committed" risk is already solved** —
`gitExclude.ts:6` already lists `.lumi/` in the exclude patterns, and
`ensureGitExclude()` already runs on every activation for every root
(`extension.ts:131`), writing to `.git/info/exclude` (common dir for
worktrees). So `<root>/.lumi/metadata.json` is git-excluded with **zero new
work**.

`.lumi/` convention after this change (consistent):
- **clone** `.lumi/` → that clone's MISSION.md / MISSION_COMPLETE.md (`spawn.ts:144`).
- **root** `.lumi/` → repo-level `metadata.json` (currently unused at root → safe).

Implementation: change `getRepoStorageDir(rootDir)` to return
`path.join(rootDir, '.lumi')` (decoupled from `getClonesDir`); metadata path
becomes `<root>/.lumi/<METADATA_FILE>`. Clones already resolve via
`mainRepoRoot`, so they keep reading the root's metadata.

### Migration
One-time, reuse the `migration.ts` pattern: if old
`.worktrees/.lumi-metadata.json` exists and the new location doesn't, move it.

### Call-site impact (honestly scoped)
Most reads go through `getRepoStorageDir()` → change that **one helper** to the
new location. Direct `getClonesDir(...) + METADATA_FILE` bypasses exist at
`WorktreeManagerPanel.ts:157,229` — repoint them to `getRepoStorageDir`. Done.

## 3. Phase 2 — self-tidying (FULLY AUTOMATIC, no manual button)

> Decided 2026-06-14: **no manual button, no `lumi-ops gc` command in the UI.**
> Tidying must be invisible — it just stays clean. Not a standalone "GC command";
> instead, two safe ops folded into moments that already happen. Branches are NOT
> in scope, no metadata is dropped.

### The keystone: git already reports the condition (`prunable`)
**Verified by experiment (2026-06-14):** after a worktree folder is manually
deleted, `git worktree list --porcelain` STILL lists it, marked `prunable` with
reason "gitdir file points to a non-existent location". The refresh path already
fetches exactly this output every cycle (`ShadowTreeProvider.ts:197`
`listWorktrees()` → `parseWorktrees`). So the condition "folder gone but git
registration present" is **already computed by git and handed to us for free on
every refresh** — we currently just discard the `prunable` flag
(`parseWorktrees`, `list.ts:49-89`, never reads it).

> ⚠️ Correction of an earlier claim in this doc: the sidebar does **not**
> currently self-heal. Because `parseWorktrees` ignores `prunable` and there is
> no `existsSync` filter anywhere in `ShadowTreeProvider`, a manually-deleted
> worktree shows as a **ghost entry** (pointing at a non-existent path) until a
> prune runs. That's a latent bug this refinement also fixes.

### Op 1 — condition-driven prune (the better trigger)
1. Teach `parseWorktrees` to parse the `prunable` line into a flag on each clone.
2. In the refresh path, for `prunable` entries:
   - **Exclude them from the displayed list** → the ghost entry disappears (the
     behavior the user assumed already existed).
   - **If any are present, run `git.pruneWorktrees()`** → condition-driven
     reconcile, fired *exactly when git says something is prunable*. In steady
     state (nothing prunable) it runs **zero** prunes — so it's free to do this
     on the 5s poll; it is NOT a wasteful timer-prune.
3. Keep the existing prune inside `kill()` (`kill.ts:39`) and add a cheap
   defensive prune at the start of `spawn()` (belt-and-suspenders for
   re-spawning a manually-deleted branch name). Activation needs no special
   hook — the first refresh handles it.

This is the user's "run prune when the condition holds" — the condition is git's
own `prunable` flag, already in hand. It closes the "deleted while VS Code is
open" case cleanly (the next 5s refresh detects + prunes), with no extra git
calls in the common case.

### Op 2 — remove the empty `.worktrees` container
When **no non-prunable worktrees** remain under it. Safe now because metadata
lives at `<root>/.lumi/` (Phase 1), so the folder is genuinely empty. Triggers:
on `kill()` (new final step, last clone) and off the same refresh detection.
Best-effort, non-fatal.

### Why no button is correct
Every op is safe + idempotent (prune only removes git-confirmed-`prunable`
registrations; removing a *verified-empty* dir loses nothing) and rides on data
the refresh already fetches. Tidying is therefore **invisible** — never a chore
to remember. A button would frame tidying as a task; the goal is that it isn't.

### Minor consideration
`git worktree prune` removes a registration as soon as its gitdir is missing. A
worktree on a temporarily-unmounted drive could be flagged `prunable` and
de-registered. Niche for local dev; if it matters, prune with a small
`--expire` grace window. Default is fine to start.

### Why branches are out of scope (user's call, 2026-06-14)
**Deleting a worktree folder ≠ wanting to delete the branch.** The branch is the
durable work; the folder is just a checkout location. A worktree manager must
not touch branch lifecycle. Dropped the entire "orphan branch cleanup"
sub-feature.

### Why metadata reconcile is also unnecessary
`ShadowTreeProvider.getChildren` (`ShadowTreeProvider.ts:197-208`) lists clones
from `git.listWorktrees()` + `parseWorktrees()` (authoritative), then only
*enriches* each with a `metadata[dirName]` lookup. Consequences:
- Once Op 1 excludes `prunable` entries, a deleted worktree **disappears from the
  sidebar on the next refresh** (today it lingers as a ghost — see the Op 1
  correction). The list is keyed off git, not metadata.
- An orphan metadata entry (no live worktree) is **never displayed** — harmless,
  and worth **keeping**: since the branch persists and may be re-spawned, the
  retained entry restores baseBranch/description context on re-spawn.

Metadata entries are therefore removed **only on explicit `kill`** (current
behavior). Manual folder deletion leaves them (invisible + re-spawnable).

## 4. Phase 3 — deletion-tolerance hardening (release hygiene, not the user's pain)

On **macOS** (the user's platform), deleting a watched dir typically makes the
`fs.watch` go inert, not crash — so the user's symptom of a manual delete is
**stale state** (ghost sidebar entries, stale git regs), which Phase 2 fixes.
The crash matters for **Linux/Windows** users you ship to:
- Add `.on('error', () => {})` to `fs.watch` sites: `extension.ts:286/302`,
  `WorktreeManagerPanel.ts:286`, `autoCloseWatcher.ts:39`.
- Stop eager `mkdirSync(clonesDir)` (`extension.ts:283`, `WorktreeManagerPanel.ts:285`);
  arm watchers lazily (watch the parent for `.worktrees` appearing — the
  `autoCloseWatcher.ts:35-44` pattern), so a deleted+recreated folder re-arms.

## 5. Recommended sequence
1. **Phase 1** decouple metadata (keystone) + migration.
2. **Phase 2** GC/reconcile command (delivers the real ask).
3. **Phase 3** watcher hardening (before any non-macOS release).
4. Auto-clean of the empty container = a safe side-effect inside Phase 2.

## 6. Decisions — RESOLVED (2026-06-14)
1. ✅ Reframe approved: **GC/reconcile + decoupled metadata**, not auto-delete-on-kill.
2. ✅ Metadata location: **R — `<repoRoot>/.lumi/metadata.json`** (already git-excluded; zero new work).
3. ✅ Tidying: **fully automatic, NO manual button** — `git worktree prune` +
   empty-folder removal folded into `kill()`, activation, and (defensive) `spawn()`.
4. ✅ Branches: **out of scope entirely** — deleting a folder ≠ deleting a branch.
   GC = `git worktree prune` + empty-folder removal only. No branch handling, no
   metadata-dropping (sidebar reads from git, so orphan entries are invisible +
   re-spawnable).
5. ⏳ OPEN: Phase 3 watcher hardening — bundle now, or separate release-hardening pass?
6. ⏳ Per CLAUDE.md: design-only so far; **awaiting explicit go-ahead before any code.**

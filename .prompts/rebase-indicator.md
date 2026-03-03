# Feature: Rebase Indicator & One-Click Rebase

## Objective

When a clone's base branch gets new commits, automatically detect it and show a visual indicator in the Active Clones sidebar. Allow one-click rebase from the context menu.

## Background

Currently, the Active Clones view shows `⚠️ conflict` labels via `hasConflict` detection. This feature adds a similar `⟲ needs rebase` indicator when the base branch has diverged from the clone branch.

## Design Decisions

- **Event-driven**, not polling — watch `.git/refs/heads/` for ref changes, only check when a base branch actually gets new commits
- **Metadata-driven** — store `needsRebase: boolean` in `.lumi-metadata.json` so UI reads from existing data source
- **Consistent with existing patterns** — follow the same approach as `hasConflict` (metadata field → TreeView label → context menu action)

## Implementation

### 1. CLI: Add `needsRebase` detection

#### `constants.ts`
Add `needsRebase?: boolean` to the metadata type used in `.lumi-metadata.json`.

#### `utils/git.ts` — New GitUtils method
```typescript
async getCommitsAhead(baseBranch: string, targetBranch: string): Promise<number> {
  // Returns how many commits baseBranch is ahead of targetBranch
  // Uses: git rev-list --count targetBranch..baseBranch
}
```

### 2. Extension: Ref Watcher

#### `extension.ts` — Add ref watcher alongside existing metadata watcher

```typescript
// Watch .git/refs/heads/ for branch ref changes
const refsDir = path.join(rootPath, '.git', 'refs', 'heads');
const refWatcher = fs.watch(refsDir, { recursive: true }, async (_, filename) => {
  if (!filename) return;
  // 1. Read metadata to find all clones with baseBranch
  // 2. Check if the changed ref matches any clone's baseBranch
  // 3. For matching clones, run getCommitsAhead()
  // 4. Update needsRebase in metadata
  // 5. StatusEventBus.fire('*') — existing watcher handles UI refresh
});
context.subscriptions.push({ dispose: () => refWatcher.close() });
```

**Important**: Debounce the watcher (150ms, matching existing metadata watcher pattern) since multiple ref changes can fire rapidly during merge/rebase operations.

### 3. Extension: ShadowTreeProvider — Display indicator

Follow the existing `hasConflict` pattern:

- Read `needsRebase` from metadata when building tree items
- Add a label/description like `⟲ rebase` to the TreeItem
- Use a distinct icon or color (different from conflict ⚠️)

### 4. Extension: Rebase Command

#### `package.json`
Add new command:
```json
{
  "command": "lumi-ops.rebase",
  "title": "Rebase onto Base Branch"
}
```

Add to `view/item/context` menu with condition:
```json
{
  "command": "lumi-ops.rebase",
  "when": "view == lumi-ops.activeClones && viewItem == shadowClone",
  "group": "modification@2"
}
```

#### Command handler
```typescript
// 1. Read baseBranch from metadata
// 2. Execute git rebase in the clone's worktree: git -C <clonePath> rebase <baseBranch>
// 3. If success → update metadata: needsRebase = false, fire StatusEventBus
// 4. If conflict → show warning (similar to merge conflict handling)
//    Keep needsRebase = true, optionally show which files conflict
```

### 5. Metadata Schema Update

Current `.lumi-metadata.json` entry:
```json
{
  "feat/xxx": {
    "baseBranch": "main"
  }
}
```

After:
```json
{
  "feat/xxx": {
    "baseBranch": "main",
    "description": "...",
    "needsRebase": true,
    "reviewStatus": "todo"
  }
}
```

## Edge Cases

1. **Clone with no baseBranch** (spawned from existing branch) → skip, no indicator
2. **baseBranch doesn't exist locally** → skip, don't error
3. **Rebase conflicts** → show warning message, leave `needsRebase: true`, user goes into clone to resolve
4. **Multiple rapid ref changes** (e.g., merge + push) → debounce handles this
5. **fs.watch `recursive` on macOS** → works on macOS, verify on Linux if needed (refs can be in subdirectories like `refs/heads/feat/xxx`)

## Verification

Follow the `/build-and-verify` workflow to verify all packages compile correctly.

Then manual test:
1. Spawn a clone from main → `needsRebase` should be false/absent
2. Commit something to main → indicator should appear on the clone within seconds
3. Right-click → Rebase → should succeed and indicator disappears
4. Test rebase with conflict: make conflicting changes on both branches → rebase should warn about conflict
5. Verify existing conflict detection (`hasConflict`) still works independently

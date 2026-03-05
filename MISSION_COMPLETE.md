## Summary
Improved rebase conflict UX by keeping the conflict state instead of auto-aborting. When a one-click rebase encounters conflicts, the worktree now stays in the rebase-in-progress state so users can manually resolve conflicts or explicitly abort via a new "Abort Rebase" context menu action. The sidebar already shows the `🔀 rebasing` prefix for detached HEAD clones, so this change leverages that existing detection.

## Key Decisions
- **`contextValue` split**: Used `shadowClone-detached` as a separate contextValue for detached clones instead of regex matching (`=~ /shadowClone/`). This required duplicating all 6 existing menu entries for the detached variant, but is more explicit and easier to maintain.
- **Abort Rebase placement**: Put it in the `modification@3` group for detached clones (between Rebase and Kill), with Kill pushed to `modification@4`.
- **No auto-abort fallback**: Removed the try/catch `--abort` completely from the conflict path. If the rebase fails for non-conflict reasons, the error message still guides users to the Abort Rebase option.

## ⚠️ Needs Attention
- The `metadata[branch]` lookup in `rebase.ts` uses the `branch` property (not `dirName`). This is the existing behavior and works because metadata is historically keyed by branch. If/when metadata is migrated to use `dirName` as the primary key, this lookup would need updating.
- Menu duplication for `shadowClone-detached` adds ~35 lines to `package.json`. An alternative would be using `viewItem =~ /^shadowClone/` regex matching, but that's less explicit.

## Changes
| File | What | Why |
|------|------|-----|
| `packages/extension/src/commands/rebase.ts` | Removed auto-abort on conflict; added `lumi-ops.abortRebase` command | Keep conflict state for manual resolution; provide explicit abort action |
| `packages/extension/src/ShadowTreeProvider.ts` | Set `contextValue` to `shadowClone-detached` when `isDetached` is true | Enable conditional context menu items for rebasing clones |
| `packages/extension/package.json` | Registered `abortRebase` command; duplicated menu entries for detached variant; added Abort Rebase menu entry | Make abort action available via right-click; ensure detached clones keep all existing menus |
| `packages/extension/src/ShadowTreeProvider.test.ts` | Added 3 contextValue tests (normal, detached, currentBranch) | Verify correct contextValue assignment |

## Verification Evidence
```
CLI Build: ✅ (rimraf dist && tsc — success)
CLI Tests: ✅ (91 tests passed)
MCP Server Build: ✅ (tsc — success)
Extension Package: ✅ (esbuild — 264.5kb, done in 20ms)
Extension Tests: ✅ (22 tests passed, including 3 new contextValue tests)
```

## Open Questions
- Should the "Abort Rebase" menu item use a different icon/emoji than `⛔`? Current choice matches the "stop/abort" semantic.
- Should we also add a notification action button (e.g., "Abort Rebase" as an action on the warning message) for quicker access?

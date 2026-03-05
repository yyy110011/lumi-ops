## Summary
Implemented two merge flow improvements: (1) auto-exclude clone artifacts (MISSION.md, MISSION_COMPLETE.md, REVIEW_FEEDBACK.md) from squash merges so they never pollute the target branch, and (2) slimmed down the conflict response by replacing the full `sourceMission` content with `missionPath` and `reportPath` references to avoid response truncation.

## Key Decisions
- MCP server's `merge_clone` tool now calls `mergeSquash()` + exclude + `commit()` directly on GitUtils instead of going through the CLI `merge()` wrapper, allowing the exclude step to happen between squash and commit.
- CLI `merge.ts` uses `execSync` with `git reset HEAD` and `git checkout -- || rm -f` for each excluded file, matching the approach from MISSION.md.
- Used `shell: '/bin/sh'` instead of `shell: true` due to the project's `@types/node` version expecting `string | undefined` for the shell option.
- Removed the unused `merge` import from the MCP server since it now uses GitUtils directly.

## ⚠️ Needs Attention
- The exclude list is hardcoded. A future enhancement could make it configurable via `.lumi-ops.json` or extension settings, as noted in the mission spec.

## Changes
| File | What | Why |
|------|------|-----|
| `packages/mcp-server/src/index.ts` | Added `MERGE_EXCLUDE` constant, replaced `merge()` call with direct `mergeSquash` + exclude + `commit`, replaced `sourceMission` with `missionPath`/`reportPath` in conflict response, removed unused `merge` import | Auto-exclude clone artifacts and slim conflict response |
| `packages/cli/src/commands/merge.ts` | Added `MERGE_EXCLUDE` constant and exclude logic between squash and commit, added `execSync` import | Consistent artifact exclusion in CLI merge |
| `packages/cli/src/commands/merge.test.ts` | Added 2 new tests: verifies exclude calls happen between squash and commit, verifies graceful handling when excluded files don't exist | Test coverage for new exclude behavior |

## Verification Evidence
```
CLI Build: ✅ (tsc compiled successfully)
CLI Tests: ✅ (112 tests passed)
MCP Server Build: ✅ (tsc compiled successfully)
Extension Build: ✅ (esbuild packaged to dist/extension.js, 265.8kb)
```

## Open Questions
None.

---
description: Step-by-step guide to add a new CLI command to @lumi-ops/cli
---
1. Create command file: `packages/cli/src/commands/<name>.ts` with an exported async function
2. Create test file: `packages/cli/src/commands/<name>.test.ts` with Vitest tests
3. Export the command from `packages/cli/src/index.ts`
4. Register in the Commander program in `packages/cli/src/index.ts`
// turbo
5. Build CLI: `cd /Users/ryan/project_in_progress/lumi-ops/packages/cli && npm run build`
// turbo
6. Run tests: `cd /Users/ryan/project_in_progress/lumi-ops/packages/cli && npx vitest run`

---
description: Build the entire monorepo and verify no errors
---
// turbo-all
1. Build CLI: `cd /Users/ryan/project_in_progress/lumi-ops/packages/cli && npm run build`
2. Run CLI tests: `cd /Users/ryan/project_in_progress/lumi-ops/packages/cli && npx vitest run`
3. Build Extension: `cd /Users/ryan/project_in_progress/lumi-ops/packages/extension && npm run package`

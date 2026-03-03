---
description: REQUIRED for all verification — correct pnpm build order for monorepo
---
// turbo-all
1. Build CLI: `cd /Users/ryan/project_in_progress/lumi-ops/packages/cli && npm run build`
2. Run CLI tests: `cd /Users/ryan/project_in_progress/lumi-ops/packages/cli && npx vitest run`
3. Build MCP Server: `cd /Users/ryan/project_in_progress/lumi-ops/packages/mcp-server && npm run build`
4. Build Extension: `cd /Users/ryan/project_in_progress/lumi-ops/packages/extension && npm run package`

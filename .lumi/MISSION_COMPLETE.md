## Summary
Prepared `@lumi-ops/mcp-server` for npm publishing by migrating the build from `tsc` to `esbuild` (CJS bundle), completing `package.json` metadata, fixing the hardcoded version with `--define` injection, creating a comprehensive README, and expanding the CI pipeline for npm publishing alongside the existing extension publishing.

## Key Decisions
- **CJS format instead of ESM**: The CLI dependency uses CommonJS `require()` which causes `Dynamic require not supported` errors in ESM bundles. CJS matches the extension's working pattern.
- **esbuild `--define` for version**: Chose `--define:__VERSION__` over `createRequire` — simpler, no runtime filesystem access needed, works cleanly with any module format.
- **Shebang via `--banner` only**: Removed the `#!/usr/bin/env node` from `src/index.ts` since esbuild's `--banner` flag handles it. Having both produced a duplicate shebang causing ESM parse errors.
- **License is GPL-3.0-or-later**: Corrected to match the rest of the monorepo (`cli` and `extension` packages).

## ⚠️ Needs Attention
- The `@lumi-ops` npm org scope needs to be set up on npmjs.com
- A `NPM_TOKEN` GitHub secret must be added for CI publishing
- The first publish must be done manually: `cd packages/mcp-server && npm publish --access public`

## Changes
| File | What | Why |
|------|------|-----|
| `packages/mcp-server/package.json` | Migrated build to esbuild, restructured deps, added npm metadata | Enable npm publishing with bundled CLI |
| `packages/mcp-server/src/index.ts` | Replaced hardcoded version with `__VERSION__`, removed shebang | Version from package.json at build time |
| `packages/mcp-server/README.md` | Created with tool docs, install guide, config examples | Required for npm package |
| `.github/workflows/publish.yml` | Added MCP server version bump, build, npm publish steps | Automate npm publishing on tag |
| `.github/workflows/ci.yml` | Added MCP server build step | Verify MCP server builds in CI |

## Verification Evidence
```
# CLI tests: 122/122 pass
Test Files  3 passed (7)
     Tests 41 passed (122)

# MCP server build
dist/index.js  826.1kb  ⚡ Done in 43ms

# Extension build
dist/extension.js  269.0kb  ⚡ Done in 18ms

# npm pack dry-run
📦  @lumi-ops/mcp-server@0.3.9
Tarball Contents: README.md (3.0kB), dist/index.js (845.9kB), package.json (1.3kB)
package size: 166.2 kB | total files: 3

# Shebang verified
$ head -1 dist/index.js
#!/usr/bin/env node

# Execution verified
$ node dist/index.js
Lumi-Ops MCP server running on stdio
```

## Revisions
- Removed misleading "Peer dependency: zod" line from `packages/mcp-server/README.md` — `zod` is a regular `dependency` in `package.json` and installs automatically with `npm install -g`.
- Fixed license mismatch: changed `GPL-3.0-only` → `GPL-3.0-or-later` in both `package.json` and `README.md` to match `cli` and `extension` packages.

## Open Questions
1. Has the `@lumi-ops` npm org been created on npmjs.com?
2. Has the `NPM_TOKEN` GitHub secret been configured?
3. Ready to do the first manual `npm publish --access public`?

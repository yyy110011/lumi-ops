# Implement Lumi-Ops MCP Server (v1)

## Objective

Build a Model Context Protocol (MCP) server that exposes the core Lumi-Ops operations as tools, allowing AI agents in any MCP-compatible client to programmatically manage shadow clones.

**Transport**: stdio (standalone process)
**Package**: `packages/mcp-server/` (monorepo package, ESM)

## Design Decisions

- **No background agent integration** — this is purely for replacing manual UI operations (select prompt → spawn → merge → kill)
- **Pull-only merge** — agents can only merge OTHER branches INTO a specified target. This forces a natural review checkpoint: the clone agent cannot auto-merge itself back.
- **Conflict context** — when merge encounters a conflict, the tool returns the source clone's MISSION.md content and diff summary so the calling agent has enough context to resolve.
- **Metadata expansion** — spawn now stores `description` in `.lumi-metadata.json` alongside `baseBranch`.
- **New review status** — add `needs_review` to the existing `ReviewStatus` type.

## Tools

### 1. `list_prompts`
List available prompts from both global and project scope.

**Input**: `{ scope?: "global" | "project" | "all" }` (default: `"all"`)
**Output**: `{ prompts: [{ name, scope, fileName }] }`

**Implementation**: Read `.md` files from:
- Global: `~/.lumi-ops/.prompts/`
- Project: `<root>/.prompts/` (exclude `_missions/` subdirectory)

### 2. `save_prompt`
Create or overwrite a prompt file.

**Input**:
```
{
  name: string,                // prompt name (without .md)
  content: string,             // markdown content
  scope?: "global" | "project"  // default: "project"
}
```

**Logic**:
1. Sanitize name (kebab-case, strip special chars)
2. Write to `<scope-dir>/.prompts/<name>.md`
3. Return `{ fileName, scope, path }`

### 3. `spawn_clone`
Create a new shadow clone (worktree) with optional prompt content.

**Input**:
```
{
  branch: string,              // required — branch name
  description?: string,        // task description → MISSION.md
  baseBranch?: string,         // base branch (default: current branch)
  prompt?: string,             // name of prompt file to load as description
  promptScope?: "global" | "project"  // scope of the prompt file
}
```

**Logic**:
1. If `prompt` is provided, read its content and use as `description`
2. Call `spawn()` from `@lumi-ops/cli` with all options
3. **New**: Store `description` in `.lumi-metadata.json` alongside `baseBranch`
4. Return `{ branch, path, baseBranch }`

### 4. `list_clones`
List all shadow clones with their metadata.

**Input**: `{}` (no required params)
**Output**:
```
{
  clones: [{
    branch,
    path,
    isShadow,
    baseBranch?,
    description?,
    reviewStatus?,
    hasConflict?
  }]
}
```

**Implementation**: Call `list()` from CLI (or directly use `parseWorktrees` + read metadata).

### 5. `kill_clone`
Remove a shadow clone.

**Input**: `{ branch: string, keepBranch?: boolean }` (keepBranch default: false)
**Logic**: Call `kill()` from `@lumi-ops/cli`.

### 6. `merge_clone`
**Pull-only** squash merge: merge source branch INTO target branch.

**Input**:
```
{
  source: string,   // branch to merge FROM
  target: string    // branch to merge INTO (caller's own branch)
}
```

**Logic**:
1. Determine merge cwd (find existing worktree for target, or create temp worktree)
2. Call `merge()` from `@lumi-ops/cli`
3. If success → return `{ status: "merged", source, target }`
4. If conflict → return:
   ```
   {
     status: "conflict",
     source,
     target,
     conflictFiles: [...],
     sourceMission: "...",     // MISSION.md content from source clone
     sourceDiff: "..."         // git diff summary of source vs target
   }
   ```
5. Clean up temp worktree if one was created and merge succeeded

**Conflict context retrieval**:
- Read `MISSION.md` from source clone's worktree path
- If no MISSION.md, fall back to `description` from `.lumi-metadata.json`
- Run `git diff --stat target...source` to get change summary

### 7. `set_clone_status`
Update the review status of a clone.

**Input**: `{ branch: string, status: ReviewStatus }`
**Logic**: Read `.lumi-metadata.json`, update the branch entry's `reviewStatus` field, write back.

## CLI Changes Required

### `constants.ts`
```diff
-export type ReviewStatus = 'todo' | 'inProgress' | 'done' | 'wontDo';
+export type ReviewStatus = 'todo' | 'inProgress' | 'done' | 'wontDo' | 'needsReview';
```

### `spawn.ts` — Metadata expansion
When writing `.lumi-metadata.json`, also store `description`:
```diff
 metadata[branchName] = { baseBranch: resolvedBase };
+if (options.description) {
+  metadata[branchName].description = options.description;
+}
```

Update the metadata type in `list.ts` (`ShadowClone` interface) to include `description?: string`.

### `index.ts` — Exports
Ensure `merge`, `parseWorktrees`, `ShadowClone`, `ReviewStatus`, `getClonesDir`, `getRepoStorageDir`, `METADATA_FILE`, `LUMI_OPS_HOME` are all exported (they already are from `export *`).

## MCP Server Implementation

### Package Setup
```
packages/mcp-server/
├── package.json
├── tsconfig.json
└── src/
    └── index.ts       # MCP server entry point
```

**package.json**:
```json
{
  "name": "@lumi-ops/mcp-server",
  "version": "0.3.9",
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "dev": "tsc -w"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "@lumi-ops/cli": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.3.3"
  }
}
```

**tsconfig.json**: Target `ES2022`, module `NodeNext`, outDir `dist/`.

### Server Entry (`src/index.ts`)

Use `@modelcontextprotocol/sdk` to create a stdio MCP server. Register all 6 tools with Zod schemas for input validation.

**Root path detection**: Use `process.cwd()` as the repo root. The MCP client config specifies `cwd` to point at the repo.

**Important**: The MCP server imports functions from `@lumi-ops/cli` as a library — do NOT use `execSync` to call the CLI binary. Call `spawn()`, `kill()`, `merge()`, `parseWorktrees()` directly.

## User-Side Configuration

After build, add to MCP settings:
```json
"mcp": {
  "servers": {
    "lumi-ops": {
      "type": "stdio",
      "command": "node",
      "args": ["<absolute-path>/packages/mcp-server/dist/index.js"],
      "cwd": "<repo-root>"
    }
  }
}
```

## Verification Plan

Follow the `/build-and-verify` workflow to verify all packages compile correctly.

Then manual test each tool:
- `list_prompts` → should return prompts from `.prompts/`
- `save_prompt` → should create a new prompt file in the correct scope directory
- `spawn_clone` → should create worktree + MISSION.md + metadata with description
- `list_clones` → should show the spawned clone with description
- `set_clone_status` → should update metadata, visible in `list_clones`
- `merge_clone` → should squash merge successfully
- `kill_clone` → should remove worktree

## Out of Scope

- Background agent / driver integration (v0.5)
- `exec` sandbox tool (v0.6)
- SSE/HTTP transport (future)
- Automatic conflict resolution

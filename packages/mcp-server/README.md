# @lumi-ops/mcp-server

MCP (Model Context Protocol) server for the **Shadow Clone Protocol** — Git Worktree automation for AI agents.

This server exposes the full Lumi-Ops toolset over MCP stdio — 15 tools, 6 read-only resources, and 4 workflow prompt templates, enabling AI agents to spawn, manage, review, and merge shadow clones (Git Worktrees) as part of a parallelised development workflow.

## Installation

```bash
# Global install
npm install -g @lumi-ops/mcp-server

# Or run directly via npx
npx @lumi-ops/mcp-server
```

## Configuration

### Antigravity

Open **Manage MCP Servers → View raw config**, or edit `~/.gemini/antigravity/mcp_config.json`:

```json
{
  "mcpServers": {
    "lumi-ops": {
      "command": "npx",
      "args": ["-y", "@lumi-ops/mcp-server"]
    }
  }
}
```

### VS Code

Add to `.vscode/mcp.json` in your project root (requires GitHub Copilot):

```json
{
  "servers": {
    "lumi-ops": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@lumi-ops/mcp-server"]
    }
  }
}
```

### Cursor

Add to `.cursor/mcp.json` in your project root:

```json
{
  "mcpServers": {
    "lumi-ops": {
      "command": "npx",
      "args": ["-y", "@lumi-ops/mcp-server"]
    }
  }
}
```

### Windsurf

Add to `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "lumi-ops": {
      "command": "npx",
      "args": ["-y", "@lumi-ops/mcp-server"]
    }
  }
}
```

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "lumi-ops": {
      "command": "npx",
      "args": ["-y", "@lumi-ops/mcp-server"]
    }
  }
}
```

### Claude Code

```bash
claude mcp add lumi-ops -- npx -y @lumi-ops/mcp-server
```

> **Note:** The server auto-detects the Git repository root from `cwd`. If detection fails, see [Troubleshooting](#troubleshooting) below.

## Available Tools

| Tool | Description |
|------|-------------|
| `spawn_clone` | Create a new shadow clone (worktree) with optional prompt/description |
| `list_clones` | List all shadow clones with slim metadata (title, status, flags). Use `describe_clone` for full details |
| `describe_clone` | Get full details for a single clone (MISSION.md + MISSION_COMPLETE.md) |
| `kill_clone` | Remove a shadow clone and optionally delete its branch |
| `merge_clone` | Squash-merge a source branch into a target branch |
| `set_clone_status` | Update review status (`todo`, `inProgress`, `needsReview`, `done`, etc.) |
| `review_clone` | Get structured review summary: completion report, diff stats, commit list |
| `get_clone_file_diff` | Get the full diff of a specific file in a clone vs its base |
| `request_revision` | Send review feedback to a clone (writes `.lumi/REVIEW_FEEDBACK.md`) |
| `list_prompts` | List available prompt templates from global and/or project scope |
| `save_prompt` | Create or overwrite a prompt template file |
| `set_project_root` | Set the Git project root if auto-detection fails or picks the wrong repo |
| `list_repos` | List all Git repositories registered with Lumi-Ops |
| `get_clone_log` | Get recent git commit history for a clone's branch |
| `read_clone_file` | Read a file from a clone's worktree (with path traversal protection) |

### Cross-Repo Operations

All branch-targeting tools require a `repo` parameter:

- Pass **any path** inside a target repository (worktree paths are auto-resolved to the main repo root)
- Makes repo context explicit on every call — no hidden state to manage
- Makes `set_project_root` unnecessary for multi-repo workflows — just pass `repo` on each call
- Affected tools: `spawn_clone`, `list_clones`, `kill_clone`, `merge_clone`, `set_clone_status`, `review_clone`, `get_clone_file_diff`, `request_revision`, `get_clone_log`, `read_clone_file`, `list_prompts`, `save_prompt`, `describe_clone`

## Available Resources

Resources expose read-only data that agents can access without triggering side effects.

| Resource URI | Description |
|---|---|
| `lumi://clones` | Clone list with metadata, status, and completion report flags |
| `lumi://clones/{branch}/mission` | Read a clone's MISSION.md |
| `lumi://clones/{branch}/report` | Read a clone's MISSION_COMPLETE.md |
| `lumi://clones/{branch}/feedback` | Read a clone's REVIEW_FEEDBACK.md |
| `lumi://prompts/{scope}/{name}` | Read a specific prompt file (scope: `global` or `project`) |
| `lumi://config` | Server configuration: rootDir, detection method, version |

## Workflow Prompts

MCP Prompt templates that appear in your client's prompt menu, guiding agents through multi-step workflows.

| Prompt | Description |
|---|---|
| `review-and-merge` | Guide agent through review → approve/revise → merge → cleanup |
| `spawn-with-context` | Guide agent to spawn a clone from a task description |
| `multi-clone-strategy` | Guide root agent to plan and execute multi-clone parallel strategy |
| `resolve-conflict` | Guide agent through merge conflict resolution |

## How It Works

The MCP server wraps the `@lumi-ops/cli` library and exposes its functionality over **stdio** using the Model Context Protocol. AI agents connect to this server to:

1. **Spawn** isolated worktree clones for parallel feature development
2. **Track** clone status through a review lifecycle
3. **Review** diffs and completion reports
4. **Merge** finished work back via squash merge
5. **Coordinate** multi-agent workflows using prompts and status transitions
6. **Discover** context via read-only Resources — browse clone missions, reports, and prompts without side effects
7. **Follow** guided workflow Prompts for common multi-step operations (review, spawn, strategy planning)

## Troubleshooting

### Git repository not detected

The server auto-detects the Git repo root from `cwd`. If it starts in a non-git directory (e.g. remote SSH, `~`), all git operations will return an error asking you to call `set_project_root`.

**Option A — Environment variable:** Set `LUMI_OPS_ROOT` in your MCP config:

```json
{
  "mcpServers": {
    "lumi-ops": {
      "command": "npx",
      "args": ["-y", "@lumi-ops/mcp-server"],
      "env": {
        "LUMI_OPS_ROOT": "/absolute/path/to/your/project"
      }
    }
  }
}
```

**Option B — Runtime:** Call the `set_project_root` tool at any time:

```
set_project_root({ path: "/absolute/path/to/your/project" })
```

**Option C — Per-call `repo` parameter:** For multi-repo workflows, pass the `repo` parameter directly on each tool call instead of switching `set_project_root`:

```
list_clones({ repo: "/path/to/other/project" })
spawn_clone({ branch: "feat/new", repo: "/path/to/other/project" })
```

## Links

- [Lumi-Ops Repository](https://github.com/yyy110011/lumi-ops)
- [VS Code Extension](https://marketplace.visualstudio.com/items?itemName=ZunRenYao.lumi-ops)
- [Model Context Protocol](https://modelcontextprotocol.io)

## License

GPL-3.0-or-later — see [LICENSE](../../LICENSE) for details.

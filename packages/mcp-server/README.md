# @lumi-ops/mcp-server

MCP (Model Context Protocol) server for the **Shadow Clone Protocol** — Git Worktree automation for AI agents.

This server exposes the full Lumi-Ops toolset over MCP stdio, enabling AI agents to spawn, manage, review, and merge shadow clones (Git Worktrees) as part of a parallelised development workflow.

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

> **Note:** The server auto-detects the Git repository root from `cwd`. If detection fails, see [Troubleshooting](#troubleshooting) below.

## Available Tools

| Tool | Description |
|------|-------------|
| `spawn_clone` | Create a new shadow clone (worktree) with optional prompt/description |
| `list_clones` | List all shadow clones with metadata, status, and completion reports |
| `kill_clone` | Remove a shadow clone and optionally delete its branch |
| `merge_clone` | Squash-merge a source branch into a target branch |
| `set_clone_status` | Update review status (`todo`, `inProgress`, `needsReview`, `done`, etc.) |
| `review_clone` | Get structured review summary: completion report, diff stats, commit list |
| `get_clone_file_diff` | Get the full diff of a specific file in a clone vs its base |
| `request_revision` | Send review feedback to a clone (writes `.lumi/REVIEW_FEEDBACK.md`) |
| `list_prompts` | List available prompt templates from global and/or project scope |
| `save_prompt` | Create or overwrite a prompt template file |
| `set_project_root` | Set the Git project root if auto-detection fails or picks the wrong repo |

## How It Works

The MCP server wraps the `@lumi-ops/cli` library and exposes its functionality over **stdio** using the Model Context Protocol. AI agents connect to this server to:

1. **Spawn** isolated worktree clones for parallel feature development
2. **Track** clone status through a review lifecycle
3. **Review** diffs and completion reports
4. **Merge** finished work back via squash merge
5. **Coordinate** multi-agent workflows using prompts and status transitions

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

## Links

- [Lumi-Ops Repository](https://github.com/yyy110011/lumi-ops)
- [VS Code Extension](https://marketplace.visualstudio.com/items?itemName=ZunRenYao.lumi-ops)
- [Model Context Protocol](https://modelcontextprotocol.io)

## License

GPL-3.0-or-later — see [LICENSE](../../LICENSE) for details.

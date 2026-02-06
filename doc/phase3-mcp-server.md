# Phase 3: MCP Server - The Brain

## 🎯 Goal
Create a new **MCP Server package** that exposes `lumi-ops` as an MCP Tool, enabling external LLMs (like Antigravity) to programmatically spawn and control agents.

---

## 📂 Files to Create

| File | Action |
|------|--------|
| `packages/mcp-server/package.json` | **NEW** - Package configuration |
| `packages/mcp-server/tsconfig.json` | **NEW** - TypeScript config |
| `packages/mcp-server/src/index.ts` | **NEW** - MCP Server entry point |
| `packages/mcp-server/src/tools/spawn-agent.ts` | **NEW** - Spawn agent tool |
| `packages/mcp-server/src/tools/list-agents.ts` | **NEW** - List agents tool |
| `packages/mcp-server/src/tools/kill-agent.ts` | **NEW** - Kill agent tool |

---

## 📋 Technical Requirements

### 1. Initialize Package

Create `packages/mcp-server/package.json`:

```json
{
  "name": "@lumi-ops/mcp-server",
  "version": "0.1.0",
  "description": "MCP Server for Lumi-Ops Agent Orchestration",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "bin": {
    "lumi-ops-mcp": "./dist/index.js"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.0",
    "zod": "^3.22.0"
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "@types/node": "^20.0.0"
  }
}
```

### 2. Create MCP Server Entry Point

Create `packages/mcp-server/src/index.ts`:

```typescript
#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { execSync, exec } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

const server = new McpServer({
  name: 'lumi-ops',
  version: '0.1.0',
});

// Tool: spawn_agent
server.tool(
  'spawn_agent',
  'Spawn a new AI agent in an isolated Git worktree. Use background mode for autonomous agents, interactive for human-assisted work.',
  {
    branch: z.string().describe('Branch name for the worktree (e.g., "feature-auth-system")'),
    task: z.string().describe('Task description for the agent (.cursorrules content)'),
    mode: z.enum(['background', 'interactive']).describe('Execution mode: background (tmux) or interactive (VS Code)'),
    driver: z.string().optional().describe('Driver command for background mode (e.g., "gemini run", "cursor --background")'),
    root: z.string().optional().describe('Root directory of the git repository (defaults to cwd)'),
  },
  async ({ branch, task, mode, driver, root }) => {
    const workingDir = root || process.cwd();
    
    // Build CLI command
    let cmd = `lumi-ops spawn "${branch}" --root "${workingDir}" --description "${task.replace(/"/g, '\\"')}" --mode ${mode}`;
    
    if (mode === 'background') {
      if (!driver) {
        return {
          content: [{ type: 'text', text: 'Error: --driver is required for background mode' }],
          isError: true,
        };
      }
      cmd += ` --driver "${driver}"`;
    }
    
    try {
      const output = execSync(cmd, { encoding: 'utf-8', cwd: workingDir });
      
      const worktreePath = path.join(workingDir, '.shadow-clones', branch);
      const sessionName = mode === 'background' ? `lumi-${branch}` : null;
      
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            branch,
            path: worktreePath,
            mode,
            session: sessionName,
            message: output.trim(),
          }, null, 2),
        }],
      };
    } catch (error: any) {
      return {
        content: [{ type: 'text', text: `Error spawning agent: ${error.message}` }],
        isError: true,
      };
    }
  }
);

// Tool: list_agents
server.tool(
  'list_agents',
  'List all active lumi-ops agents and their current status',
  {
    root: z.string().optional().describe('Root directory of the git repository'),
  },
  async ({ root }) => {
    const workingDir = root || process.cwd();
    const shadowDir = path.join(workingDir, '.shadow-clones');
    
    const agents: any[] = [];
    
    try {
      if (!fs.existsSync(shadowDir)) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ agents: [] }, null, 2) }],
        };
      }
      
      const branches = fs.readdirSync(shadowDir);
      
      for (const branch of branches) {
        const branchPath = path.join(shadowDir, branch);
        const statusPath = path.join(branchPath, '.lumi-status.json');
        
        let status = null;
        if (fs.existsSync(statusPath)) {
          try {
            status = JSON.parse(fs.readFileSync(statusPath, 'utf-8'));
          } catch (e) {
            // Ignore parse errors
          }
        }
        
        agents.push({
          branch,
          path: branchPath,
          status: status?.status || 'unknown',
          message: status?.message || '',
          session: status?.session || null,
        });
      }
      
      return {
        content: [{ type: 'text', text: JSON.stringify({ agents }, null, 2) }],
      };
    } catch (error: any) {
      return {
        content: [{ type: 'text', text: `Error listing agents: ${error.message}` }],
        isError: true,
      };
    }
  }
);

// Tool: kill_agent
server.tool(
  'kill_agent',
  'Kill a running background agent by terminating its tmux session',
  {
    branch: z.string().describe('Branch name of the agent to kill'),
    root: z.string().optional().describe('Root directory of the git repository'),
  },
  async ({ branch, root }) => {
    const workingDir = root || process.cwd();
    const sessionName = `lumi-${branch}`;
    
    try {
      execSync(`tmux kill-session -t "${sessionName}"`, { encoding: 'utf-8' });
      
      // Update status file
      const statusPath = path.join(workingDir, '.shadow-clones', branch, '.lumi-status.json');
      if (fs.existsSync(statusPath)) {
        const status = JSON.parse(fs.readFileSync(statusPath, 'utf-8'));
        status.status = 'idle';
        status.message = 'Session terminated by MCP';
        fs.writeFileSync(statusPath, JSON.stringify(status, null, 2));
      }
      
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ success: true, session: sessionName, message: 'Agent terminated' }, null, 2),
        }],
      };
    } catch (error: any) {
      return {
        content: [{ type: 'text', text: `Error killing agent: ${error.message}` }],
        isError: true,
      };
    }
  }
);

// Tool: get_agent_status
server.tool(
  'get_agent_status',
  'Get detailed status of a specific agent',
  {
    branch: z.string().describe('Branch name of the agent'),
    root: z.string().optional().describe('Root directory of the git repository'),
  },
  async ({ branch, root }) => {
    const workingDir = root || process.cwd();
    const statusPath = path.join(workingDir, '.shadow-clones', branch, '.lumi-status.json');
    
    try {
      if (!fs.existsSync(statusPath)) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: 'No status file found', branch }, null, 2) }],
        };
      }
      
      const status = JSON.parse(fs.readFileSync(statusPath, 'utf-8'));
      
      return {
        content: [{ type: 'text', text: JSON.stringify({ branch, ...status }, null, 2) }],
      };
    } catch (error: any) {
      return {
        content: [{ type: 'text', text: `Error getting status: ${error.message}` }],
        isError: true,
      };
    }
  }
);

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Lumi-Ops MCP Server running on stdio');
}

main().catch(console.error);
```

### 3. TypeScript Configuration

Create `packages/mcp-server/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

### 4. MCP Client Configuration

To use with external LLMs, configure in their MCP settings:

```json
{
  "mcpServers": {
    "lumi-ops": {
      "command": "npx",
      "args": ["-y", "@lumi-ops/mcp-server"],
      "env": {}
    }
  }
}
```

Or for local development:

```json
{
  "mcpServers": {
    "lumi-ops": {
      "command": "node",
      "args": ["/path/to/lumi-ops/packages/mcp-server/dist/index.js"],
      "env": {}
    }
  }
}
```

---

## 🔧 Tool Reference

| Tool | Description | Required Args | Optional Args |
|------|-------------|---------------|---------------|
| `spawn_agent` | Create new agent worktree | `branch`, `task`, `mode` | `driver`, `root` |
| `list_agents` | List all agents and status | - | `root` |
| `kill_agent` | Terminate background agent | `branch` | `root` |
| `get_agent_status` | Get single agent status | `branch` | `root` |

---

## ✅ Verification Checklist

- [ ] Package builds successfully with `pnpm build`
- [ ] Server starts with `node dist/index.js`
- [ ] `spawn_agent` tool creates worktree and tmux session
- [ ] `list_agents` returns all worktrees with status
- [ ] `kill_agent` terminates tmux session
- [ ] Server works when configured in MCP client
- [ ] Error handling returns proper MCP error format

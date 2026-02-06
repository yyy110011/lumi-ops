#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { execSync } from 'child_process';
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
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text', text: `Error spawning agent: ${message}` }],
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
    
    interface AgentInfo {
      branch: string;
      path: string;
      status: string;
      message: string;
      session: string | null;
    }
    
    const agents: AgentInfo[] = [];
    
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
        
        // Skip non-directories
        if (!fs.statSync(branchPath).isDirectory()) {
          continue;
        }
        
        let status: { status?: string; message?: string; session?: string } | null = null;
        if (fs.existsSync(statusPath)) {
          try {
            status = JSON.parse(fs.readFileSync(statusPath, 'utf-8'));
          } catch {
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
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text', text: `Error listing agents: ${message}` }],
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
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text', text: `Error killing agent: ${message}` }],
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
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text', text: `Error getting status: ${message}` }],
        isError: true,
      };
    }
  }
);

// Tool: garbage_collect
server.tool(
  'garbage_collect',
  'Clean up orphaned worktrees and tmux sessions',
  {
    root: z.string().optional().describe('Root directory of the git repository'),
    dryRun: z.boolean().optional().describe('Preview cleanup without deleting'),
  },
  async ({ root, dryRun }) => {
    const workingDir = root || process.cwd();
    
    try {
      const args = dryRun ? '--dry-run' : '';
      const output = execSync(`lumi-ops gc --root "${workingDir}" ${args}`, { 
        encoding: 'utf-8',
        cwd: workingDir 
      });
      
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            output: output.trim()
          }, null, 2),
        }],
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text', text: `Error running GC: ${message}` }],
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

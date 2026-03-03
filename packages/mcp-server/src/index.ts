#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
import {
  spawn,
  kill,
  merge,
  parseWorktrees,
  GitUtils,
  getClonesDir,
  getRepoStorageDir,
  getLumiOpsHome,
  METADATA_FILE,
} from '@lumi-ops/cli';
import type { ReviewStatus, ShadowClone } from '@lumi-ops/cli';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const rootDir = process.cwd();

/**
 * Redirect console.log to stderr while executing fn.
 * CLI functions use console.log with chalk/emoji which corrupts MCP stdio JSON.
 */
async function silenceStdout<T>(fn: () => Promise<T>): Promise<T> {
  const origLog = console.log;
  console.log = console.error; // redirect to stderr
  try {
    return await fn();
  } finally {
    console.log = origLog;
  }
}

/** Read and parse .lumi-metadata.json for the current repo. */
async function readMetadata(): Promise<
  Record<string, { baseBranch?: string; description?: string; reviewStatus?: ReviewStatus }>
> {
  const metaPath = path.join(getRepoStorageDir(rootDir), METADATA_FILE);
  try {
    const raw = await fs.promises.readFile(metaPath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/** Write .lumi-metadata.json for the current repo. */
async function writeMetadata(
  metadata: Record<string, { baseBranch?: string; description?: string; reviewStatus?: ReviewStatus }>,
): Promise<void> {
  const metaPath = path.join(getRepoStorageDir(rootDir), METADATA_FILE);
  await fs.promises.writeFile(metaPath, JSON.stringify(metadata, null, 2));
}

/** List .md files in a directory, excluding subdirectories like _missions/. */
async function listPromptFiles(dir: string): Promise<string[]> {
  try {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && e.name.endsWith('.md'))
      .map((e) => e.name);
  } catch {
    return [];
  }
}

/** Sanitize a name into kebab-case for prompt filenames. */
function toKebabCase(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .toLowerCase();
}

/** Resolve the prompt directory for a given scope. */
function promptDir(scope: 'global' | 'project'): string {
  if (scope === 'global') {
    return path.join(getLumiOpsHome(), '.prompts');
  }
  return path.join(rootDir, '.prompts');
}

// ---------------------------------------------------------------------------
// Server Setup
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: 'lumi-ops',
  version: '0.3.9',
});

// ---------------------------------------------------------------------------
// Tool 1: list_prompts
// ---------------------------------------------------------------------------

server.tool(
  'list_prompts',
  'List available prompts from global and/or project scope.',
  {
    scope: z
      .enum(['global', 'project', 'all'])
      .default('all')
      .describe('Which scope to list prompts from'),
  },
  async ({ scope }) => {
    const prompts: { name: string; scope: string; fileName: string }[] = [];

    const collectFromScope = async (s: 'global' | 'project') => {
      const dir = promptDir(s);
      const files = await listPromptFiles(dir);
      for (const f of files) {
        prompts.push({ name: f.replace(/\.md$/, ''), scope: s, fileName: f });
      }
    };

    if (scope === 'all' || scope === 'global') await collectFromScope('global');
    if (scope === 'all' || scope === 'project') await collectFromScope('project');

    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ prompts }, null, 2) }],
    };
  },
);

// ---------------------------------------------------------------------------
// Tool 2: save_prompt
// ---------------------------------------------------------------------------

server.tool(
  'save_prompt',
  'Create or overwrite a prompt file.',
  {
    name: z.string().describe('Prompt name (without .md extension)'),
    content: z.string().describe('Markdown content of the prompt'),
    scope: z
      .enum(['global', 'project'])
      .default('project')
      .describe('Scope to save the prompt in'),
  },
  async ({ name, content, scope }) => {
    const sanitized = toKebabCase(name);
    if (!sanitized) {
      return {
        content: [{ type: 'text' as const, text: 'Error: invalid prompt name after sanitization.' }],
        isError: true,
      };
    }

    const dir = promptDir(scope);
    await fs.promises.mkdir(dir, { recursive: true });
    const filePath = path.join(dir, `${sanitized}.md`);
    await fs.promises.writeFile(filePath, content);

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({ fileName: `${sanitized}.md`, scope, path: filePath }, null, 2),
        },
      ],
    };
  },
);

// ---------------------------------------------------------------------------
// Tool 3: spawn_clone
// ---------------------------------------------------------------------------

server.tool(
  'spawn_clone',
  'Create a new shadow clone (worktree) with optional prompt content.',
  {
    branch: z.string().describe('Branch name for the new clone'),
    description: z.string().optional().describe('Task description → MISSION.md'),
    baseBranch: z.string().optional().describe('Base branch (default: current branch)'),
    prompt: z.string().optional().describe('Name of prompt file to load as description'),
    promptScope: z
      .enum(['global', 'project'])
      .optional()
      .describe('Scope of the prompt file'),
  },
  async ({ branch, description, baseBranch, prompt, promptScope }) => {
    try {
      let finalDescription = description;

      // If prompt is specified, load it
      if (prompt) {
        const scope = promptScope || 'project';
        const promptPath = path.join(
          promptDir(scope),
          prompt.endsWith('.md') ? prompt : `${prompt}.md`,
        );
        try {
          finalDescription = await fs.promises.readFile(promptPath, 'utf-8');
        } catch {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Error: prompt "${prompt}" not found in ${scope} scope at ${promptPath}`,
              },
            ],
            isError: true,
          };
        }
      }

      await silenceStdout(() =>
        spawn(branch, {
          root: rootDir,
          description: finalDescription,
          baseBranch,
        }),
      );

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              { branch, path: path.join(getClonesDir(rootDir), branch), baseBranch: baseBranch || 'current' },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [{ type: 'text' as const, text: `Error spawning clone: ${error.message}` }],
        isError: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Tool 4: list_clones
// ---------------------------------------------------------------------------

server.tool(
  'list_clones',
  'List all shadow clones with their metadata.',
  {},
  async () => {
    try {
      const git = new GitUtils(rootDir);
      const rawEntries = await git.listWorktrees();
      const clones = parseWorktrees(rawEntries, rootDir);
      const metadata = await readMetadata();

      // Enrich clones with metadata
      const enriched: ShadowClone[] = clones.map((c) => {
        const meta = metadata[c.branch];
        if (meta) {
          return {
            ...c,
            baseBranch: meta.baseBranch || c.baseBranch,
            description: meta.description,
            reviewStatus: meta.reviewStatus,
          };
        }
        return c;
      });

      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ clones: enriched }, null, 2) }],
      };
    } catch (error: any) {
      return {
        content: [{ type: 'text' as const, text: `Error listing clones: ${error.message}` }],
        isError: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Tool 5: kill_clone
// ---------------------------------------------------------------------------

server.tool(
  'kill_clone',
  'Remove a shadow clone.',
  {
    branch: z.string().describe('Branch name of the clone to remove'),
    keepBranch: z
      .boolean()
      .default(false)
      .describe('If true, keep the git branch after removing the worktree'),
  },
  async ({ branch, keepBranch }) => {
    try {
      await silenceStdout(() => kill(branch, { root: rootDir, keepBranch }));
      return {
        content: [
          { type: 'text' as const, text: JSON.stringify({ status: 'killed', branch, keepBranch }, null, 2) },
        ],
      };
    } catch (error: any) {
      return {
        content: [{ type: 'text' as const, text: `Error killing clone: ${error.message}` }],
        isError: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Tool 6: merge_clone
// ---------------------------------------------------------------------------

server.tool(
  'merge_clone',
  'Pull-only squash merge: merge source branch INTO target branch.',
  {
    source: z.string().describe('Branch to merge FROM'),
    target: z.string().describe('Branch to merge INTO (your own branch)'),
  },
  async ({ source, target }) => {
    try {
      const git = new GitUtils(rootDir);

      // Find worktree for target branch
      const rawEntries = await git.listWorktrees();
      const clones = parseWorktrees(rawEntries, rootDir);
      const targetClone = clones.find((c) => c.branch === target);

      let mergeCwd: string;
      let usedTempWorktree = false;

      if (targetClone) {
        mergeCwd = targetClone.path;
      } else {
        // Create a temporary worktree for the target branch
        const tempPath = path.join(getClonesDir(rootDir), `_merge-temp-${Date.now()}`);
        const targetGit = new GitUtils(rootDir);
        const branchExists = await targetGit.branchExists(target);
        if (branchExists) {
          await targetGit.addWorktreeExisting(tempPath, target);
        } else {
          return {
            content: [
              { type: 'text' as const, text: `Error: target branch "${target}" does not exist.` },
            ],
            isError: true,
          };
        }
        mergeCwd = tempPath;
        usedTempWorktree = true;
      }

      try {
        await silenceStdout(() =>
          merge(source, {
            root: rootDir,
            cwd: mergeCwd,
            commitMessage: `feat: merge ${source} into ${target} (shadow clone)`,
          }),
        );

        // Clean up temp worktree on success
        if (usedTempWorktree) {
          const cleanupGit = new GitUtils(rootDir);
          await cleanupGit.removeWorktree(mergeCwd, true);
          await cleanupGit.pruneWorktrees();
        }

        return {
          content: [
            { type: 'text' as const, text: JSON.stringify({ status: 'merged', source, target }, null, 2) },
          ],
        };
      } catch (mergeError: any) {
        if (mergeError.message === 'CONFLICT') {
          // Gather conflict context

          // Get list of conflicted files
          let conflictFiles: string[] = [];
          try {
            const statusOutput = execSync('git status --porcelain', {
              cwd: mergeCwd,
              encoding: 'utf-8',
            });
            conflictFiles = statusOutput
              .split('\n')
              .filter((line: string) => /^(UU|AA|DD|DU|UD)/.test(line))
              .map((line: string) => line.substring(3).trim());
          } catch {
            // ignore — we still have the conflict status
          }

          // Read source clone's MISSION.md or metadata description
          let sourceMission = '';
          const sourceClone = clones.find((c) => c.branch === source);
          if (sourceClone) {
            const missionPath = path.join(sourceClone.path, 'MISSION.md');
            try {
              sourceMission = await fs.promises.readFile(missionPath, 'utf-8');
            } catch {
              // Fallback to metadata description
              const metadata = await readMetadata();
              sourceMission = metadata[source]?.description || '';
            }
          }

          // Get diff stat
          let sourceDiff = '';
          try {
            sourceDiff = execSync(`git diff --stat ${target}...${source}`, {
              cwd: rootDir,
              encoding: 'utf-8',
            });
          } catch {
            // ignore
          }

          // Abort the merge in the temp worktree so it can be cleaned up
          if (usedTempWorktree) {
            try {
              execSync('git merge --abort', { cwd: mergeCwd });
              const cleanupGit = new GitUtils(rootDir);
              await cleanupGit.removeWorktree(mergeCwd, true);
              await cleanupGit.pruneWorktrees();
            } catch {
              // best-effort cleanup
            }
          }

          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(
                  { status: 'conflict', source, target, conflictFiles, sourceMission, sourceDiff },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        // Non-conflict error — clean up temp worktree
        if (usedTempWorktree) {
          try {
            const cleanupGit = new GitUtils(rootDir);
            await cleanupGit.removeWorktree(mergeCwd, true);
            await cleanupGit.pruneWorktrees();
          } catch {
            // best-effort
          }
        }

        throw mergeError;
      }
    } catch (error: any) {
      return {
        content: [{ type: 'text' as const, text: `Error merging: ${error.message}` }],
        isError: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Tool 7: set_clone_status
// ---------------------------------------------------------------------------

server.tool(
  'set_clone_status',
  'Update the review status of a clone.',
  {
    branch: z.string().describe('Branch name of the clone'),
    status: z
      .enum(['todo', 'inProgress', 'done', 'wontDo', 'needsReview'])
      .describe('New review status'),
  },
  async ({ branch, status }) => {
    try {
      const metadata = await readMetadata();
      if (!metadata[branch]) {
        metadata[branch] = {};
      }
      metadata[branch].reviewStatus = status as ReviewStatus;
      await writeMetadata(metadata);

      return {
        content: [
          { type: 'text' as const, text: JSON.stringify({ branch, reviewStatus: status }, null, 2) },
        ],
      };
    } catch (error: any) {
      return {
        content: [{ type: 'text' as const, text: `Error setting status: ${error.message}` }],
        isError: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Lumi-Ops MCP server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

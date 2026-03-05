#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import * as path from 'path';
import * as fs from 'fs';
import { execSync, execFileSync } from 'child_process';
import {
  spawn,
  kill,
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

// Files that should never be merged into target (clone-specific artifacts)
const MERGE_EXCLUDE = ['MISSION.md', 'MISSION_COMPLETE.md', 'REVIEW_FEEDBACK.md'];

/** Auto-detect git repo root. Falls back to cwd if not inside a git repo. */
function detectRootDir(): string {
  try {
    return execSync('git rev-parse --show-toplevel', { encoding: 'utf-8' }).trim();
  } catch {
    return process.cwd();
  }
}

const rootDir = detectRootDir();

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

      // Enrich clones with metadata + hasReport
      const enriched = clones.map((c) => {
        const meta = metadata[c.dirName];
        const hasReport = fs.existsSync(path.join(c.path, 'MISSION_COMPLETE.md'));
        const base: ShadowClone & { hasReport: boolean } = { ...c, hasReport };
        if (meta) {
          return {
            ...base,
            baseBranch: meta.baseBranch || c.baseBranch,
            description: meta.description,
            reviewStatus: meta.reviewStatus,
          };
        }
        return base;
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
    branch: z.string().describe('Clone identifier (directory name, e.g. feat/my-task)'),
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
      const targetClone = clones.find((c) => c.currentBranch === target);

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
        // Squash merge (stages changes, no commit yet)
        const mergeGit = new GitUtils(mergeCwd);
        await silenceStdout(() => mergeGit.mergeSquash(source));

        // Exclude clone-specific artifacts before committing
        for (const file of MERGE_EXCLUDE) {
          try {
            execSync(`git reset HEAD "${file}"`, { cwd: mergeCwd, stdio: 'ignore' });
            execSync(`git checkout -- "${file}" 2>/dev/null || rm -f "${file}"`, {
              cwd: mergeCwd,
              stdio: 'ignore',
              shell: '/bin/sh',
            });
          } catch {
            // file may not exist in the merge — fine
          }
        }

        // Commit the squash merge (without excluded files)
        await silenceStdout(() =>
          mergeGit.commit(`feat: merge ${source} into ${target} (shadow clone)`),
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

          // Provide paths to source clone's MISSION.md and MISSION_COMPLETE.md
          // (slim response — agents can read these on demand instead of including full content)
          const sourceClone = clones.find((c) => c.currentBranch === source);
          const missionPath = sourceClone ? path.join(sourceClone.path, 'MISSION.md') : null;
          const reportPath = sourceClone ? path.join(sourceClone.path, 'MISSION_COMPLETE.md') : null;

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
                  { status: 'conflict', source, target, conflictFiles, missionPath, reportPath, sourceDiff },
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
    branch: z.string().describe('Clone identifier (directory name, e.g. feat/my-task)'),
    status: z
      .enum(['todo', 'inProgress', 'done', 'wontDo', 'needsReview', 'needsRevision'])
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
// Tool 8: review_clone
// ---------------------------------------------------------------------------

/** Parse `git diff --numstat` output into structured data. */
function parseDiffStat(raw: string): {
  filesChanged: number;
  insertions: number;
  deletions: number;
  files: { path: string; insertions: number; deletions: number }[];
} {
  const lines = raw.trim().split('\n').filter(Boolean);
  const files: { path: string; insertions: number; deletions: number }[] = [];
  let totalInsertions = 0;
  let totalDeletions = 0;

  for (const line of lines) {
    // numstat format: "insertions\tdeletions\tfilepath"
    // Binary files show as: "-\t-\tpath"
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    const [ins, del, ...pathParts] = parts;
    const filePath = pathParts.join('\t'); // handle paths with tabs (rare but safe)
    if (ins === '-' || del === '-') {
      // Binary file — count it but skip numeric totals
      files.push({ path: filePath, insertions: 0, deletions: 0 });
      continue;
    }
    const insertions = parseInt(ins, 10) || 0;
    const deletions = parseInt(del, 10) || 0;
    files.push({ path: filePath, insertions, deletions });
    totalInsertions += insertions;
    totalDeletions += deletions;
  }

  return { filesChanged: files.length, insertions: totalInsertions, deletions: totalDeletions, files };
}

server.tool(
  'review_clone',
  'Get a structured review summary of a shadow clone: completion report, diff stats, and commit list.',
  {
    branch: z.string().describe('Branch name of the clone to review'),
  },
  async ({ branch }) => {
    try {
      // 1. Find the clone's worktree path
      const git = new GitUtils(rootDir);
      const rawEntries = await git.listWorktrees();
      const clones = parseWorktrees(rawEntries, rootDir);
      const clone = clones.find((c) => c.branch === branch);

      if (!clone) {
        return {
          content: [{ type: 'text' as const, text: `Error: no worktree found for branch "${branch}". The clone may have been killed.` }],
          isError: true,
        };
      }

      // 2. Read MISSION_COMPLETE.md
      let report: string | null = null;
      try {
        report = await fs.promises.readFile(path.join(clone.path, 'MISSION_COMPLETE.md'), 'utf-8');
      } catch {
        // No report — that's fine
      }

      // 3. Look up baseBranch from metadata
      const metadata = await readMetadata();
      const baseBranch = metadata[branch]?.baseBranch || 'main';

      // 4. Get diff stat
      let diffStat: ReturnType<typeof parseDiffStat> = { filesChanged: 0, insertions: 0, deletions: 0, files: [] };
      try {
        const diffStatRaw = execFileSync('git', ['diff', '--numstat', `${baseBranch}...${branch}`], {
          cwd: rootDir,
          encoding: 'utf-8',
          maxBuffer: 10 * 1024 * 1024,
        });
        diffStat = parseDiffStat(diffStatRaw);
      } catch (e: any) {
        // Could be detached HEAD or missing base branch
        diffStat = { filesChanged: 0, insertions: 0, deletions: 0, files: [] };
      }

      // Cap file list at 50
      const MAX_FILES = 50;
      let truncatedNote: string | undefined;
      if (diffStat.files.length > MAX_FILES) {
        const remaining = diffStat.files.length - MAX_FILES;
        diffStat.files = diffStat.files.slice(0, MAX_FILES);
        truncatedNote = `... and ${remaining} more files (${diffStat.filesChanged} total)`;
      }

      // 5. Get commits
      let commits: { hash: string; message: string }[] = [];
      try {
        const logRaw = execFileSync('git', ['log', '--oneline', `${baseBranch}..${branch}`], {
          cwd: rootDir,
          encoding: 'utf-8',
        });
        commits = logRaw
          .trim()
          .split('\n')
          .filter(Boolean)
          .map((line) => {
            const spaceIdx = line.indexOf(' ');
            return {
              hash: line.substring(0, spaceIdx),
              message: line.substring(spaceIdx + 1),
            };
          });
      } catch {
        // No commits or branch not found
      }

      const result: Record<string, unknown> = {
        branch,
        baseBranch,
        report,
        commits,
        diffStat: {
          ...diffStat,
          ...(truncatedNote ? { truncatedNote } : {}),
        },
      };

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (error: any) {
      return {
        content: [{ type: 'text' as const, text: `Error reviewing clone: ${error.message}` }],
        isError: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Tool 9: get_clone_file_diff
// ---------------------------------------------------------------------------

server.tool(
  'get_clone_file_diff',
  'Get the full diff of a specific file in a shadow clone compared to its base branch.',
  {
    branch: z.string().describe('Branch name of the clone'),
    filepath: z.string().describe('Relative file path to diff (from repo root)'),
  },
  async ({ branch, filepath }) => {
    try {
      // Look up baseBranch from metadata
      const metadata = await readMetadata();
      const baseBranch = metadata[branch]?.baseBranch || 'main';

      let diff: string;
      try {
        diff = execFileSync('git', ['diff', `${baseBranch}...${branch}`, '--', filepath], {
          cwd: rootDir,
          encoding: 'utf-8',
          maxBuffer: 10 * 1024 * 1024,
        });
      } catch (e: any) {
        return {
          content: [{ type: 'text' as const, text: `Error: could not diff "${filepath}" — ${e.message}` }],
          isError: true,
        };
      }

      if (!diff.trim()) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ branch, filepath, diff: null, note: 'No changes in this file between base and branch.' }, null, 2) }],
        };
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ branch, baseBranch, filepath, diff }, null, 2) }],
      };
    } catch (error: any) {
      return {
        content: [{ type: 'text' as const, text: `Error getting file diff: ${error.message}` }],
        isError: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Tool 10: request_revision
// ---------------------------------------------------------------------------

server.tool(
  'request_revision',
  'Send review feedback to a shadow clone for revision. Writes REVIEW_FEEDBACK.md and sets status to needsRevision.',
  {
    branch: z.string().describe('Branch name of the clone to send feedback to'),
    feedback: z.string().describe('Review feedback content (markdown)'),
  },
  async ({ branch, feedback }) => {
    try {
      // 1. Find the clone's worktree path
      const git = new GitUtils(rootDir);
      const rawEntries = await git.listWorktrees();
      const clones = parseWorktrees(rawEntries, rootDir);
      const clone = clones.find((c) => c.branch === branch);

      if (!clone) {
        return {
          content: [{ type: 'text' as const, text: `Error: no worktree found for branch "${branch}". The clone may have been killed.` }],
          isError: true,
        };
      }

      // 2. Write REVIEW_FEEDBACK.md
      const feedbackPath = path.join(clone.path, 'REVIEW_FEEDBACK.md');
      const feedbackContent = `# Review Feedback\n\nYou are revising your previous work. Read \`MISSION.md\` (original task) → \`MISSION_COMPLETE.md\` (what you did) → this file (what to fix).\n\n## Issues to Fix\n\n${feedback}\n\n## After fixing, update MISSION_COMPLETE.md with the new changes.\n`;
      await fs.promises.writeFile(feedbackPath, feedbackContent);

      // 3. Set reviewStatus to needsRevision
      const metadata = await readMetadata();
      if (!metadata[branch]) {
        metadata[branch] = {};
      }
      metadata[branch].reviewStatus = 'needsRevision' as ReviewStatus;
      await writeMetadata(metadata);

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              { branch, reviewStatus: 'needsRevision', feedbackPath },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [{ type: 'text' as const, text: `Error requesting revision: ${error.message}` }],
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

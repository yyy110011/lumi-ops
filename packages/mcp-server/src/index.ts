declare const __VERSION__: string;

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { RootsListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
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
  readMetadata as cliReadMetadata,
  writeMetadata as cliWriteMetadata,
  setCloneStatus,
  requestRevision,
} from '@lumi-ops/cli';
import type { ReviewStatus, ShadowClone } from '@lumi-ops/cli';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import { parseDiffStat, toKebabCase, silenceStdout, extractRootFromRootsResponse, resolveMainRepoRoot } from './utils';



/** Auto-detect git repo root from cwd. Falls back to cwd if not inside a git repo. */
function detectRootDirFromCwd(): string {
  try {
    return resolveMainRepoRoot(process.cwd());
  } catch {
    return process.cwd();
  }
}

/** Track which method was used to detect rootDir */
let rootDetectionMethod: 'roots_protocol' | 'env_var' | 'cwd' = 'cwd';

let rootDir = process.env.LUMI_OPS_ROOT || detectRootDirFromCwd();
if (process.env.LUMI_OPS_ROOT) {
  rootDetectionMethod = 'env_var';
}

/**
 * Attempt to update rootDir from an MCP roots/list response.
 * Returns true if rootDir was updated.
 */
async function updateRootFromRoots(): Promise<boolean> {
  try {
    const result = await server.server.listRoots();
    const newRoot = extractRootFromRootsResponse(result.roots);
    if (newRoot) {
      rootDir = newRoot;
      rootDetectionMethod = 'roots_protocol';
      console.error(`[lumi-ops] Root updated via: roots protocol → ${rootDir}`);
      return true;
    }
  } catch {
    // Client doesn't support roots — that's fine, fall back silently
  }
  return false;
}

/**
 * Validate that rootDir points to a valid git repository.
 * Returns an MCP error response if invalid, or null if valid.
 */
function ensureRootDir(): { content: { type: 'text'; text: string }[]; isError: true } | null {
  try {
    execSync('git rev-parse --show-toplevel', { cwd: rootDir, stdio: 'ignore' });
    return null;
  } catch {
    return {
      content: [
        {
          type: 'text' as const,
          text: `No valid git repository at '${rootDir}'. Call 'set_project_root' with your project path to connect.`,
        },
      ],
      isError: true,
    };
  }
}



/** Read metadata for the current repo (delegates to CLI). */
async function readMetadata() {
  return cliReadMetadata(rootDir);
}

/** Write metadata for the current repo (delegates to CLI). */
async function writeMetadata(
  metadata: Record<string, { baseBranch?: string; description?: string; reviewStatus?: ReviewStatus; sourcePrompt?: string }>,
) {
  return cliWriteMetadata(rootDir, metadata);
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
  version: __VERSION__,
});

// ---------------------------------------------------------------------------
// Tool 1: list_prompts
// ---------------------------------------------------------------------------

server.tool(
  'list_prompts',
  'List available prompts from global and/or project scope. Use before spawn_clone to discover reusable task prompts. Pairs with save_prompt for creating new prompts and spawn_clone\'s `prompt` param to attach one during spawn.',
  {
    scope: z
      .enum(['global', 'project', 'all'])
      .default('all')
      .describe('Which scope to list prompts from'),
  },
  async ({ scope }) => {
    const prompts: { name: string; scope: string; fileName: string; generated: boolean }[] = [];

    const collectFromScope = async (s: 'global' | 'project') => {
      const dir = promptDir(s);
      // Collect top-level prompts
      const files = await listPromptFiles(dir);
      for (const f of files) {
        prompts.push({ name: f.replace(/\.md$/, ''), scope: s, fileName: f, generated: false });
      }
      // Collect _generated/ prompts
      const genDir = path.join(dir, '_generated');
      const genFiles = await listPromptFiles(genDir);
      for (const f of genFiles) {
        prompts.push({ name: f.replace(/\.md$/, ''), scope: s, fileName: `_generated/${f}`, generated: true });
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
  'Create or overwrite a prompt file. Use to persist reusable task descriptions that can be attached to clones via spawn_clone\'s `prompt` param. Set `generated: true` for agent-authored prompts — these are saved to `_generated/` and auto-cleaned when the clone is killed.',
  {
    name: z.string().describe('Prompt name (without .md extension)'),
    content: z.string().describe('Markdown content of the prompt'),
    scope: z
      .enum(['global', 'project'])
      .default('project')
      .describe('Scope to save the prompt in'),
    generated: z
      .boolean()
      .default(false)
      .optional()
      .describe('If true, save to _generated/ subdirectory (agent-authored, auto-cleaned on kill)'),
  },
  async ({ name, content, scope, generated }) => {
    const sanitized = toKebabCase(name);
    if (!sanitized) {
      return {
        content: [{ type: 'text' as const, text: 'Error: invalid prompt name after sanitization.' }],
        isError: true,
      };
    }

    const baseDir = promptDir(scope);
    const dir = generated ? path.join(baseDir, '_generated') : baseDir;
    await fs.promises.mkdir(dir, { recursive: true });
    const filePath = path.join(dir, `${sanitized}.md`);
    await fs.promises.writeFile(filePath, content);

    const fileName = generated ? `_generated/${sanitized}.md` : `${sanitized}.md`;
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({ fileName, scope, path: filePath, generated: !!generated }, null, 2),
        },
      ],
    };
  },
);

// ---------------------------------------------------------------------------
// Tool 2b: set_project_root
// ---------------------------------------------------------------------------

server.tool(
  'set_project_root',
  'Set the Git project root directory for all lumi-ops operations. This is a recovery tool — call it when git operations fail or the server detected the wrong repository. Root is normally auto-detected via MCP Roots Protocol, LUMI_OPS_ROOT env var, or cwd.',
  {
    path: z.string().describe('Absolute path to the project root directory'),
  },
  async ({ path: newPath }) => {
    try {
      const resolved = resolveMainRepoRoot(newPath);
      rootDir = resolved;
      return {
        content: [
          { type: 'text' as const, text: JSON.stringify({ status: 'ok', rootDir: resolved }, null, 2) },
        ],
      };
    } catch {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error: '${newPath}' is not a valid git repository. Please provide a path inside a git repo.`,
          },
        ],
        isError: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Tool 3: spawn_clone
// ---------------------------------------------------------------------------

server.tool(
  'spawn_clone',
  'Create a new shadow clone (worktree) with optional prompt content. Use list_prompts first to find reusable prompts, or pass a `description` directly. After spawning, use set_clone_status to track progress through the review lifecycle.',
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
    const rootErr = ensureRootDir();
    if (rootErr) return rootErr;
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

      // Track sourcePrompt in metadata if the prompt is from _generated/
      if (prompt) {
        const promptName = prompt.endsWith('.md') ? prompt : `${prompt}.md`;
        // Determine the resolved prompt path (may include _generated/ prefix)
        const isGenerated = promptName.startsWith('_generated/');
        if (isGenerated) {
          const metadata = await readMetadata();
          if (!metadata[branch]) metadata[branch] = {};
          metadata[branch].sourcePrompt = promptName;
          await writeMetadata(metadata);
        }
      }

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
  'List all shadow clones with their metadata. Returns reviewStatus, description, and hasReport (indicates MISSION_COMPLETE.md exists, signaling review readiness). Use to find clones ready for review_clone or to check overall progress.',
  {},
  async () => {
    const rootErr = ensureRootDir();
    if (rootErr) return rootErr;
    try {
      const git = new GitUtils(rootDir);
      const rawEntries = await git.listWorktrees();
      const clones = parseWorktrees(rawEntries, rootDir);
      const metadata = await readMetadata();

      // Enrich clones with metadata + hasReport
      const enriched = clones.map((c) => {
        const meta = metadata[c.dirName];
        const hasReport = fs.existsSync(path.join(c.path, '.lumi', 'MISSION_COMPLETE.md'));
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
        content: [{ type: 'text' as const, text: JSON.stringify({ repository: rootDir, clones: enriched }, null, 2) }],
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
  'Remove a shadow clone. Use after merge_clone to clean up, or to discard abandoned work. Set `keepBranch: true` to preserve the git branch for manual recovery. Note: the branch currently checked out in the main workspace cannot be killed.',
  {
    branch: z.string().describe('Clone identifier (directory name, e.g. feat/my-task)'),
    keepBranch: z
      .boolean()
      .default(false)
      .describe('If true, keep the git branch after removing the worktree'),
  },
  async ({ branch, keepBranch }) => {
    const rootErr = ensureRootDir();
    if (rootErr) return rootErr;
    try {
      // Read metadata BEFORE kill (kill deletes the metadata entry)
      const metadata = await readMetadata();
      const meta = metadata[branch];
      const sourcePrompt = meta?.sourcePrompt;

      await silenceStdout(() => kill(branch, { root: rootDir, keepBranch }));

      // Clean up generated prompt file if tracked
      let promptCleaned = false;
      if (sourcePrompt && sourcePrompt.startsWith('_generated/')) {
        const promptPath = path.join(rootDir, '.prompts', sourcePrompt);
        try {
          await fs.promises.unlink(promptPath);
          promptCleaned = true;
        } catch {
          // Already gone — that's fine
        }
      }

      return {
        content: [
          { type: 'text' as const, text: JSON.stringify({ status: 'killed', branch, keepBranch, promptCleaned }, null, 2) },
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
  'Pull-only squash merge: merge source branch INTO target branch. Use review_clone first to inspect changes before merging. On conflict, returns conflicted file list and diff stats for resolution. Excludes .lumi/ workflow artifacts from the merge commit.',
  {
    source: z.string().describe('Branch to merge FROM'),
    target: z.string().describe('Branch to merge INTO (your own branch)'),
  },
  async ({ source, target }) => {
    const rootErr = ensureRootDir();
    if (rootErr) return rootErr;
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

        // Exclude .lumi/ directory (all workflow artifacts) before committing
        try {
          execSync('git reset HEAD .lumi/', { cwd: mergeCwd, stdio: 'ignore' });
          execSync('rm -rf .lumi/', { cwd: mergeCwd, stdio: 'ignore' });
        } catch { /* .lumi/ may not exist */ }

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
          const missionPath = sourceClone ? path.join(sourceClone.path, '.lumi', 'MISSION.md') : null;
          const reportPath = sourceClone ? path.join(sourceClone.path, '.lumi', 'MISSION_COMPLETE.md') : null;

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
  'Update the review status of a clone. Valid statuses: todo → inProgress → needsReview → done (or needsRevision → inProgress for revision cycles, wontDo to discard). Agents should set needsReview when work is complete; reviewers set done or use request_revision.',
  {
    branch: z.string().describe('Clone identifier (directory name, e.g. feat/my-task)'),
    status: z
      .enum(['todo', 'inProgress', 'done', 'wontDo', 'needsReview', 'needsRevision'])
      .describe('New review status'),
  },
  async ({ branch, status }) => {
    const rootErr = ensureRootDir();
    if (rootErr) return rootErr;
    try {
      await setCloneStatus(branch, status as ReviewStatus, { root: rootDir });

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



server.tool(
  'review_clone',
  'Get a structured review summary of a shadow clone: completion report, diff stats, and commit list. Use as the first step when reviewing work — it returns MISSION_COMPLETE.md content, changed file stats, and commit history. Follow up with get_clone_file_diff to deep-dive into specific file changes.',
  {
    branch: z.string().describe('Branch name of the clone to review'),
  },
  async ({ branch }) => {
    const rootErr = ensureRootDir();
    if (rootErr) return rootErr;
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

      // 2. Read .lumi/MISSION_COMPLETE.md
      let report: string | null = null;
      try {
        report = await fs.promises.readFile(path.join(clone.path, '.lumi', 'MISSION_COMPLETE.md'), 'utf-8');
      } catch {
        // No report — that's fine
      }

      // 3. Look up baseBranch from metadata
      const metadata = await readMetadata();
      const baseBranch = metadata[branch]?.baseBranch || 'main';

      // 4. Get diff stat
      let diffStat: ReturnType<typeof parseDiffStat> = { filesChanged: 0, insertions: 0, deletions: 0, files: [] };
      try {
        const diffStatRaw = execFileSync('git', ['diff', '--numstat', `HEAD...${branch}`], {
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
        const logRaw = execFileSync('git', ['log', '--oneline', `HEAD..${branch}`], {
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
  'Get the full diff of a specific file in a shadow clone compared to its current branch. Use after review_clone to inspect specific file changes in detail. Provide a relative file path from the repo root (as shown in review_clone\'s diffStat.files list).',
  {
    branch: z.string().describe('Branch name of the clone'),
    filepath: z.string().describe('Relative file path to diff (from repo root)'),
  },
  async ({ branch, filepath }) => {
    const rootErr = ensureRootDir();
    if (rootErr) return rootErr;
    try {
      let diff: string;
      try {
        diff = execFileSync('git', ['diff', `HEAD...${branch}`, '--', filepath], {
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
        content: [{ type: 'text' as const, text: JSON.stringify({ branch, filepath, diff }, null, 2) }],
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
  'Send review feedback to a shadow clone for revision. Writes .lumi/REVIEW_FEEDBACK.md and automatically sets status to needsRevision. Use after review_clone when changes need corrections — the clone agent will read the feedback on its next run and address the issues.',
  {
    branch: z.string().describe('Branch name of the clone to send feedback to'),
    feedback: z.string().describe('Review feedback content (markdown)'),
  },
  async ({ branch, feedback }) => {
    const rootErr = ensureRootDir();
    if (rootErr) return rootErr;
    try {
      const { feedbackPath } = await requestRevision(branch, feedback, { root: rootDir });

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
// Tool 11: list_repos
// ---------------------------------------------------------------------------

server.tool(
  'list_repos',
  'List all Git repositories registered with Lumi-Ops. Returns repo names and root paths from the global registry. Use this to discover available repositories before calling set_project_root to switch context.',
  {},
  async () => {
    try {
      const registryPath = path.join(getLumiOpsHome(), '.registry.json');
      let registry: Record<string, string> = {};
      try {
        const raw = await fs.promises.readFile(registryPath, 'utf-8');
        registry = JSON.parse(raw);
      } catch {
        // Registry doesn't exist or is invalid — return empty list
      }

      const repos = Object.entries(registry).map(([name, repoPath]) => ({
        name,
        path: repoPath,
        isCurrent: repoPath === rootDir,
      }));

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ currentRepo: rootDir, repos }, null, 2),
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [{ type: 'text' as const, text: `Error listing repos: ${error.message}` }],
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

  // Attempt to get workspace root from client via MCP roots protocol
  const clientCapabilities = server.server.getClientCapabilities();
  if (clientCapabilities?.roots) {
    const updated = await updateRootFromRoots();

    // Subscribe to dynamic root changes
    if (clientCapabilities.roots.listChanged) {
      server.server.setNotificationHandler(RootsListChangedNotificationSchema, async () => {
        await updateRootFromRoots();
      });
    }

    if (!updated) {
      console.error(`[lumi-ops] Root detected via: ${rootDetectionMethod} → ${rootDir}`);
    }
  } else {
    console.error(`[lumi-ops] Root detected via: ${rootDetectionMethod} → ${rootDir}`);
  }

  console.error('Lumi-Ops MCP server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

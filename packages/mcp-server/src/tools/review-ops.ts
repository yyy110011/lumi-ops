/**
 * Review lifecycle tools: set_clone_status, review_clone, get_clone_file_diff,
 * request_revision, get_clone_log, read_clone_file.
 * Extracted from index.ts — logic preserved exactly.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import * as path from 'path';
import * as fs from 'fs';
import { execFileSync } from 'child_process';
import {
  parseWorktrees,
  GitUtils,
  setCloneStatus,
  requestRevision,
} from '@lumi-ops/cli';
import type { ReviewStatus } from '@lumi-ops/cli';
import { parseDiffStat } from '../utils.js';
import { ensureRootDir, readMetadata, resolveEffectiveRoot } from '../state.js';

export function registerReviewOpsTools(server: McpServer): void {
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
      repo: z.string().describe(
        'Any path inside the target repository. Worktree paths are automatically resolved to the main repo root.'
      ),
    },
    { idempotentHint: true },
    async ({ branch, status, repo }) => {
      const effectiveRoot = resolveEffectiveRoot(repo);
      const rootErr = ensureRootDir(effectiveRoot);
      if (rootErr) return rootErr;
      try {
        await setCloneStatus(branch, status as ReviewStatus, { root: effectiveRoot });

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
      repo: z.string().describe(
        'Any path inside the target repository. Worktree paths are automatically resolved to the main repo root.'
      ),
    },
    { readOnlyHint: true },
    async ({ branch, repo }) => {
      const effectiveRoot = resolveEffectiveRoot(repo);
      const rootErr = ensureRootDir(effectiveRoot);
      if (rootErr) return rootErr;
      try {
        // 1. Find the clone's worktree path
        const git = new GitUtils(effectiveRoot);
        const rawEntries = await git.listWorktrees();
        const clones = parseWorktrees(rawEntries, effectiveRoot);
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
        const metadata = await readMetadata(effectiveRoot);
        const baseBranch = metadata[branch]?.baseBranch || 'main';

        // 4. Get diff stat
        let diffStat: ReturnType<typeof parseDiffStat> = { filesChanged: 0, insertions: 0, deletions: 0, files: [] };
        try {
          const diffStatRaw = execFileSync('git', ['diff', '--numstat', `HEAD...${branch}`], {
            cwd: effectiveRoot,
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
            cwd: effectiveRoot,
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
      repo: z.string().describe(
        'Any path inside the target repository. Worktree paths are automatically resolved to the main repo root.'
      ),
    },
    { readOnlyHint: true },
    async ({ branch, filepath, repo }) => {
      const effectiveRoot = resolveEffectiveRoot(repo);
      const rootErr = ensureRootDir(effectiveRoot);
      if (rootErr) return rootErr;
      try {
        let diff: string;
        try {
          diff = execFileSync('git', ['diff', `HEAD...${branch}`, '--', filepath], {
            cwd: effectiveRoot,
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
      repo: z.string().describe(
        'Any path inside the target repository. Worktree paths are automatically resolved to the main repo root.'
      ),
    },
    async ({ branch, feedback, repo }) => {
      const effectiveRoot = resolveEffectiveRoot(repo);
      const rootErr = ensureRootDir(effectiveRoot);
      if (rootErr) return rootErr;
      try {
        const { feedbackPath } = await requestRevision(branch, feedback, { root: effectiveRoot });

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
  // Tool 12: get_clone_log
  // ---------------------------------------------------------------------------

  server.tool(
    'get_clone_log',
    "Get the recent git commit history for a shadow clone's branch. Use this to understand what changes an agent has made. Pair with review_clone for a full review summary, or get_clone_file_diff for specific file changes.",
    {
      branch: z.string().describe('Branch name of the clone'),
      maxCount: z
        .number()
        .optional()
        .default(20)
        .describe('Maximum number of commits to return'),
      repo: z.string().describe(
        'Any path inside the target repository. Worktree paths are automatically resolved to the main repo root.'
      ),
    },
    { readOnlyHint: true },
    async ({ branch, maxCount, repo }) => {
      const effectiveRoot = resolveEffectiveRoot(repo);
      const rootErr = ensureRootDir(effectiveRoot);
      if (rootErr) return rootErr;
      try {
        // 1. Read metadata to get baseBranch
        const metadata = await readMetadata(effectiveRoot);
        const baseBranch = metadata[branch]?.baseBranch || 'main';

        // 2. Get formatted commit log
        let commits: { hash: string; message: string; date: string; author: string }[] = [];
        try {
          const logRaw = execFileSync(
            'git',
            ['log', `--format=%H%x00%s%x00%ai%x00%an`, `${baseBranch}..${branch}`, `-${maxCount}`],
            { cwd: effectiveRoot, encoding: 'utf-8' },
          );
          commits = logRaw
            .trim()
            .split('\n')
            .filter(Boolean)
            .map((line) => {
              const [hash, message, date, author] = line.split('\0');
              return { hash, message, date, author };
            });
        } catch {
          // No commits or branch not found — return empty
        }

        // 3. Get total commit count
        let totalCommits = 0;
        try {
          const countRaw = execFileSync(
            'git',
            ['rev-list', '--count', `${baseBranch}..${branch}`],
            { cwd: effectiveRoot, encoding: 'utf-8' },
          );
          totalCommits = parseInt(countRaw.trim(), 10) || 0;
        } catch {
          // Fallback to commits array length
          totalCommits = commits.length;
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ branch, baseBranch, commits, totalCommits }, null, 2),
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [{ type: 'text' as const, text: `Error getting clone log: ${error.message}` }],
          isError: true,
        };
      }
    },
  );

  // ---------------------------------------------------------------------------
  // Tool 13: read_clone_file
  // ---------------------------------------------------------------------------

  const MAX_FILE_SIZE = 1 * 1024 * 1024; // 1 MB

  server.tool(
    'read_clone_file',
    "Read the contents of a file from a shadow clone's worktree. Use this to inspect code, configuration, or any file in a clone without requiring filesystem access. Pair with get_clone_file_diff to see changes, or review_clone for an overview.",
    {
      branch: z.string().describe('Branch name of the clone'),
      filepath: z.string().describe('Relative file path from the worktree root'),
      repo: z.string().describe(
        'Any path inside the target repository. Worktree paths are automatically resolved to the main repo root.'
      ),
    },
    { readOnlyHint: true },
    async ({ branch, filepath, repo }) => {
      const effectiveRoot = resolveEffectiveRoot(repo);
      const rootErr = ensureRootDir(effectiveRoot);
      if (rootErr) return rootErr;
      try {
        // 1. Find the clone's worktree path
        const git = new GitUtils(effectiveRoot);
        const rawEntries = await git.listWorktrees();
        const clones = parseWorktrees(rawEntries, effectiveRoot);
        const clone = clones.find((c) => c.branch === branch);

        if (!clone) {
          return {
            content: [{ type: 'text' as const, text: `Error: no worktree found for branch "${branch}". The clone may have been killed.` }],
            isError: true,
          };
        }

        // 2. Resolve path and guard against traversal
        const resolvedPath = path.resolve(clone.path, filepath);
        if (!resolvedPath.startsWith(clone.path + path.sep) && resolvedPath !== clone.path) {
          return {
            content: [{ type: 'text' as const, text: `Error: path "${filepath}" resolves outside the clone's worktree. Path traversal is not allowed.` }],
            isError: true,
          };
        }

        // 3. Check file existence and size
        let stat: { size: number };
        try {
          stat = await fs.promises.stat(resolvedPath);
        } catch {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ branch, filepath, content: null, note: 'File not found' }, null, 2) }],
          };
        }

        if (stat.size > MAX_FILE_SIZE) {
          return {
            content: [{ type: 'text' as const, text: `Error: file is ${(stat.size / 1024 / 1024).toFixed(1)}MB, exceeding the 1MB limit. Use get_clone_file_diff for large files.` }],
            isError: true,
          };
        }

        // 4. Read the file
        const buffer = await fs.promises.readFile(resolvedPath);

        // 5. Binary detection — check first 8KB for null bytes
        const sample = buffer.subarray(0, 8192);
        if (sample.includes(0)) {
          return {
            content: [{ type: 'text' as const, text: `Error: "${filepath}" appears to be a binary file. Use get_clone_file_diff to inspect changes instead.` }],
            isError: true,
          };
        }

        const content = buffer.toString('utf-8');
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ branch, filepath, content, size: stat.size }, null, 2) }],
        };
      } catch (error: any) {
        return {
          content: [{ type: 'text' as const, text: `Error reading file: ${error.message}` }],
          isError: true,
        };
      }
    },
  );
}

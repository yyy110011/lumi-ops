/**
 * Clone lifecycle tools: spawn, list, kill, merge.
 * Extracted from index.ts — logic preserved exactly.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
import {
  spawn,
  kill,
  parseWorktrees,
  GitUtils,
  getClonesDir,
} from '@lumi-ops/cli';
import type { ShadowClone } from '@lumi-ops/cli';
import { parseDiffStat, silenceStdout, extractTitle } from '../utils.js';
import { serverState, ensureRootDir, readMetadata, writeMetadata, promptDir, resolveEffectiveRoot } from '../state.js';

export function registerCloneOpsTools(server: McpServer): void {
  // ---------------------------------------------------------------------------
  // Tool 3: spawn_clone
  // ---------------------------------------------------------------------------

  server.tool(
    'spawn_clone',
    'Create a new shadow clone (worktree) with optional prompt content. Use list_prompts first to find reusable prompts, or pass a `description` directly. After spawning, use set_clone_status to track progress through the review lifecycle.',
    {
      branch: z.string().describe('Branch name for the new clone'),
      description: z.string().optional().describe('Task description → MISSION.md'),
      parentBranch: z.string().optional().describe('Base branch (default: current branch)'),
      cloneType: z
        .enum(['task', 'integration'])
        .optional()
        .describe('Clone type: "task" (default, leaf worker) or "integration" (coordinator that spawns sub-clones)'),
      prompt: z.string().optional().describe('Name of prompt file to load as description'),
      promptScope: z
        .enum(['global', 'project'])
        .optional()
        .describe('Scope of the prompt file'),
      repo: z.string().describe(
        'Any path inside the target repository. Worktree paths are automatically resolved to the main repo root.'
      ),
    },
    async ({ branch, description, parentBranch, cloneType, prompt, promptScope, repo }) => {
      const effectiveRoot = resolveEffectiveRoot(repo);
      const rootErr = ensureRootDir(effectiveRoot);
      if (rootErr) return rootErr;
      try {
        let finalDescription = description;

        // If prompt is specified, load it
        if (prompt) {
          const scope = promptScope || 'project';
          // For project scope, resolve prompts relative to effectiveRoot
          const promptBase = scope === 'project'
            ? path.join(effectiveRoot, '.prompts')
            : promptDir('global');
          const promptPath = path.join(
            promptBase,
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
            root: effectiveRoot,
            description: finalDescription,
            baseBranch: parentBranch,
            parentBranch,
            cloneType,
          }),
        );

        // Track sourcePrompt in metadata if the prompt is from _generated/
        if (prompt) {
          const promptName = prompt.endsWith('.md') ? prompt : `${prompt}.md`;
          // Determine the resolved prompt path (may include _generated/ prefix)
          const isGenerated = promptName.startsWith('_generated/');
          if (isGenerated) {
            const metadata = await readMetadata(effectiveRoot);
            if (!metadata[branch]) metadata[branch] = {};
            metadata[branch].sourcePrompt = promptName;
            await writeMetadata(metadata, effectiveRoot);
          }
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                { branch, path: path.join(getClonesDir(effectiveRoot), branch), baseBranch: parentBranch || 'current', parentBranch: parentBranch || 'current', cloneType: cloneType || 'task' },
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
    'List all shadow clones with their metadata. Returns reviewStatus, title, and hasReport (indicates MISSION_COMPLETE.md exists, signaling review readiness). Use to find clones ready for review_clone or to check overall progress. Use describe_clone for full details on a specific clone.',
    {
      repo: z.string().describe(
        'Any path inside the target repository. Worktree paths are automatically resolved to the main repo root.'
      ),
    },
    { readOnlyHint: true },
    async ({ repo }) => {
      const effectiveRoot = resolveEffectiveRoot(repo);
      const rootErr = ensureRootDir(effectiveRoot);
      if (rootErr) return rootErr;
      try {
        const git = new GitUtils(effectiveRoot);
        const rawEntries = await git.listWorktrees();
        const clones = parseWorktrees(rawEntries, effectiveRoot);
        const metadata = await readMetadata(effectiveRoot);

        // Enrich clones with metadata + hasReport (slim: title instead of full description)
        const enriched = clones.map((c) => {
          const meta = metadata[c.dirName];
          const hasReport = fs.existsSync(path.join(c.path, '.lumi', 'MISSION_COMPLETE.md'));
          const base: ShadowClone & { hasReport: boolean; title: string } = { ...c, hasReport, title: extractTitle(meta?.description) };
          if (meta) {
            return {
              ...base,
              baseBranch: meta.baseBranch || c.baseBranch,
              parentBranch: meta.parentBranch || meta.baseBranch || c.baseBranch,
              cloneType: meta.cloneType || 'task',
              reviewStatus: meta.reviewStatus,
            };
          }
          return base;
        });

        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ repository: effectiveRoot, clones: enriched }, null, 2) }],
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
  // Tool: describe_clone
  // ---------------------------------------------------------------------------

  server.tool(
    'describe_clone',
    'Get full details for a single shadow clone, including the complete MISSION.md description and MISSION_COMPLETE.md content. Use after list_clones to drill into a specific clone.',
    {
      branch: z.string().describe('Branch name of the clone'),
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
        // 1. Find the clone's worktree
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

        // 2. Read metadata
        const metadata = await readMetadata(effectiveRoot);
        const meta = metadata[clone.dirName];
        const hasReport = fs.existsSync(path.join(clone.path, '.lumi', 'MISSION_COMPLETE.md'));

        // 3. Read MISSION_COMPLETE.md if it exists
        let missionComplete: string | null = null;
        if (hasReport) {
          try {
            missionComplete = await fs.promises.readFile(path.join(clone.path, '.lumi', 'MISSION_COMPLETE.md'), 'utf-8');
          } catch {
            // File may have been deleted between check and read
          }
        }

        // 4. Build full result
        const result: Record<string, unknown> = {
          ...clone,
          hasReport,
          title: extractTitle(meta?.description),
          description: meta?.description || null,
          baseBranch: meta?.baseBranch || clone.baseBranch,
          parentBranch: meta?.parentBranch || meta?.baseBranch || clone.baseBranch,
          cloneType: meta?.cloneType || 'task',
          reviewStatus: meta?.reviewStatus || null,
          missionComplete,
        };

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error: any) {
        return {
          content: [{ type: 'text' as const, text: `Error describing clone: ${error.message}` }],
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
      repo: z.string().describe(
        'Any path inside the target repository. Worktree paths are automatically resolved to the main repo root.'
      ),
    },
    { destructiveHint: true },
    async ({ branch, keepBranch, repo }) => {
      const effectiveRoot = resolveEffectiveRoot(repo);
      const rootErr = ensureRootDir(effectiveRoot);
      if (rootErr) return rootErr;
      try {
        // Read metadata BEFORE kill (kill deletes the metadata entry)
        const metadata = await readMetadata(effectiveRoot);
        const meta = metadata[branch];
        const sourcePrompt = meta?.sourcePrompt;

        await silenceStdout(() => kill(branch, { root: effectiveRoot, keepBranch }));

        // Clean up generated prompt file if tracked
        let promptCleaned = false;
        if (sourcePrompt && sourcePrompt.startsWith('_generated/')) {
          const promptPath = path.join(effectiveRoot, '.prompts', sourcePrompt);
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
      repo: z.string().describe(
        'Any path inside the target repository. Worktree paths are automatically resolved to the main repo root.'
      ),
    },
    async ({ source, target, repo }) => {
      const effectiveRoot = resolveEffectiveRoot(repo);
      const rootErr = ensureRootDir(effectiveRoot);
      if (rootErr) return rootErr;
      try {
        const git = new GitUtils(effectiveRoot);

        // Find worktree for target branch
        const rawEntries = await git.listWorktrees();
        const clones = parseWorktrees(rawEntries, effectiveRoot);
        const targetClone = clones.find((c) => c.currentBranch === target);

        let mergeCwd: string;
        let usedTempWorktree = false;

        if (targetClone) {
          mergeCwd = targetClone.path;
        } else {
          // Create a temporary worktree for the target branch
          const tempPath = path.join(getClonesDir(effectiveRoot), `_merge-temp-${Date.now()}`);
          const targetGit = new GitUtils(effectiveRoot);
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
            const cleanupGit = new GitUtils(effectiveRoot);
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
                cwd: effectiveRoot,
                encoding: 'utf-8',
              });
            } catch {
              // ignore
            }

            // Abort the merge in the temp worktree so it can be cleaned up
            if (usedTempWorktree) {
              try {
                execSync('git merge --abort', { cwd: mergeCwd });
                const cleanupGit = new GitUtils(effectiveRoot);
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
              const cleanupGit = new GitUtils(effectiveRoot);
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
}

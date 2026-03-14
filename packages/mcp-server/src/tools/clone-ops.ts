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
import { parseDiffStat, silenceStdout } from '../utils.js';
import { serverState, ensureRootDir, readMetadata, writeMetadata, promptDir } from '../state.js';

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
      baseBranch: z.string().optional().describe('Base branch (default: current branch)'),
      prompt: z.string().optional().describe('Name of prompt file to load as description'),
      promptScope: z
        .enum(['global', 'project'])
        .optional()
        .describe('Scope of the prompt file'),
    },
    {},
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
            root: serverState.rootDir,
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
                { branch, path: path.join(getClonesDir(serverState.rootDir), branch), baseBranch: baseBranch || 'current' },
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
    { readOnlyHint: true },
    async () => {
      const rootErr = ensureRootDir();
      if (rootErr) return rootErr;
      try {
        const git = new GitUtils(serverState.rootDir);
        const rawEntries = await git.listWorktrees();
        const clones = parseWorktrees(rawEntries, serverState.rootDir);
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
          content: [{ type: 'text' as const, text: JSON.stringify({ repository: serverState.rootDir, clones: enriched }, null, 2) }],
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
    { destructiveHint: true },
    async ({ branch, keepBranch }) => {
      const rootErr = ensureRootDir();
      if (rootErr) return rootErr;
      try {
        // Read metadata BEFORE kill (kill deletes the metadata entry)
        const metadata = await readMetadata();
        const meta = metadata[branch];
        const sourcePrompt = meta?.sourcePrompt;

        await silenceStdout(() => kill(branch, { root: serverState.rootDir, keepBranch }));

        // Clean up generated prompt file if tracked
        let promptCleaned = false;
        if (sourcePrompt && sourcePrompt.startsWith('_generated/')) {
          const promptPath = path.join(serverState.rootDir, '.prompts', sourcePrompt);
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
    {},
    async ({ source, target }) => {
      const rootErr = ensureRootDir();
      if (rootErr) return rootErr;
      try {
        const git = new GitUtils(serverState.rootDir);

        // Find worktree for target branch
        const rawEntries = await git.listWorktrees();
        const clones = parseWorktrees(rawEntries, serverState.rootDir);
        const targetClone = clones.find((c) => c.currentBranch === target);

        let mergeCwd: string;
        let usedTempWorktree = false;

        if (targetClone) {
          mergeCwd = targetClone.path;
        } else {
          // Create a temporary worktree for the target branch
          const tempPath = path.join(getClonesDir(serverState.rootDir), `_merge-temp-${Date.now()}`);
          const targetGit = new GitUtils(serverState.rootDir);
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
            const cleanupGit = new GitUtils(serverState.rootDir);
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
                cwd: serverState.rootDir,
                encoding: 'utf-8',
              });
            } catch {
              // ignore
            }

            // Abort the merge in the temp worktree so it can be cleaned up
            if (usedTempWorktree) {
              try {
                execSync('git merge --abort', { cwd: mergeCwd });
                const cleanupGit = new GitUtils(serverState.rootDir);
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
              const cleanupGit = new GitUtils(serverState.rootDir);
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

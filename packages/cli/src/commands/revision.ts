import * as path from 'path';
import * as fs from 'fs-extra';
import { GitUtils } from '../utils/git';
import { parseWorktrees } from './list';
import { setCloneStatus } from './status';

/**
 * Send review feedback to a shadow clone and set its status to needsRevision.
 *
 * Writes `.lumi/REVIEW_FEEDBACK.md` in the clone's worktree directory
 * with the standard feedback template, then updates the clone's review
 * status to `needsRevision` in the centralized metadata.
 *
 * @returns The absolute path to the written feedback file.
 * @throws If no worktree is found for the given branch.
 */
export async function requestRevision(
  branch: string,
  feedback: string,
  options?: { root?: string },
): Promise<{ feedbackPath: string }> {
  const rootDir = path.resolve(options?.root || process.cwd());

  // 1. Find the clone's worktree path
  const git = new GitUtils(rootDir);
  const rawEntries = await git.listWorktrees();
  const clones = parseWorktrees(rawEntries, rootDir);
  const clone = clones.find((c) => c.branch === branch);

  if (!clone) {
    throw new Error(
      `No worktree found for branch "${branch}". The clone may have been killed.`,
    );
  }

  // 2. Write .lumi/REVIEW_FEEDBACK.md
  const lumiDir = path.join(clone.path, '.lumi');
  await fs.ensureDir(lumiDir);
  const feedbackPath = path.join(lumiDir, 'REVIEW_FEEDBACK.md');
  const feedbackContent = `# Review Feedback\n\nYou are revising your previous work. Read \`.lumi/MISSION.md\` (original task) → \`.lumi/MISSION_COMPLETE.md\` (what you did) → this file (what to fix).\n\n## Issues to Fix\n\n${feedback}\n\n## After fixing, update .lumi/MISSION_COMPLETE.md with the new changes.\n`;
  await fs.writeFile(feedbackPath, feedbackContent);

  // 3. Set reviewStatus to needsRevision
  await setCloneStatus(branch, 'needsRevision', { root: rootDir });

  return { feedbackPath };
}

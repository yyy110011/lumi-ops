import * as path from 'path';
import { GitUtils } from '../utils/git';
import type { ReviewStatus } from '../constants';
import chalk from 'chalk';

export interface ShadowClone {
  dirName: string;        // Stable identity — derived from worktree path
  branch: string;         // Alias for currentBranch (backward compat)
  currentBranch: string;  // Actual branch checked out
  path: string;
  isShadow: boolean;
  isMain?: boolean;
  isDetached?: boolean;
  prunable?: boolean;     // git reports the worktree dir is gone (folder deleted manually)
  baseBranch?: string;
  description?: string;
  reviewStatus?: ReviewStatus;
  hasConflict?: boolean;
  needsRebase?: boolean;
}

/**
 * Derive the stable `dirName` identity from a worktree path.
 *
 * For worktrees under `.worktrees/`: extracts the relative path suffix.
 *   e.g., `/repo.worktrees/feat/my-task` → `feat/my-task`
 *
 * Fallback for paths NOT under `.worktrees/`: uses the last path segment.
 */
function deriveDirName(worktreePath: string): string {
  const marker = '.worktrees/';
  const idx = worktreePath.indexOf(marker);
  if (idx !== -1) {
    return worktreePath.substring(idx + marker.length);
  }
  // Fallback: last path segment
  const segments = worktreePath.split('/');
  return segments[segments.length - 1] || worktreePath;
}

/**
 * Parse raw `git worktree list --porcelain` entries into ShadowClone objects.
 *
 * Detection is index-based: the first entry from `git worktree list --porcelain`
 * is always the main worktree; all others are shadow clones.
 *
 * Handles detached HEAD worktrees (e.g. during rebase conflict) by deriving
 * the branch name from the last segment of the worktree path.
 */
export function parseWorktrees(rawEntries: string[], _rootDir: string): ShadowClone[] {
  const clones: ShadowClone[] = [];

  for (let i = 0; i < rawEntries.length; i++) {
    const entry = rawEntries[i];
    const lines = entry.split('\n');
    const wtLine = lines.find(l => l.startsWith('worktree '));
    const worktreePath = wtLine ? wtLine.substring('worktree '.length) : undefined;
    const branchRef = lines.find(l => l.startsWith('branch'))?.split(' ').pop();
    const isMain = i === 0;
    // git marks an entry `prunable` when its worktree dir no longer exists
    // (e.g. the user deleted the folder manually).
    const prunable = lines.some(l => l.startsWith('prunable'));

    if (worktreePath && branchRef) {
      const currentBranch = branchRef.replace('refs/heads/', '');
      const dirName = deriveDirName(worktreePath);
      clones.push({
        dirName,
        currentBranch,
        branch: currentBranch,  // backward compat alias
        path: worktreePath,
        isShadow: !isMain,
        isMain,
        prunable,
      });
    } else if (worktreePath && !branchRef) {
      // Detached HEAD (e.g. during rebase conflict) — derive branch from path
      const segments = worktreePath.split('/');
      const derivedBranch = segments[segments.length - 1] || worktreePath;
      const dirName = deriveDirName(worktreePath);
      clones.push({
        dirName,
        currentBranch: derivedBranch,
        branch: derivedBranch,  // backward compat alias
        path: worktreePath,
        isShadow: !isMain,
        isMain,
        isDetached: true,
        prunable,
      });
    }
  }

  return clones;
}

export async function list(options: { root: string; json?: boolean }) {
  const rootDir = path.resolve(options.root);
  const git = new GitUtils(rootDir);

  try {
    const worktreesRaw = await git.listWorktrees();
    const shadowClones = parseWorktrees(worktreesRaw, rootDir);

    if (options.json) {
      console.log(JSON.stringify(shadowClones, null, 2));
    } else {
      console.log(chalk.blue('📋 Active Git Worktrees:'));
      shadowClones.forEach(clone => {
        const marker = clone.isShadow ? chalk.cyan('[SHADOW]') : chalk.gray('[CORE]');
        const branchInfo = clone.currentBranch !== clone.dirName
          ? ` (on: ${clone.currentBranch})`
          : '';
        console.log(`${marker} ${chalk.bold(clone.dirName)}${branchInfo} -> ${clone.path}`);
      });
    }
  } catch (error: any) {
    console.error(chalk.red(`\n❌ Failed to list worktrees: ${error.message}`));
    process.exit(1);
  }
}

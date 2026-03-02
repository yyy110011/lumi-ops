import * as path from 'path';
import { GitUtils } from '../utils/git';
import type { ReviewStatus } from '../constants';
import chalk from 'chalk';

export interface ShadowClone {
  branch: string;
  path: string;
  isShadow: boolean;
  isMain?: boolean;
  isDetached?: boolean;
  baseBranch?: string;
  reviewStatus?: ReviewStatus;
  hasConflict?: boolean;
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
    const branch = lines.find(l => l.startsWith('branch'))?.split(' ').pop();
    const isMain = i === 0;

    if (worktreePath && branch) {
      clones.push({
        branch: branch.replace('refs/heads/', ''),
        path: worktreePath,
        isShadow: !isMain,
        isMain,
      });
    } else if (worktreePath && !branch) {
      // Detached HEAD (e.g. during rebase conflict) — derive branch from path
      const segments = worktreePath.split('/');
      const derivedBranch = segments[segments.length - 1] || worktreePath;
      clones.push({
        branch: derivedBranch,
        path: worktreePath,
        isShadow: !isMain,
        isMain,
        isDetached: true,
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
        console.log(`${marker} ${chalk.bold(clone.branch)} -> ${clone.path}`);
      });
    }
  } catch (error: any) {
    console.error(chalk.red(`\n❌ Failed to list worktrees: ${error.message}`));
    process.exit(1);
  }
}

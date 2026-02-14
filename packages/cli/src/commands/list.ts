import * as path from 'path';
import { GitUtils } from '../utils/git';
import { getClonesDir } from '../constants';
import type { ReviewStatus } from '../constants';
import chalk from 'chalk';

export interface ShadowClone {
  branch: string;
  path: string;
  isShadow: boolean;
  isDetached?: boolean;
  baseBranch?: string;
  reviewStatus?: ReviewStatus;
  hasConflict?: boolean;
}

/**
 * Parse raw `git worktree list --porcelain` entries into ShadowClone objects.
 * Handles detached HEAD worktrees (e.g. during rebase conflict) by deriving
 * the branch name from the worktree path relative to the clones directory.
 */
export function parseWorktrees(rawEntries: string[], rootDir: string): ShadowClone[] {
  const clones: ShadowClone[] = [];
  const clonesDir = getClonesDir(rootDir);

  for (const entry of rawEntries) {
    const lines = entry.split('\n');
    const wtLine = lines.find(l => l.startsWith('worktree '));
    const worktreePath = wtLine ? wtLine.substring('worktree '.length) : undefined;
    const branch = lines.find(l => l.startsWith('branch'))?.split(' ').pop();

    if (worktreePath && branch) {
      clones.push({
        branch: branch.replace('refs/heads/', ''),
        path: worktreePath,
        isShadow: worktreePath.startsWith(clonesDir),
      });
    } else if (worktreePath && !branch && worktreePath.startsWith(clonesDir)) {
      // Detached HEAD (e.g. during rebase conflict) — derive branch from path
      const relativePath = path.relative(clonesDir, worktreePath);
      if (relativePath && !relativePath.startsWith('..')) {
        clones.push({
          branch: relativePath,
          path: worktreePath,
          isShadow: true,
          isDetached: true,
        });
      }
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

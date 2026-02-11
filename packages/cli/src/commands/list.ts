import * as path from 'path';
import { GitUtils } from '../utils/git';
import { SHADOW_CLONES_DIR } from '../constants';
import type { ReviewStatus } from '../constants';
import chalk from 'chalk';

export interface ShadowClone {
  branch: string;
  path: string;
  isShadow: boolean;
  baseBranch?: string;
  reviewStatus?: ReviewStatus;
}

export async function list(options: { root: string; json?: boolean }) {
  const rootDir = path.resolve(options.root);
  const git = new GitUtils(rootDir);

  try {
    const worktreesRaw = await git.listWorktrees();
    const shadowClones: ShadowClone[] = [];

    for (const entry of worktreesRaw) {
      const lines = entry.split('\n');
      const worktreePath = lines.find(l => l.startsWith('worktree'))?.split(' ')[1];
      const branch = lines.find(l => l.startsWith('branch'))?.split(' ').pop();

      if (worktreePath && branch) {
        const isShadow = worktreePath.includes(SHADOW_CLONES_DIR);
        shadowClones.push({
          branch: branch.replace('refs/heads/', ''),
          path: worktreePath,
          isShadow
        });
      }
    }

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

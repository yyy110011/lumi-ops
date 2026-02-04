import * as path from 'path';
import { GitUtils } from '../utils/git';
import chalk from 'chalk';

export async function kill(branchName: string, options: { root: string }) {
  const rootDir = path.resolve(options.root);
  const git = new GitUtils(rootDir);
  const targetPath = path.join(rootDir, '.shadow-clones', branchName);

  try {
    console.log(chalk.yellow(`🧨 Killing shadow clone: ${branchName}...`));

    // 1. Remove worktree
    await git.removeWorktree(targetPath, true);
    console.log(chalk.gray('✓ Removed git worktree.'));

    // 2. Delete branch
    await git.deleteBranch(branchName, true);
    console.log(chalk.gray(`✓ Deleted branch: ${branchName}`));

    console.log(chalk.green(`\n✅ Shadow clone ${branchName} successfully killed.`));
  } catch (error: any) {
    console.error(chalk.red(`\n❌ Failed to kill shadow clone: ${error.message}`));
    process.exit(1);
  }
}

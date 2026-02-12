import * as path from 'path';
import { GitUtils } from '../utils/git';
import chalk from 'chalk';

export async function merge(branchName: string, options: {
  root: string;
  commitMessage?: string;
  cwd?: string; // Directory to run merge in (worktree path for target branch)
}) {
  const rootDir = options.root ? path.resolve(options.root) : process.cwd();
  // If cwd is provided, run merge there; otherwise merge in root (legacy fallback)
  const mergeDir = options.cwd ? path.resolve(options.cwd) : rootDir;
  const git = new GitUtils(mergeDir);

  const effectiveCommitMessage = options.commitMessage || `feat: merged ${branchName} (shadow clone)`;

  console.log(chalk.blue(`🔀 Merging shadow clone ${branchName} in ${mergeDir}...`));

  try {
    // 1. Execute Squash Merge
    await git.mergeSquash(branchName);
    console.log(chalk.gray('✓ Squash merge successful.'));

    // 2. Commit
    await git.commit(effectiveCommitMessage);
    console.log(chalk.green(`\n✨ Successfully merged ${branchName}!`));

  } catch (error: any) {
    const errorMsg = error.message || '';

    // 3. Handle Conflicts
    if (errorMsg.includes('CONFLICT') || errorMsg.toLowerCase().includes('conflict')) {
      console.error(chalk.yellow(`\n⚠️  Merge Conflict detected.`));
      throw new Error('CONFLICT');
    }

    // General failure
    console.error(chalk.red(`\n❌ Failed to merge: ${errorMsg}`));
    throw error;
  }
}

import * as path from 'path';
import { GitUtils } from '../utils/git';
import chalk from 'chalk';

export async function merge(branchName: string, options: { root: string }) {
  // 1. Initialize Git at Root (Essential for correct worktree operations)
  // We use options.root or process.cwd() as a fallback, but the extension usually passes options.root.
  const rootDir = options.root ? path.resolve(options.root) : process.cwd();
  
  const git = new GitUtils(rootDir);

  console.log(chalk.blue(`🔀 Merging shadow clone ${branchName} into current branch...`));

  try {
    // 2. Execute Squash Merge
    // This merges the changes from the shadow clone branch into the *current* active branch of the main repo.
    // We assume the user has the correct destination branch checked out (e.g., main).
    await git.mergeSquash(branchName);
    console.log(chalk.gray('✓ Squash merge successful.'));

    // 3. Commit
    const commitMsg = `feat: merged ${branchName} (shadow clone)`;
    await git.commit(commitMsg);
    
    console.log(chalk.green(`\n✨ Successfully merged ${branchName}! `));

  } catch (error: any) {
    const errorMsg = error.message || '';
    
    // 4. Handle Conflicts 
    // If it's a conflict, we throw a specific error so the UI can prompt the user.
    if (errorMsg.includes('CONFLICT') || errorMsg.toLowerCase().includes('conflict')) {
       console.error(chalk.yellow(`\n⚠️  Merge Conflict detected.`));
       // We DO NOT abort. We let the user resolve it in VS Code Source Control view.
       throw new Error('CONFLICT'); 
    }

    // General failure
    console.error(chalk.red(`\n❌ Failed to merge: ${errorMsg}`));
    throw error;
  }
}

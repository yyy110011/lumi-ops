import * as path from 'path';
import * as fs from 'fs-extra';
import { GitUtils } from '../utils/git';
import { getClonesDir, getRepoStorageDir, METADATA_FILE } from '../constants';
import chalk from 'chalk';

export async function kill(branchName: string, options: { root: string; keepBranch?: boolean; worktreePath?: string }) {
  const rootDir = path.resolve(options.root);
  const git = new GitUtils(rootDir);
  const targetPath = options.worktreePath || path.join(getClonesDir(rootDir), branchName);

  try {
    console.log(chalk.yellow(`🧨 Killing shadow clone: ${branchName}...`));

    // 1. Remove worktree
    await git.removeWorktree(targetPath, true);
    await git.pruneWorktrees();
    console.log(chalk.gray('✓ Removed git worktree.'));

    // 2. Delete branch (unless keepBranch is set)
    if (!options.keepBranch) {
      await git.deleteBranch(branchName, true);
      console.log(chalk.gray(`✓ Deleted branch: ${branchName}`));
    } else {
      console.log(chalk.gray(`✓ Branch "${branchName}" preserved.`));
    }

    // 3. Remove entry from centralized metadata
    const metadataPath = path.join(getRepoStorageDir(rootDir), METADATA_FILE);
    try {
      const metadata = await fs.readJSON(metadataPath);
      if (metadata[branchName]) {
        delete metadata[branchName];
        await fs.writeJSON(metadataPath, metadata, { spaces: 2 });
        console.log(chalk.gray('✓ Cleaned up metadata.'));
      }
    } catch {
      // No metadata file — nothing to clean
    }

    console.log(chalk.green(`\n✅ Shadow clone ${branchName} successfully killed.`));
  } catch (error: any) {
    console.error(chalk.red(`\n❌ Failed to kill shadow clone: ${error.message}`));
    throw error;
  }
}

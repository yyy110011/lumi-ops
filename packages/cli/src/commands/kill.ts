import * as path from 'path';
import * as fs from 'fs-extra';
import { GitUtils } from '../utils/git';
import { getClonesDir, getRepoStorageDir, METADATA_FILE } from '../constants';
import chalk from 'chalk';
import { execSync } from 'child_process';

export async function kill(identifier: string, options: { root: string; keepBranch?: boolean; worktreePath?: string }) {
  const rootDir = path.resolve(options.root);
  const git = new GitUtils(rootDir);
  const targetPath = options.worktreePath || path.join(getClonesDir(rootDir), identifier);

  try {
    console.log(chalk.yellow(`🧨 Killing shadow clone: ${identifier}...`));

    // 1. Read the actual current branch before removing the worktree
    let actualBranch: string | undefined;
    try {
      actualBranch = execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: targetPath,
        encoding: 'utf-8',
      }).trim();
      if (actualBranch === 'HEAD') {
        actualBranch = undefined; // Detached HEAD
      }
    } catch {
      // Worktree may already be gone or inaccessible
    }

    // 2. Remove worktree
    await git.removeWorktree(targetPath, true);
    await git.pruneWorktrees();
    console.log(chalk.gray('✓ Removed git worktree.'));

    // 2b. Clean up residual clone directory (e.g. extension re-created files after kill)
    if (await fs.pathExists(targetPath)) {
      await fs.remove(targetPath);
      console.log(chalk.gray('✓ Cleaned up residual clone directory.'));
    }

    // 2c. Clean up empty parent directories left by nested branch names (e.g. feat/xxx)
    const clonesDir = getClonesDir(rootDir);
    let parentDir = path.dirname(targetPath);
    while (parentDir !== clonesDir && parentDir.startsWith(clonesDir)) {
      try {
        const entries = await fs.readdir(parentDir, { withFileTypes: true });
        const hasSubdirs = entries.some((e: { isDirectory: () => boolean }) => e.isDirectory());
        if (!hasSubdirs) {
          await fs.remove(parentDir);
          parentDir = path.dirname(parentDir);
        } else {
          break; // Parent still has child directories (other clones), stop climbing
        }
      } catch {
        break; // Directory doesn't exist or not accessible, stop
      }
    }

    // 3. Delete branch (unless keepBranch is set)
    if (!options.keepBranch) {
      // Delete the actual current branch
      if (actualBranch) {
        try {
          await git.deleteBranch(actualBranch, true);
          console.log(chalk.gray(`✓ Deleted branch: ${actualBranch}`));
        } catch {
          // Branch may already be gone
        }
      }
      // Also attempt to delete the identifier-named branch if different
      if (identifier !== actualBranch) {
        try {
          await git.deleteBranch(identifier, true);
          console.log(chalk.gray(`✓ Deleted branch: ${identifier}`));
        } catch {
          // Identifier branch may not exist (e.g. branch was renamed)
        }
      }
    } else {
      console.log(chalk.gray(`✓ Branch(es) preserved.`));
    }

    // 4. Clean up generated prompt + remove entry from centralized metadata
    const metadataPath = path.join(getRepoStorageDir(rootDir), METADATA_FILE);
    try {
      const metadata = await fs.readJSON(metadataPath);
      if (metadata[identifier]) {
        // Delete generated prompt file if tracked
        const sourcePrompt = metadata[identifier].sourcePrompt;
        if (sourcePrompt && sourcePrompt.startsWith('_generated/')) {
          const promptPath = path.join(rootDir, '.prompts', sourcePrompt);
          try {
            fs.unlinkSync(promptPath);
            console.log(chalk.gray(`✓ Deleted generated prompt: ${sourcePrompt}`));
          } catch {
            // Already gone — that's fine
          }
        }
        delete metadata[identifier];
        await fs.writeJSON(metadataPath, metadata, { spaces: 2 });
        console.log(chalk.gray('✓ Cleaned up metadata.'));
      }
    } catch {
      // No metadata file — nothing to clean
    }

    console.log(chalk.green(`\n✅ Shadow clone ${identifier} successfully killed.`));
  } catch (error: any) {
    console.error(chalk.red(`\n❌ Failed to kill shadow clone: ${error.message}`));
    throw error;
  }
}


import * as path from 'path';
import { execSync } from 'child_process';
import { GitUtils } from '../utils/git';
import chalk from 'chalk';

/**
 * Detect an in-progress merge conflict structurally via git's unmerged-paths
 * listing. Parsing the human-readable error for "CONFLICT" breaks on
 * non-English locales (git localizes its messages), which silently downgraded
 * real conflicts to generic failures — and broke the MCP merge_clone flow
 * that relies on the thrown 'CONFLICT' marker to return conflict context.
 * Returns null when the check itself can't run; callers then fall back to the
 * message heuristic.
 */
function hasUnmergedPaths(cwd: string): boolean | null {
  try {
    const output = execSync('git diff --name-only --diff-filter=U', { cwd, encoding: 'utf-8' });
    return (output || '').trim().length > 0;
  } catch {
    return null;
  }
}

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

    // 2. Exclude .lumi/ directory (all workflow artifacts) before committing
    try {
      execSync('git reset HEAD .lumi/', { cwd: mergeDir, stdio: 'ignore' });
      execSync('rm -rf .lumi/', { cwd: mergeDir, stdio: 'ignore' });
    } catch { /* .lumi/ may not exist */ }

    // 3. Commit
    await git.commit(effectiveCommitMessage);
    console.log(chalk.green(`\n✨ Successfully merged ${branchName}!`));

  } catch (error: any) {
    const errorMsg = error.message || '';

    // Handle Conflicts — ask git for unmerged paths (locale-independent);
    // the message heuristic is only a fallback when that check can't run.
    const unmerged = hasUnmergedPaths(mergeDir);
    const isConflict = unmerged !== null
      ? unmerged
      : (errorMsg.includes('CONFLICT') || errorMsg.toLowerCase().includes('conflict'));
    if (isConflict) {
      console.error(chalk.yellow(`\n⚠️  Merge Conflict detected.`));
      throw new Error('CONFLICT');
    }

    // General failure
    console.error(chalk.red(`\n❌ Failed to merge: ${errorMsg}`));
    throw error;
  }
}

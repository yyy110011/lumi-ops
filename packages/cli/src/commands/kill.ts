import * as path from 'path';
import * as fs from 'fs-extra';
import { GitUtils } from '../utils/git';
import { getClonesDir, getRepoStorageDir, METADATA_FILE, SHADOW_CLONES_DIR } from '../constants';
import { migrateMetadataToLumiDir } from './migration';
import chalk from 'chalk';
import { execSync } from 'child_process';

/**
 * Resolve which known clones container a worktree path lives in — the current
 * `<repo>.worktrees` sibling or the legacy `<repo>/.shadow-clones` — so the
 * post-kill cleanup can climb and self-tidy within the right boundary.
 * Returns null for a path outside both: no known boundary means no cleanup.
 */
function resolveCleanupContainer(rootDir: string, targetPath: string): string | null {
  const candidates = [
    getClonesDir(rootDir),
    path.join(path.resolve(rootDir), SHADOW_CLONES_DIR),
  ];
  const resolved = path.resolve(targetPath);
  return candidates.find((dir) => resolved.startsWith(dir + path.sep)) ?? null;
}

export async function kill(identifier: string, options: { root: string; keepBranch?: boolean; worktreePath?: string }) {
  const rootDir = path.resolve(options.root);
  const git = new GitUtils(rootDir);
  const targetPath = options.worktreePath || path.join(getClonesDir(rootDir), identifier);

  try {
    console.log(chalk.yellow(`🧨 Killing shadow clone: ${identifier}...`));

    // 0. Move durable metadata out of the transient container before the
    //    cleanup below can remove the folder it may still live in (a pure-CLI
    //    user can reach kill without ever hitting the spawn/extension/MCP
    //    migration chokepoints). Idempotent, best-effort.
    await migrateMetadataToLumiDir(rootDir);

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
    try {
      await git.removeWorktree(targetPath, true);
      console.log(chalk.gray('✓ Removed git worktree.'));
    } catch {
      // Worktree directory may already be gone (manually deleted) —
      // fall back to prune to clean up stale git internal references.
      console.log(chalk.gray('⚠ Worktree directory not found, pruning stale reference...'));
    }
    await git.pruneWorktrees();

    // 2b. Clean up residual clone directory (e.g. extension re-created files after kill)
    if (await fs.pathExists(targetPath)) {
      await fs.remove(targetPath);
      console.log(chalk.gray('✓ Cleaned up residual clone directory.'));
    }

    // 2c. Clean up empty parent directories left by nested branch names (e.g. feat/xxx).
    //     The climb is bounded by whichever known container the target lives in —
    //     the current .worktrees or the legacy .shadow-clones. A custom path
    //     outside both has no safe boundary: no climb, no container removal.
    const containerDir = resolveCleanupContainer(rootDir, targetPath);
    if (containerDir) {
      let parentDir = path.dirname(targetPath);
      while (parentDir.startsWith(containerDir + path.sep)) {
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
    }

    // 2d. Remove the empty container itself when no worktrees remain.
    //     .worktrees is safe to drop with stray files inside (metadata lives in
    //     <root>/.lumi/, so files like .DS_Store go with the folder). The legacy
    //     .shadow-clones may still hold an unmigrated .lumi-metadata.json, so it
    //     is only removed when nothing but .DS_Store remains. Best-effort.
    if (containerDir) {
      const isLegacyContainer = containerDir !== getClonesDir(rootDir);
      try {
        const entries = await fs.readdir(containerDir, { withFileTypes: true });
        const hasSubdirs = entries.some((e: { isDirectory: () => boolean }) => e.isDirectory());
        const hasBlockingFiles = isLegacyContainer &&
          entries.some((e: { name: string; isDirectory: () => boolean }) => !e.isDirectory() && e.name !== '.DS_Store');
        if (!hasSubdirs && !hasBlockingFiles) {
          await fs.remove(containerDir);
          console.log(chalk.gray(`✓ Removed empty ${isLegacyContainer ? SHADOW_CLONES_DIR : '.worktrees'} container.`));
        }
      } catch {
        // Container already gone or unreadable — nothing to do
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


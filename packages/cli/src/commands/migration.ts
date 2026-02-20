import * as path from 'path';
import * as fs from 'fs-extra';
import { exec } from 'child_process';
import { promisify } from 'util';
import { SHADOW_CLONES_DIR, METADATA_FILE, getClonesDir, getRepoStorageDir, initRepoStorageDir } from '../constants';

const execAsync = promisify(exec);
import chalk from 'chalk';

/**
 * Result of a single worktree migration attempt.
 */
interface MigrationResult {
  branch: string;
  success: boolean;
  error?: string;
}

/**
 * Check whether the legacy `.shadow-clones/` directory exists in the repo.
 */
export function hasLegacyClones(rootDir: string): boolean {
  return fs.existsSync(path.join(rootDir, SHADOW_CLONES_DIR));
}

/**
 * Migrate all worktrees from the legacy `.shadow-clones/` directory
 * to the new external storage at `<repoRoot>.worktrees/`.
 *
 * For each worktree found:
 *   1. Move the worktree directory to the new location
 *   2. Update `.git/worktrees/<name>/gitdir` in the main repo to point to the new path
 *
 * The worktree-side `.git` file (which points back to the main repo) does NOT
 * need updating because the main repo hasn't moved.
 */
export async function migrateLegacyClones(rootDir: string, options: { dryRun?: boolean } = {}): Promise<MigrationResult[]> {
  const legacyDir = path.join(rootDir, SHADOW_CLONES_DIR);
  const newClonesDir = getClonesDir(rootDir);
  const results: MigrationResult[] = [];

  if (!fs.existsSync(legacyDir)) {
    return results;
  }

  // Discover worktree branches by reading their .git files
  const entries = await discoverWorktrees(legacyDir);

  if (entries.length === 0) {
    console.log(chalk.gray('No worktrees found in legacy directory.'));
    return results;
  }

  console.log(chalk.blue(`📦 Found ${entries.length} legacy worktree(s) to migrate.\n`));

  if (!options.dryRun) {
    await initRepoStorageDir(rootDir);
    await fs.ensureDir(newClonesDir);
  }

  for (const { branch, oldPath, gitWorktreeName } of entries) {
    const newPath = path.join(newClonesDir, branch);

    if (options.dryRun) {
      console.log(chalk.gray(`  [dry-run] ${branch}: ${oldPath} → ${newPath}`));
      results.push({ branch, success: true });
      continue;
    }

    try {
      if (await fs.pathExists(newPath)) {
        console.log(chalk.yellow(`  ⚠ ${branch}: Target already exists, skipping move.`));
        results.push({ branch, success: false, error: 'Target exists' });
        continue;
      }

      // 1. Copy the worktree directory
      await fs.ensureDir(path.dirname(newPath));
      await fs.copy(oldPath, newPath, { overwrite: false });

      // 2. Update .git/worktrees/<name>/gitdir to point to the new location
      const gitdirFile = path.join(rootDir, '.git', 'worktrees', gitWorktreeName, 'gitdir');
      if (fs.existsSync(gitdirFile)) {
        await fs.writeFile(gitdirFile, path.join(newPath, '.git') + '\n');
      }

      // 3. Verify git considers the new location a valid worktree
      try {
        await execAsync(`git -C "${newPath}" rev-parse --git-dir`);
      } catch (verifyErr: any) {
        // Rollback on failure
        await fs.remove(newPath);
        throw new Error(`Git verification failed after copy: ${verifyErr.message}`);
      }

      // 4. Update path references inside MISSION.md
      const missionFile = path.join(newPath, 'MISSION.md');
      if (fs.existsSync(missionFile)) {
        let content = await fs.readFile(missionFile, 'utf-8');
        content = content.replace(new RegExp(oldPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), newPath);
        await fs.writeFile(missionFile, content);
      }

      // 5. Verification passed, safely remove original oldPath
      await fs.remove(oldPath);

      console.log(chalk.green(`  ✓ ${branch}`));
      results.push({ branch, success: true });
    } catch (err: any) {
      console.log(chalk.red(`  ✗ ${branch}: ${err.message}`));
      results.push({ branch, success: false, error: err.message });
    }
  }

  // 3. Migrate centralized metadata file
  const legacyMetadata = path.join(legacyDir, METADATA_FILE);
  if (fs.existsSync(legacyMetadata) && !options.dryRun) {
    const newMetadataPath = path.join(getRepoStorageDir(rootDir), METADATA_FILE);
    try {
      // Merge: if new metadata already exists, merge old into new
      let merged: Record<string, any> = {};
      try { merged = await fs.readJSON(newMetadataPath); } catch {}
      const legacy = await fs.readJSON(legacyMetadata);
      merged = { ...legacy, ...merged }; // new takes precedence
      await fs.writeJSON(newMetadataPath, merged, { spaces: 2 });
      await fs.remove(legacyMetadata);
      console.log(chalk.green('  ✓ Migrated metadata'));
    } catch (err: any) {
      console.log(chalk.red(`  ✗ Metadata migration failed: ${err.message}`));
    }
  }

  // 4. Move .prompts and remove legacy directory
  if (!options.dryRun) {
    try {
      const legacyPrompts = path.join(legacyDir, '.prompts');
      if (fs.existsSync(legacyPrompts)) {
        const newPrompts = path.join(getRepoStorageDir(rootDir), '.prompts');
        await fs.move(legacyPrompts, newPrompts, { overwrite: false });
        console.log(chalk.green('  ✓ Migrated prompt templates'));
      }
      await fs.remove(legacyDir);
      console.log(chalk.green('\n✓ Removed legacy .shadow-clones/ directory.'));
    } catch {
      // Best-effort cleanup
    }
  }

  return results;
}

/**
 * Walk the legacy directory to find worktree entries.
 * A valid worktree has a `.git` file (not directory) containing `gitdir: ...`.
 * Supports nested branch names like `feat/my-feature`.
 */
async function discoverWorktrees(
  legacyDir: string,
  relativePrefix = '',
): Promise<{ branch: string; oldPath: string; gitWorktreeName: string }[]> {
  const results: { branch: string; oldPath: string; gitWorktreeName: string }[] = [];
  const entries = await fs.readdir(legacyDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;

    const fullPath = path.join(legacyDir, entry.name);
    const dotGitPath = path.join(fullPath, '.git');
    const branch = relativePrefix ? `${relativePrefix}/${entry.name}` : entry.name;

    if (fs.existsSync(dotGitPath) && fs.statSync(dotGitPath).isFile()) {
      // This is a worktree — read .git file to find the worktree name in .git/worktrees/
      const content = await fs.readFile(dotGitPath, 'utf-8');
      const match = content.match(/gitdir:\s*(.+)/);
      if (match) {
        // e.g. "gitdir: /repo/.git/worktrees/develop" → worktree name is "develop"
        const worktreesPath = match[1].trim();
        const gitWorktreeName = path.basename(worktreesPath);
        results.push({ branch, oldPath: fullPath, gitWorktreeName });
      }
    } else {
      // Not a worktree itself — recurse for nested branch names (e.g. feat/)
      const nested = await discoverWorktrees(fullPath, branch);
      results.push(...nested);
    }
  }

  return results;
}

import * as path from 'path';
import * as os from 'os';

/**
 * Name of the legacy directory used for shadow clone worktrees (inside repo).
 * Kept for backwards-compatibility detection and migration warnings.
 */
export const SHADOW_CLONES_DIR = '.shadow-clones';

/**
 * Name of the centralized metadata file.
 */
export const METADATA_FILE = '.lumi-metadata.json';

/**
 * Review status for a shadow clone branch (user-assigned).
 */
export type ReviewStatus = 'todo' | 'inProgress' | 'done' | 'wontDo';

export const REPO_ID_FILE = 'lumi-ops-id';

/**
 * Root directory for all lumi-ops data in the user's home directory.
 */
export const LUMI_OPS_HOME = path.join(os.homedir(), '.lumi-ops');


/**
 * Get the per-repo storage directory.
 * Structure: ~/.lumi-ops/<repo-name>-<hash>/
 * 
 * Safe deterministic path generation.
 */
export function getRepoStorageDir(rootDir: string): string {
  const resolved = path.resolve(rootDir);
  const repoName = path.basename(resolved);
  const idFile = path.join(resolved, '.git', REPO_ID_FILE);
  
  try {
    const fs = require('fs'); // Runtime require to avoid side effects
    if (fs.existsSync(idFile)) {
      const id = fs.readFileSync(idFile, 'utf-8').trim();
      if (id === 'legacy') return path.join(LUMI_OPS_HOME, repoName);
      return path.join(LUMI_OPS_HOME, `${repoName}-${id}`);
    }
  } catch (e) {
    // Ignore errors (e.g. no .git)
  }

  // Fallback if not initialized yet
  const crypto = require('crypto');
  const hash = crypto.createHash('md5').update(resolved).digest('hex').slice(0, 8);
  const newPath = path.join(LUMI_OPS_HOME, `${repoName}-${hash}`);
  const legacyPath = path.join(LUMI_OPS_HOME, repoName);

  try {
    const fs = require('fs');
    if (fs.existsSync(newPath)) {
      return newPath;
    } else if (fs.existsSync(legacyPath)) {
      return legacyPath;
    }
  } catch (e) {
    // Ignore errors
  }

  return newPath; // Default for entirely new repo
}

/**
 * Initialize and write the repo storage ID to .git/lumi-ops-id.
 * Must be called before destructive or structural operations.
 */
export async function initRepoStorageDir(rootDir: string): Promise<string> {
  const resolved = path.resolve(rootDir);
  const repoName = path.basename(resolved);
  const idFile = path.join(resolved, '.git', REPO_ID_FILE);
  const fs = await import('fs-extra');

  // Verify it's a git repo first
  if (!(await fs.pathExists(path.join(resolved, '.git')))) {
    throw new Error(`Cannot initialize Lumi-Ops: Not a git repository (${resolved})`);
  }

  if (await fs.pathExists(idFile)) {
    // Already initialized
    return getRepoStorageDir(rootDir);
  }

  const crypto = await import('crypto');
  const hash = crypto.createHash('md5').update(resolved).digest('hex').slice(0, 8);
  const newPath = path.join(LUMI_OPS_HOME, `${repoName}-${hash}`);
  const legacyPath = path.join(LUMI_OPS_HOME, repoName);

  let determinedPath = newPath;
  let idValue = hash;

  if (await fs.pathExists(newPath)) {
    determinedPath = newPath;
    idValue = hash;
  } else if (await fs.pathExists(legacyPath)) {
    determinedPath = legacyPath;
    idValue = 'legacy';
  }

  await fs.ensureDir(determinedPath);
  await fs.writeFile(idFile, idValue + '\n');
  return determinedPath;
}

/**
 * Get the directory where worktree clones are stored for a repo.
 * Structure: <repoRoot>.worktrees/
 * Matches VS Code native git extension convention.
 */
export function getClonesDir(rootDir: string): string {
  const resolved = path.resolve(rootDir);
  return `${resolved}.worktrees`;
}

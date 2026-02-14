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

/**
 * Root directory for all lumi-ops data in the user's home directory.
 */
export const LUMI_OPS_HOME = path.join(os.homedir(), '.lumi-ops');

/**
 * Subdirectory under the repo storage dir that contains worktree clones.
 */
export const CLONES_SUBDIR = 'clones';

/**
 * Get the per-repo storage directory.
 * Structure: ~/.lumi-ops/<repo-name>/
 */
export function getRepoStorageDir(rootDir: string): string {
  const repoName = path.basename(path.resolve(rootDir));
  return path.join(LUMI_OPS_HOME, repoName);
}

/**
 * Get the directory where worktree clones are stored for a repo.
 * Structure: ~/.lumi-ops/<repo-name>/clones/
 */
export function getClonesDir(rootDir: string): string {
  return path.join(getRepoStorageDir(rootDir), CLONES_SUBDIR);
}

import * as path from 'path';
import * as os from 'os';

/**
 * Name of the legacy directory used for shadow clone worktrees (inside repo).
 * Kept for backwards-compatibility detection and migration warnings.
 */
export const SHADOW_CLONES_DIR = '.shadow-clones';

/**
 * Get the global directory for Lumi-Ops.
 * Supports `LUMI_OPS_HOME` env var override (used by tests for isolation).
 */
export function getLumiOpsHome(): string {
  return process.env.LUMI_OPS_HOME || path.join(os.homedir(), '.lumi-ops');
}

/** @deprecated Use `getLumiOpsHome()` — this is evaluated once at import time and won't reflect env changes. */
export const LUMI_OPS_HOME = getLumiOpsHome();

/**
 * Name of the centralized metadata file.
 */
export const METADATA_FILE = '.lumi-metadata.json';

/**
 * Review status for a shadow clone branch (user-assigned).
 */
export type ReviewStatus = 'todo' | 'inProgress' | 'done' | 'wontDo' | 'needsReview' | 'needsRevision';

/**
 * Clone type: 'task' for implementation clones, 'integration' for coordinator clones.
 */
export type CloneType = 'task' | 'integration';
/**
 * Get the per-repo storage directory for metadata and prompts.
 * Now unified with the worktrees directory.
 */
export function getRepoStorageDir(rootDir: string): string {
  return getClonesDir(rootDir);
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

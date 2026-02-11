/**
 * Name of the directory used for shadow clone worktrees.
 * All worktrees are created under `<rootDir>/<SHADOW_CLONES_DIR>/`.
 */
export const SHADOW_CLONES_DIR = '.shadow-clones';

/**
 * Name of the centralized metadata file stored under the shadow-clones directory.
 */
export const METADATA_FILE = '.lumi-metadata.json';

/**
 * Review status for a shadow clone branch (user-assigned).
 */
export type ReviewStatus = 'todo' | 'inProgress' | 'done' | 'wontDo';

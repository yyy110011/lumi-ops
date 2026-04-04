import * as path from 'path';
import * as fs from 'fs-extra';
import { getRepoStorageDir, METADATA_FILE } from '../constants';
import type { ReviewStatus, CloneType } from '../constants';

/**
 * Shape of per-branch metadata stored in .lumi-metadata.json.
 *
 * - `baseBranch`: The git fork point — used for merge, rebase, diff, and display (← branch).
 * - `parentBranch`: Logical hierarchy parent — used for tree nesting only.
 *   Defaults to `baseBranch` when not explicitly set.
 */
export interface CloneMetadata {
  baseBranch?: string;       // git fork point (merge/rebase/diff target, display)
  parentBranch?: string;     // logical hierarchy parent (tree nesting only)
  cloneType?: CloneType;     // 'task' (default) or 'integration'
  description?: string;
  reviewStatus?: ReviewStatus;
  sourcePrompt?: string;
}

/**
 * Read and parse the centralized .lumi-metadata.json for a repo.
 * Returns an empty object if the file doesn't exist or is unparseable.
 *
 * Includes migration shim: if entry has `baseBranch` but no `parentBranch`,
 * copies baseBranch → parentBranch. Does NOT delete baseBranch.
 */
export async function readMetadata(
  rootDir: string,
): Promise<Record<string, CloneMetadata>> {
  const metaPath = path.join(getRepoStorageDir(rootDir), METADATA_FILE);
  try {
    const raw = await fs.readFile(metaPath, 'utf-8');
    const parsed = JSON.parse(raw);
    // Migration: ensure parentBranch exists (copy from baseBranch if missing)
    for (const key of Object.keys(parsed)) {
      const entry = parsed[key];
      if (entry.baseBranch && !entry.parentBranch) {
        entry.parentBranch = entry.baseBranch;
      }
    }
    return parsed;
  } catch {
    return {};
  }
}

/**
 * Write the centralized .lumi-metadata.json for a repo.
 */
export async function writeMetadata(
  rootDir: string,
  metadata: Record<string, CloneMetadata>,
): Promise<void> {
  const metaPath = path.join(getRepoStorageDir(rootDir), METADATA_FILE);
  await fs.writeFile(metaPath, JSON.stringify(metadata, null, 2));
}

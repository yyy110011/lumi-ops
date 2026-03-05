import * as fs from 'fs';
import * as path from 'path';
import { getRepoStorageDir, METADATA_FILE } from '@lumi-ops/cli';

/**
 * Derive clone ID from a worktree path.
 * Extracts everything after the `.worktrees/` marker.
 * Example: `/repo.worktrees/feat/my-task` → `feat/my-task`
 */
export function deriveCloneId(wtPath: string): string | undefined {
  const marker = '.worktrees/';
  const idx = wtPath.indexOf(marker);
  return idx !== -1 ? wtPath.substring(idx + marker.length) : undefined;
}

/**
 * Transition clone review status if the current status is eligible.
 * Guards against overriding meaningful statuses (done, needsRevision, etc.).
 *
 * @param mainRepoRoot - Path to the main repository root
 * @param cloneId - Clone identifier (dirName)
 * @param newStatus - Target status to transition to
 * @param eligibleFrom - List of statuses that are eligible for transition;
 *                       undefined/missing status is always eligible
 */
export function setStatusIfApplicable(
  mainRepoRoot: string,
  cloneId: string,
  newStatus: string,
  eligibleFrom: string[],
): boolean {
  try {
    const metadataPath = path.join(getRepoStorageDir(mainRepoRoot), METADATA_FILE);
    const raw = fs.readFileSync(metadataPath, 'utf-8');
    const metadata = JSON.parse(raw);
    const current = metadata[cloneId]?.reviewStatus;
    if (!metadata[cloneId]) return false; // clone not in metadata — skip
    if (!current || eligibleFrom.includes(current)) {
      metadata[cloneId].reviewStatus = newStatus;
      fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

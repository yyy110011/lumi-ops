import * as path from 'path';
import type { ReviewStatus } from '../constants';
import { readMetadata, writeMetadata } from './metadata';

/**
 * Set the review status of a shadow clone branch.
 *
 * Updates the centralized .lumi-metadata.json for the repo.
 * Creates the metadata entry for the branch if it doesn't exist.
 */
export async function setCloneStatus(
  branch: string,
  status: ReviewStatus,
  options?: { root?: string },
): Promise<void> {
  const rootDir = path.resolve(options?.root || process.cwd());
  const metadata = await readMetadata(rootDir);

  if (!metadata[branch]) {
    metadata[branch] = {};
  }
  metadata[branch].reviewStatus = status;

  await writeMetadata(rootDir, metadata);
}

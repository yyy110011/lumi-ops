import * as path from 'path';
import * as fs from 'fs-extra';
import { getRepoStorageDir, METADATA_FILE } from '../constants';
import type { ReviewStatus } from '../constants';

/**
 * Shape of per-branch metadata stored in .lumi-metadata.json.
 */
export interface CloneMetadata {
  baseBranch?: string;
  description?: string;
  reviewStatus?: ReviewStatus;
  sourcePrompt?: string;
}

/**
 * Read and parse the centralized .lumi-metadata.json for a repo.
 * Returns an empty object if the file doesn't exist or is unparseable.
 */
export async function readMetadata(
  rootDir: string,
): Promise<Record<string, CloneMetadata>> {
  const metaPath = path.join(getRepoStorageDir(rootDir), METADATA_FILE);
  try {
    const raw = await fs.readFile(metaPath, 'utf-8');
    return JSON.parse(raw);
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

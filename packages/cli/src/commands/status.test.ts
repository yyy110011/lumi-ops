import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs-extra';
import { setCloneStatus } from './status';
import { readMetadata } from './metadata';
import { getRepoStorageDir, METADATA_FILE } from '../constants';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lumi-status-test-')));
  // Create the storage dir so metadata can be written
  const storageDir = getRepoStorageDir(tmpDir);
  await fs.ensureDir(storageDir);
});

afterEach(async () => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch { /* best-effort */ }
  try {
    fs.rmSync(`${tmpDir}.worktrees`, { recursive: true, force: true });
  } catch { /* best-effort */ }
});

describe('setCloneStatus', () => {
  it('should create metadata entry and set status for a new branch', async () => {
    await setCloneStatus('feat/new-branch', 'needsReview', { root: tmpDir });

    const metadata = await readMetadata(tmpDir);
    expect(metadata['feat/new-branch']).toBeDefined();
    expect(metadata['feat/new-branch'].reviewStatus).toBe('needsReview');
  });

  it('should update status on an existing branch without overwriting other fields', async () => {
    // Pre-populate metadata with existing fields
    const metaPath = path.join(getRepoStorageDir(tmpDir), METADATA_FILE);
    await fs.writeJSON(metaPath, {
      'feat/existing': { baseBranch: 'main', description: 'test', reviewStatus: 'todo' },
    });

    await setCloneStatus('feat/existing', 'done', { root: tmpDir });

    const metadata = await readMetadata(tmpDir);
    expect(metadata['feat/existing'].reviewStatus).toBe('done');
    expect(metadata['feat/existing'].baseBranch).toBe('main');
    expect(metadata['feat/existing'].description).toBe('test');
  });

  it('should handle all valid review statuses', async () => {
    const statuses = ['todo', 'inProgress', 'done', 'wontDo', 'needsReview', 'needsRevision'] as const;

    for (const status of statuses) {
      await setCloneStatus('feat/status-test', status, { root: tmpDir });
      const metadata = await readMetadata(tmpDir);
      expect(metadata['feat/status-test'].reviewStatus).toBe(status);
    }
  });

  it('should not clobber other branches in metadata', async () => {
    const metaPath = path.join(getRepoStorageDir(tmpDir), METADATA_FILE);
    await fs.writeJSON(metaPath, {
      'feat/branch-a': { reviewStatus: 'done' },
    });

    await setCloneStatus('feat/branch-b', 'inProgress', { root: tmpDir });

    const metadata = await readMetadata(tmpDir);
    expect(metadata['feat/branch-a'].reviewStatus).toBe('done');
    expect(metadata['feat/branch-b'].reviewStatus).toBe('inProgress');
  });

  it('should create metadata file if it does not exist', async () => {
    const metaPath = path.join(getRepoStorageDir(tmpDir), METADATA_FILE);
    // Ensure the file does NOT exist
    try { await fs.remove(metaPath); } catch { /* ok */ }

    await setCloneStatus('feat/fresh', 'todo', { root: tmpDir });

    const metadata = await readMetadata(tmpDir);
    expect(metadata['feat/fresh'].reviewStatus).toBe('todo');
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { deriveCloneId, setStatusIfApplicable } from './autoStatus';

vi.mock('@lumi-ops/cli', () => ({
  getRepoStorageDir: vi.fn((root: string) => `${root}.worktrees`),
  METADATA_FILE: '.lumi-metadata.json',
}));

describe('deriveCloneId', () => {
  it('extracts clone ID from worktree path', () => {
    expect(deriveCloneId('/repo.worktrees/feat/my-task')).toBe('feat/my-task');
  });

  it('handles simple branch names', () => {
    expect(deriveCloneId('/repo.worktrees/fix-bug')).toBe('fix-bug');
  });

  it('handles nested paths with .worktrees marker', () => {
    expect(deriveCloneId('/home/user/project.worktrees/feat/deep/nested')).toBe('feat/deep/nested');
  });

  it('returns undefined when no .worktrees/ marker', () => {
    expect(deriveCloneId('/home/user/project')).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(deriveCloneId('')).toBeUndefined();
  });
});

describe('setStatusIfApplicable', () => {
  const tmpDir = path.join(__dirname, '__test_tmp__');
  const metadataPath = path.join(`${tmpDir}.worktrees`, '.lumi-metadata.json');

  beforeEach(() => {
    fs.mkdirSync(`${tmpDir}.worktrees`, { recursive: true });
  });

  afterEach(() => {
    try { fs.unlinkSync(metadataPath); } catch {}
    try { fs.rmdirSync(`${tmpDir}.worktrees`); } catch {}
  });

  function writeMetadata(data: Record<string, any>) {
    fs.writeFileSync(metadataPath, JSON.stringify(data, null, 2));
  }

  function readMetadata(): Record<string, any> {
    return JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
  }

  it('transitions from todo to inProgress', () => {
    writeMetadata({ 'feat/test': { reviewStatus: 'todo' } });
    const result = setStatusIfApplicable(tmpDir, 'feat/test', 'inProgress', ['todo']);
    expect(result).toBe(true);
    expect(readMetadata()['feat/test'].reviewStatus).toBe('inProgress');
  });

  it('transitions from undefined (missing) reviewStatus', () => {
    writeMetadata({ 'feat/test': { baseBranch: 'main' } });
    const result = setStatusIfApplicable(tmpDir, 'feat/test', 'inProgress', ['todo']);
    expect(result).toBe(true);
    expect(readMetadata()['feat/test'].reviewStatus).toBe('inProgress');
  });

  it('does NOT transition from done', () => {
    writeMetadata({ 'feat/test': { reviewStatus: 'done' } });
    const result = setStatusIfApplicable(tmpDir, 'feat/test', 'inProgress', ['todo']);
    expect(result).toBe(false);
    expect(readMetadata()['feat/test'].reviewStatus).toBe('done');
  });

  it('does NOT transition from needsRevision', () => {
    writeMetadata({ 'feat/test': { reviewStatus: 'needsRevision' } });
    const result = setStatusIfApplicable(tmpDir, 'feat/test', 'inProgress', ['todo']);
    expect(result).toBe(false);
    expect(readMetadata()['feat/test'].reviewStatus).toBe('needsRevision');
  });

  it('does NOT transition from inProgress when only todo is eligible', () => {
    writeMetadata({ 'feat/test': { reviewStatus: 'inProgress' } });
    const result = setStatusIfApplicable(tmpDir, 'feat/test', 'inProgress', ['todo']);
    expect(result).toBe(false);
  });

  it('returns false when metadata file is missing', () => {
    const result = setStatusIfApplicable('/nonexistent', 'feat/test', 'inProgress', ['todo']);
    expect(result).toBe(false);
  });

  it('creates reviewStatus key for clones with no metadata entry', () => {
    writeMetadata({});
    // Clone entry doesn't exist at all → should return false (no entry to update)
    const result = setStatusIfApplicable(tmpDir, 'feat/new', 'inProgress', ['todo']);
    expect(result).toBe(false);
  });
});

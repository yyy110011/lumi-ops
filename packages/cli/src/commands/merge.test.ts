import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mocks ---
const mockGitUtils = {
  mergeSquash: vi.fn(),
  commit: vi.fn(),
};

vi.mock('../utils/git', () => ({
  GitUtils: vi.fn(() => mockGitUtils),
}));

vi.mock('chalk', () => ({
  default: {
    red: vi.fn((s: string) => s),
    blue: vi.fn((s: string) => s),
    gray: vi.fn((s: string) => s),
    green: vi.fn((s: string) => s),
    yellow: vi.fn((s: string) => s),
  },
}));

import { merge } from './merge';
import { GitUtils } from '../utils/git';

describe('merge', () => {
  const branchName = 'feat/some-feature';
  const options = { root: '/fake/root' };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGitUtils.mergeSquash.mockResolvedValue(undefined);
    mockGitUtils.commit.mockResolvedValue(undefined);
  });

  // --- Basic merge (no cwd, legacy fallback) ---

  it('should perform squash merge and commit with default message', async () => {
    await merge(branchName, options);

    expect(mockGitUtils.mergeSquash).toHaveBeenCalledWith(branchName);
    expect(mockGitUtils.commit).toHaveBeenCalledWith(
      `feat: merged ${branchName} (shadow clone)`,
    );
  });

  it('should use root as merge directory when no cwd provided', async () => {
    await merge(branchName, options);

    expect(GitUtils).toHaveBeenCalledWith('/fake/root');
  });

  // --- cwd option (worktree-based merge) ---

  it('should use cwd as merge directory when provided', async () => {
    await merge(branchName, { ...options, cwd: '/fake/worktree/develop' });

    expect(GitUtils).toHaveBeenCalledWith('/fake/worktree/develop');
    expect(mockGitUtils.mergeSquash).toHaveBeenCalledWith(branchName);
    expect(mockGitUtils.commit).toHaveBeenCalled();
  });

  // --- commitMessage ---

  it('should use custom commitMessage when provided', async () => {
    const customMsg = 'fix: integrate auth module from shadow clone';
    await merge(branchName, { ...options, commitMessage: customMsg });

    expect(mockGitUtils.commit).toHaveBeenCalledWith(customMsg);
  });

  it('should use default commitMessage when not provided', async () => {
    await merge(branchName, options);

    expect(mockGitUtils.commit).toHaveBeenCalledWith(
      `feat: merged ${branchName} (shadow clone)`,
    );
  });

  // --- Conflict handling ---

  it('should throw CONFLICT error when merge has conflicts', async () => {
    mockGitUtils.mergeSquash.mockRejectedValue(new Error('CONFLICT (content): merge conflict in file.ts'));

    await expect(merge(branchName, options)).rejects.toThrow('CONFLICT');
  });

  it('should throw CONFLICT error for lowercase conflict message', async () => {
    mockGitUtils.mergeSquash.mockRejectedValue(new Error('Automatic merge failed; fix conflict'));

    await expect(merge(branchName, options)).rejects.toThrow('CONFLICT');
  });

  it('should re-throw non-conflict errors', async () => {
    const originalError = new Error('fatal: branch not found');
    mockGitUtils.mergeSquash.mockRejectedValue(originalError);

    await expect(merge(branchName, options)).rejects.toThrow(originalError);
  });

  // --- Combined: cwd + commitMessage ---

  it('should merge in worktree with custom commit message', async () => {
    const customMsg = 'feat: add dark mode support';
    await merge(branchName, {
      ...options,
      cwd: '/fake/worktree/develop',
      commitMessage: customMsg,
    });

    expect(GitUtils).toHaveBeenCalledWith('/fake/worktree/develop');
    expect(mockGitUtils.mergeSquash).toHaveBeenCalledWith(branchName);
    expect(mockGitUtils.commit).toHaveBeenCalledWith(customMsg);
  });
});

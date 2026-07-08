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

const mockExecSync = vi.fn();
vi.mock('child_process', () => ({
  execSync: (...args: any[]) => mockExecSync(...args),
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
    // Default: the unmerged-paths probe reports a clean state
    mockExecSync.mockReturnValue('');
  });

  /** Make the `git diff --diff-filter=U` probe report unmerged (conflicted) files. */
  function probeReportsConflicts() {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes('--diff-filter=U')) return 'src/conflicted-file.ts\n';
      return '';
    });
  }

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

  it('should throw CONFLICT when git reports unmerged paths', async () => {
    probeReportsConflicts();
    mockGitUtils.mergeSquash.mockRejectedValue(new Error('CONFLICT (content): merge conflict in file.ts'));

    await expect(merge(branchName, options)).rejects.toThrow('CONFLICT');
  });

  it('should throw CONFLICT on a localized error message when git reports unmerged paths', async () => {
    probeReportsConflicts();
    // git localizes its messages — e.g. zh_TW says 「合併衝突」, no 'conflict' substring
    mockGitUtils.mergeSquash.mockRejectedValue(new Error('自動合併失敗；請修正後再提交結果。'));

    await expect(merge(branchName, options)).rejects.toThrow('CONFLICT');
  });

  it('should probe unmerged paths in the merge directory', async () => {
    probeReportsConflicts();
    mockGitUtils.mergeSquash.mockRejectedValue(new Error('whatever'));

    await expect(
      merge(branchName, { ...options, cwd: '/fake/worktree/develop' }),
    ).rejects.toThrow('CONFLICT');

    expect(mockExecSync).toHaveBeenCalledWith(
      'git diff --name-only --diff-filter=U',
      expect.objectContaining({ cwd: '/fake/worktree/develop' }),
    );
  });

  it('should fall back to the message heuristic when the probe cannot run', async () => {
    mockExecSync.mockImplementation(() => {
      throw new Error('spawn git ENOENT');
    });
    mockGitUtils.mergeSquash.mockRejectedValue(new Error('Automatic merge failed; fix conflict'));

    await expect(merge(branchName, options)).rejects.toThrow('CONFLICT');
  });

  it('should trust the probe over the message when git reports no unmerged paths', async () => {
    // Probe runs and reports clean → a message that merely mentions conflict
    // is not treated as one (e.g. a failure about a file named CONFLICT)
    const originalError = new Error('fatal: pathspec CONFLICT.md did not match any files');
    mockGitUtils.mergeSquash.mockRejectedValue(originalError);

    await expect(merge(branchName, options)).rejects.toThrow(originalError);
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

  // --- Merge exclude (clone artifacts) ---

  it('should exclude .lumi/ directory after squash merge before committing', async () => {
    await merge(branchName, options);

    // Should call execSync for .lumi/ directory exclusion (reset + rm -rf)
    expect(mockExecSync).toHaveBeenCalledWith(
      'git reset HEAD .lumi/',
      expect.objectContaining({ cwd: '/fake/root', stdio: 'ignore' }),
    );
    expect(mockExecSync).toHaveBeenCalledWith(
      'rm -rf .lumi/',
      expect.objectContaining({ cwd: '/fake/root', stdio: 'ignore' }),
    );

    // Ensure exclude runs between squash merge and commit
    const squashCallOrder = mockGitUtils.mergeSquash.mock.invocationCallOrder[0];
    const commitCallOrder = mockGitUtils.commit.mock.invocationCallOrder[0];
    const firstExecCallOrder = mockExecSync.mock.invocationCallOrder[0];
    const lastExecCallOrder = mockExecSync.mock.invocationCallOrder[mockExecSync.mock.invocationCallOrder.length - 1];

    expect(firstExecCallOrder).toBeGreaterThan(squashCallOrder);
    expect(lastExecCallOrder).toBeLessThan(commitCallOrder);
  });

  it('should not fail if exclude files do not exist', async () => {
    mockExecSync.mockImplementation(() => {
      throw new Error('pathspec did not match any file(s)');
    });

    // Should still complete successfully
    await expect(merge(branchName, options)).resolves.toBeUndefined();
    expect(mockGitUtils.commit).toHaveBeenCalled();
  });
});

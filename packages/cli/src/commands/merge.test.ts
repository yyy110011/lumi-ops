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

describe('merge', () => {
  const branchName = 'feat/some-feature';
  const options = { root: '/fake/root' };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGitUtils.mergeSquash.mockResolvedValue(undefined);
    mockGitUtils.commit.mockResolvedValue(undefined);
  });

  it('should perform squash merge and commit', async () => {
    await merge(branchName, options);

    expect(mockGitUtils.mergeSquash).toHaveBeenCalledWith(branchName);
    expect(mockGitUtils.commit).toHaveBeenCalledWith(
      `feat: merged ${branchName} (shadow clone)`,
    );
  });

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

  it('should use process.cwd() when root is not provided', async () => {
    await merge(branchName, { root: '/another/root' });
    expect(mockGitUtils.mergeSquash).toHaveBeenCalledWith(branchName);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mocks ---
const mockGitUtils = {
  listWorktrees: vi.fn(),
};

vi.mock('../utils/git', () => ({
  GitUtils: vi.fn(() => mockGitUtils),
}));

vi.mock('chalk', () => ({
  default: {
    red: vi.fn((s: string) => s),
    blue: vi.fn((s: string) => s),
    gray: vi.fn((s: string) => s),
    cyan: vi.fn((s: string) => s),
    bold: vi.fn((s: string) => s),
  },
}));

const mockExit = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

import { list, parseWorktrees } from './list';

describe('list', () => {
  const rootDir = '/fake/root';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should parse porcelain worktrees and identify shadow clones', async () => {
    mockGitUtils.listWorktrees.mockResolvedValue([
      'worktree /fake/root\nHEAD abc123\nbranch refs/heads/main',
      `worktree /some/other/path/feat/test\nHEAD def456\nbranch refs/heads/feat/test`,
    ]);

    await list({ root: rootDir, json: true });

    const output = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(output).toHaveLength(2);
    expect(output[0]).toEqual({
      branch: 'main',
      path: '/fake/root',
      isShadow: false,
      isMain: true,
    });
    expect(output[1]).toEqual({
      branch: 'feat/test',
      path: '/some/other/path/feat/test',
      isShadow: true,
      isMain: false,
    });
  });

  it('should strip refs/heads/ from branch names', async () => {
    mockGitUtils.listWorktrees.mockResolvedValue([
      'worktree /some/path\nHEAD abc\nbranch refs/heads/feature/deep/nested',
    ]);

    await list({ root: rootDir, json: true });

    const output = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(output[0].branch).toBe('feature/deep/nested');
  });

  it('should skip entries without worktree path', async () => {
    mockGitUtils.listWorktrees.mockResolvedValue([
      'worktree /fake/root\nHEAD abc\nbranch refs/heads/main',
      'HEAD def456',
    ]);

    await list({ root: rootDir, json: true });

    const output = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(output).toHaveLength(1);
  });

  it('should output JSON when --json flag is set', async () => {
    mockGitUtils.listWorktrees.mockResolvedValue([
      'worktree /fake/root\nbranch refs/heads/main',
    ]);

    await list({ root: rootDir, json: true });

    expect(() => JSON.parse(consoleSpy.mock.calls[0][0])).not.toThrow();
  });

  it('should output text format when --json is not set', async () => {
    mockGitUtils.listWorktrees.mockResolvedValue([
      'worktree /fake/root\nbranch refs/heads/main',
    ]);

    await list({ root: rootDir });

    const allCalls = consoleSpy.mock.calls.map((c: any[]) => c[0]);
    expect(allCalls.some((c: string) => c.includes('Active Git Worktrees'))).toBe(true);
  });

  it('should handle empty worktree list', async () => {
    mockGitUtils.listWorktrees.mockResolvedValue([]);

    await list({ root: rootDir, json: true });

    const output = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(output).toEqual([]);
  });

  it('should exit with code 1 on error', async () => {
    mockGitUtils.listWorktrees.mockRejectedValue(new Error('git error'));

    await list({ root: rootDir });

    expect(mockExit).toHaveBeenCalledWith(1);
  });
});

describe('parseWorktrees', () => {
  it('first entry is always isMain: true, isShadow: false', () => {
    const result = parseWorktrees([
      'worktree /any/path\nHEAD abc\nbranch refs/heads/main',
    ], '/unused');

    expect(result[0].isMain).toBe(true);
    expect(result[0].isShadow).toBe(false);
  });

  it('non-first entries are isShadow: true regardless of path', () => {
    const result = parseWorktrees([
      'worktree /repo\nHEAD abc\nbranch refs/heads/main',
      'worktree /completely/different/path\nHEAD def\nbranch refs/heads/feat/a',
      'worktree /repo.worktrees/feat/b\nHEAD ghi\nbranch refs/heads/feat/b',
    ], '/repo');

    expect(result[0].isMain).toBe(true);
    expect(result[0].isShadow).toBe(false);

    expect(result[1].isMain).toBe(false);
    expect(result[1].isShadow).toBe(true);

    expect(result[2].isMain).toBe(false);
    expect(result[2].isShadow).toBe(true);
  });

  it('detached HEAD entries at any path are included', () => {
    const result = parseWorktrees([
      'worktree /repo\nHEAD abc\nbranch refs/heads/main',
      'worktree /random/location/feat-branch\nHEAD def\ndetached',
    ], '/repo');

    expect(result).toHaveLength(2);
    expect(result[1]).toMatchObject({
      branch: 'feat-branch',
      path: '/random/location/feat-branch',
      isShadow: true,
      isMain: false,
      isDetached: true,
    });
  });

  it('detached HEAD at index 0 is isMain: true', () => {
    const result = parseWorktrees([
      'worktree /repo\nHEAD abc\ndetached',
    ], '/repo');

    expect(result[0].isMain).toBe(true);
    expect(result[0].isShadow).toBe(false);
    expect(result[0].isDetached).toBe(true);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getClonesDir } from '../constants';

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

import { list } from './list';

describe('list', () => {
  const rootDir = '/fake/root';
  const clonesDir = getClonesDir(rootDir);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should parse porcelain worktrees and identify shadow clones', async () => {
    mockGitUtils.listWorktrees.mockResolvedValue([
      'worktree /fake/root\nHEAD abc123\nbranch refs/heads/main',
      `worktree ${clonesDir}/feat/test\nHEAD def456\nbranch refs/heads/feat/test`,
    ]);

    await list({ root: rootDir, json: true });

    const output = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(output).toHaveLength(2);
    expect(output[0]).toEqual({
      branch: 'main',
      path: '/fake/root',
      isShadow: false,
    });
    expect(output[1]).toEqual({
      branch: 'feat/test',
      path: `${clonesDir}/feat/test`,
      isShadow: true,
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

  it('should skip entries without worktree path or branch', async () => {
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

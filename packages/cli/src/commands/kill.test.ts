import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as path from 'path';

// --- Mocks ---
const mockGitUtils = {
  removeWorktree: vi.fn(),
  deleteBranch: vi.fn(),
};

vi.mock('../utils/git', () => ({
  GitUtils: vi.fn(() => mockGitUtils),
}));

vi.mock('chalk', () => ({
  default: {
    red: vi.fn((s: string) => s),
    yellow: vi.fn((s: string) => s),
    gray: vi.fn((s: string) => s),
    green: vi.fn((s: string) => s),
  },
}));

const mockExit = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);

import { kill } from './kill';

describe('kill', () => {
  const branchName = 'feat/old-feature';
  const rootDir = '/fake/root';
  const targetPath = path.join(rootDir, '.shadow-clones', branchName);

  beforeEach(() => {
    vi.clearAllMocks();
    mockGitUtils.removeWorktree.mockResolvedValue(undefined);
    mockGitUtils.deleteBranch.mockResolvedValue(undefined);
  });

  it('should remove worktree with force and delete branch with force', async () => {
    await kill(branchName, { root: rootDir });

    expect(mockGitUtils.removeWorktree).toHaveBeenCalledWith(targetPath, true);
    expect(mockGitUtils.deleteBranch).toHaveBeenCalledWith(branchName, true);
  });

  it('should call removeWorktree before deleteBranch', async () => {
    const callOrder: string[] = [];
    mockGitUtils.removeWorktree.mockImplementation(async () => {
      callOrder.push('removeWorktree');
    });
    mockGitUtils.deleteBranch.mockImplementation(async () => {
      callOrder.push('deleteBranch');
    });

    await kill(branchName, { root: rootDir });

    expect(callOrder).toEqual(['removeWorktree', 'deleteBranch']);
  });

  it('should exit with code 1 when removeWorktree fails', async () => {
    mockGitUtils.removeWorktree.mockRejectedValue(new Error('worktree not found'));

    await kill(branchName, { root: rootDir });

    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it('should exit with code 1 when deleteBranch fails', async () => {
    mockGitUtils.deleteBranch.mockRejectedValue(new Error('branch not found'));

    await kill(branchName, { root: rootDir });

    expect(mockExit).toHaveBeenCalledWith(1);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as path from 'path';

// --- Mocks (vi.hoisted ensures these are available when vi.mock factories run) ---
const { mockGitUtils, mockFs, mockExecSync } = vi.hoisted(() => ({
  mockGitUtils: {
    removeWorktree: vi.fn(),
    deleteBranch: vi.fn(),
    pruneWorktrees: vi.fn(),
  },
  mockFs: {
    readJSON: vi.fn(),
    writeJSON: vi.fn(),
  },
  mockExecSync: vi.fn(),
}));

vi.mock('../utils/git', () => ({
  GitUtils: vi.fn(() => mockGitUtils),
}));

vi.mock('fs-extra', () => ({
  default: mockFs,
  ...mockFs,
}));

vi.mock('chalk', () => ({
  default: {
    red: vi.fn((s: string) => s),
    yellow: vi.fn((s: string) => s),
    gray: vi.fn((s: string) => s),
    green: vi.fn((s: string) => s),
  },
}));

vi.mock('child_process', () => ({
  execSync: mockExecSync,
}));

const mockExit = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);

import { kill } from './kill';
import { getClonesDir, getRepoStorageDir, METADATA_FILE } from '../constants';

describe('kill', () => {
  const identifier = 'feat/old-feature';
  const rootDir = '/fake/root';
  const targetPath = path.join(getClonesDir(rootDir), identifier);
  const metadataPath = path.join(getRepoStorageDir(rootDir), METADATA_FILE);

  beforeEach(() => {
    vi.clearAllMocks();
    mockGitUtils.removeWorktree.mockResolvedValue(undefined);
    mockGitUtils.deleteBranch.mockResolvedValue(undefined);
    mockFs.readJSON.mockRejectedValue(new Error('ENOENT'));
    mockFs.writeJSON.mockResolvedValue(undefined);
    // Default: actual branch matches identifier
    mockExecSync.mockReturnValue('feat/old-feature\n');
  });

  it('should remove worktree with force and delete actual branch', async () => {
    await kill(identifier, { root: rootDir });

    expect(mockGitUtils.removeWorktree).toHaveBeenCalledWith(targetPath, true);
    expect(mockGitUtils.deleteBranch).toHaveBeenCalledWith('feat/old-feature', true);
  });

  it('should NOT delete branch when keepBranch is true', async () => {
    await kill(identifier, { root: rootDir, keepBranch: true });

    expect(mockGitUtils.removeWorktree).toHaveBeenCalledWith(targetPath, true);
    expect(mockGitUtils.deleteBranch).not.toHaveBeenCalled();
  });

  it('should call removeWorktree before deleteBranch', async () => {
    const callOrder: string[] = [];
    mockGitUtils.removeWorktree.mockImplementation(async () => {
      callOrder.push('removeWorktree');
    });
    mockGitUtils.deleteBranch.mockImplementation(async () => {
      callOrder.push('deleteBranch');
    });

    await kill(identifier, { root: rootDir });

    expect(callOrder).toEqual(['removeWorktree', 'deleteBranch']);
  });

  it('should remove entry from centralized metadata using identifier (dirName)', async () => {
    mockFs.readJSON.mockResolvedValue({
      'feat/old-feature': { baseBranch: 'main' },
      'feat/other': { baseBranch: 'develop' },
    });

    await kill(identifier, { root: rootDir });

    expect(mockFs.writeJSON).toHaveBeenCalledWith(
      metadataPath,
      { 'feat/other': { baseBranch: 'develop' } },
      { spaces: 2 },
    );
  });

  it('should not fail when metadata file does not exist', async () => {
    mockFs.readJSON.mockRejectedValue(new Error('ENOENT'));

    await kill(identifier, { root: rootDir });

    expect(mockFs.writeJSON).not.toHaveBeenCalled();
    expect(mockExit).not.toHaveBeenCalled();
  });

  it('should throw when removeWorktree fails', async () => {
    mockGitUtils.removeWorktree.mockRejectedValue(new Error('worktree not found'));

    await expect(kill(identifier, { root: rootDir })).rejects.toThrow('worktree not found');
  });

  it('should throw when deleteBranch fails for actual branch', async () => {
    mockGitUtils.deleteBranch.mockRejectedValue(new Error('branch not found'));

    // Should not throw - errors on branch deletion are caught silently
    await kill(identifier, { root: rootDir });
  });

  it('should delete both actual branch and identifier branch when they differ', async () => {
    // User checked out a different branch inside the clone
    mockExecSync.mockReturnValue('develop\n');

    await kill(identifier, { root: rootDir });

    // Should attempt to delete both branches
    expect(mockGitUtils.deleteBranch).toHaveBeenCalledTimes(2);
    expect(mockGitUtils.deleteBranch).toHaveBeenCalledWith('develop', true);
    expect(mockGitUtils.deleteBranch).toHaveBeenCalledWith('feat/old-feature', true);
  });

  it('should read actual branch via git rev-parse before removing worktree', async () => {
    await kill(identifier, { root: rootDir });

    expect(mockExecSync).toHaveBeenCalledWith(
      'git rev-parse --abbrev-ref HEAD',
      { cwd: targetPath, encoding: 'utf-8' },
    );
  });

  it('should handle detached HEAD gracefully', async () => {
    mockExecSync.mockReturnValue('HEAD\n');

    await kill(identifier, { root: rootDir });

    // Should try to delete identifier branch
    expect(mockGitUtils.deleteBranch).toHaveBeenCalledWith('feat/old-feature', true);
    // Should NOT try to delete 'HEAD' as a branch
    expect(mockGitUtils.deleteBranch).toHaveBeenCalledTimes(1);
  });
});

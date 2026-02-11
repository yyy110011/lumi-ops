import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as path from 'path';

// --- Mocks (vi.hoisted ensures these are available when vi.mock factories run) ---
const { mockGitUtils, mockFs } = vi.hoisted(() => ({
  mockGitUtils: {
    removeWorktree: vi.fn(),
    deleteBranch: vi.fn(),
  },
  mockFs: {
    readJSON: vi.fn(),
    writeJSON: vi.fn(),
  },
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

const mockExit = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);

import { kill } from './kill';
import { SHADOW_CLONES_DIR, METADATA_FILE } from '../constants';

describe('kill', () => {
  const branchName = 'feat/old-feature';
  const rootDir = '/fake/root';
  const targetPath = path.join(rootDir, SHADOW_CLONES_DIR, branchName);
  const metadataPath = path.join(rootDir, SHADOW_CLONES_DIR, METADATA_FILE);

  beforeEach(() => {
    vi.clearAllMocks();
    mockGitUtils.removeWorktree.mockResolvedValue(undefined);
    mockGitUtils.deleteBranch.mockResolvedValue(undefined);
    mockFs.readJSON.mockRejectedValue(new Error('ENOENT'));
    mockFs.writeJSON.mockResolvedValue(undefined);
  });

  it('should remove worktree with force and delete branch with force', async () => {
    await kill(branchName, { root: rootDir });

    expect(mockGitUtils.removeWorktree).toHaveBeenCalledWith(targetPath, true);
    expect(mockGitUtils.deleteBranch).toHaveBeenCalledWith(branchName, true);
  });

  it('should NOT delete branch when keepBranch is true', async () => {
    await kill(branchName, { root: rootDir, keepBranch: true });

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

    await kill(branchName, { root: rootDir });

    expect(callOrder).toEqual(['removeWorktree', 'deleteBranch']);
  });

  it('should remove branch entry from centralized metadata', async () => {
    mockFs.readJSON.mockResolvedValue({
      'feat/old-feature': { baseBranch: 'main' },
      'feat/other': { baseBranch: 'develop' },
    });

    await kill(branchName, { root: rootDir });

    expect(mockFs.writeJSON).toHaveBeenCalledWith(
      metadataPath,
      { 'feat/other': { baseBranch: 'develop' } },
      { spaces: 2 },
    );
  });

  it('should not fail when metadata file does not exist', async () => {
    mockFs.readJSON.mockRejectedValue(new Error('ENOENT'));

    await kill(branchName, { root: rootDir });

    expect(mockFs.writeJSON).not.toHaveBeenCalled();
    expect(mockExit).not.toHaveBeenCalled();
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

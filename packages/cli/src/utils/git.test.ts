import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock simple-git before importing GitUtils
const mockGit = {
  checkIsRepo: vi.fn(),
  revparse: vi.fn(),
  raw: vi.fn(),
  merge: vi.fn(),
  commit: vi.fn(),
};

vi.mock('simple-git', () => ({
  simpleGit: vi.fn(() => mockGit),
}));

vi.mock('fs-extra');

import { GitUtils } from './git';

describe('GitUtils', () => {
  let gitUtils: GitUtils;

  beforeEach(() => {
    vi.clearAllMocks();
    gitUtils = new GitUtils('/fake/root');
  });

  describe('isGitRepo', () => {
    it('should return true when inside a git repo', async () => {
      mockGit.checkIsRepo.mockResolvedValue(true);
      expect(await gitUtils.isGitRepo()).toBe(true);
    });

    it('should return false when not a git repo', async () => {
      mockGit.checkIsRepo.mockResolvedValue(false);
      expect(await gitUtils.isGitRepo()).toBe(false);
    });

    it('should return false when checkIsRepo throws', async () => {
      mockGit.checkIsRepo.mockRejectedValue(new Error('not a git repo'));
      expect(await gitUtils.isGitRepo()).toBe(false);
    });
  });

  describe('getCurrentBranch', () => {
    it('should return trimmed branch name', async () => {
      mockGit.revparse.mockResolvedValue('  main  \n');
      const branch = await gitUtils.getCurrentBranch();
      expect(branch).toBe('main');
      expect(mockGit.revparse).toHaveBeenCalledWith(['--abbrev-ref', 'HEAD']);
    });
  });

  describe('addWorktree', () => {
    it('should add worktree with default base branch', async () => {
      mockGit.raw.mockResolvedValue('');
      await gitUtils.addWorktree('feat/new', '/target/path');
      expect(mockGit.raw).toHaveBeenCalledWith([
        'worktree', 'add', '-b', 'feat/new', '/target/path', 'main',
      ]);
    });

    it('should add worktree with custom base branch', async () => {
      mockGit.raw.mockResolvedValue('');
      await gitUtils.addWorktree('feat/new', '/target/path', 'develop');
      expect(mockGit.raw).toHaveBeenCalledWith([
        'worktree', 'add', '-b', 'feat/new', '/target/path', 'develop',
      ]);
    });
  });

  describe('removeWorktree', () => {
    it('should remove worktree without force', async () => {
      mockGit.raw.mockResolvedValue('');
      await gitUtils.removeWorktree('/target/path');
      expect(mockGit.raw).toHaveBeenCalledWith(['worktree', 'remove', '/target/path']);
    });

    it('should remove worktree with force', async () => {
      mockGit.raw.mockResolvedValue('');
      await gitUtils.removeWorktree('/target/path', true);
      expect(mockGit.raw).toHaveBeenCalledWith(['worktree', 'remove', '/target/path', '--force']);
    });
  });

  describe('listWorktrees', () => {
    it('should parse porcelain output into entries', async () => {
      const porcelainOutput = [
        'worktree /main/path\nHEAD abc123\nbranch refs/heads/main',
        'worktree /shadow/path\nHEAD def456\nbranch refs/heads/feat/test',
      ].join('\n\n');
      mockGit.raw.mockResolvedValue(porcelainOutput);

      const result = await gitUtils.listWorktrees();
      expect(result).toHaveLength(2);
      expect(result[0]).toContain('worktree /main/path');
      expect(result[1]).toContain('worktree /shadow/path');
      expect(mockGit.raw).toHaveBeenCalledWith(['worktree', 'list', '--porcelain']);
    });

    it('should filter empty entries', async () => {
      mockGit.raw.mockResolvedValue('worktree /main/path\nbranch refs/heads/main\n\n');
      const result = await gitUtils.listWorktrees();
      expect(result).toHaveLength(1);
    });
  });

  describe('deleteBranch', () => {
    it('should delete branch with -d by default', async () => {
      mockGit.raw.mockResolvedValue('');
      await gitUtils.deleteBranch('feat/old');
      expect(mockGit.raw).toHaveBeenCalledWith(['branch', '-d', 'feat/old']);
    });

    it('should delete branch with -D when force is true', async () => {
      mockGit.raw.mockResolvedValue('');
      await gitUtils.deleteBranch('feat/old', true);
      expect(mockGit.raw).toHaveBeenCalledWith(['branch', '-D', 'feat/old']);
    });
  });

  describe('mergeSquash', () => {
    it('should call merge with --squash flag', async () => {
      mockGit.merge.mockResolvedValue(undefined);
      await gitUtils.mergeSquash('feat/branch');
      expect(mockGit.merge).toHaveBeenCalledWith(['--squash', 'feat/branch']);
    });
  });

  describe('commit', () => {
    it('should call commit with the given message', async () => {
      mockGit.commit.mockResolvedValue(undefined);
      await gitUtils.commit('feat: test commit');
      expect(mockGit.commit).toHaveBeenCalledWith('feat: test commit');
    });
  });
});

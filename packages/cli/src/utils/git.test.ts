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

  describe('addWorktreeExisting', () => {
    it('should add worktree for an existing branch without -b', async () => {
      mockGit.raw.mockResolvedValue('');
      await gitUtils.addWorktreeExisting('/target/path', 'feat/existing');
      expect(mockGit.raw).toHaveBeenCalledWith([
        'worktree', 'add', '/target/path', 'feat/existing',
      ]);
    });
  });

  describe('listBranches', () => {
    it('should return trimmed branch names', async () => {
      mockGit.raw.mockResolvedValue('main\nfeat/a\nfeat/b\n');
      const branches = await gitUtils.listBranches();
      expect(branches).toEqual(['main', 'feat/a', 'feat/b']);
      expect(mockGit.raw).toHaveBeenCalledWith([
        'branch', '--list', '--format=%(refname:short)',
      ]);
    });

    it('should filter empty strings', async () => {
      mockGit.raw.mockResolvedValue('main\n\n\n');
      const branches = await gitUtils.listBranches();
      expect(branches).toEqual(['main']);
    });
  });

  describe('branchExists', () => {
    it('should return true when branch is in the list', async () => {
      mockGit.raw.mockResolvedValue('main\nfeat/existing\n');
      expect(await gitUtils.branchExists('feat/existing')).toBe(true);
    });

    it('should return false when branch is not in the list', async () => {
      mockGit.raw.mockResolvedValue('main\nfeat/other\n');
      expect(await gitUtils.branchExists('feat/new')).toBe(false);
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

  describe('listRemoteBranches', () => {
    it('should return trimmed remote branch names', async () => {
      mockGit.raw.mockResolvedValue('origin/main\norigin/feat/remote-a\norigin/feat/remote-b\n');
      const branches = await gitUtils.listRemoteBranches();
      expect(branches).toEqual(['origin/main', 'origin/feat/remote-a', 'origin/feat/remote-b']);
      expect(mockGit.raw).toHaveBeenCalledWith(['branch', '-r', '--format=%(refname:short)']);
    });

    it('should filter out HEAD pointers', async () => {
      mockGit.raw.mockResolvedValue('origin/HEAD\norigin/main\norigin/feat/a\n');
      const branches = await gitUtils.listRemoteBranches();
      expect(branches).toEqual(['origin/main', 'origin/feat/a']);
    });

    it('should filter empty strings', async () => {
      mockGit.raw.mockResolvedValue('origin/main\n\n\n');
      const branches = await gitUtils.listRemoteBranches();
      expect(branches).toEqual(['origin/main']);
    });
  });

  describe('fetchRemote', () => {
    it('should call git fetch without remote name', async () => {
      mockGit.raw.mockResolvedValue('');
      await gitUtils.fetchRemote();
      expect(mockGit.raw).toHaveBeenCalledWith(['fetch']);
    });

    it('should call git fetch with specific remote name', async () => {
      mockGit.raw.mockResolvedValue('');
      await gitUtils.fetchRemote('upstream');
      expect(mockGit.raw).toHaveBeenCalledWith(['fetch', 'upstream']);
    });
  });

  describe('checkoutBranch', () => {
    it('should call git checkout with branch name', async () => {
      mockGit.raw.mockResolvedValue('');
      await gitUtils.checkoutBranch('feat/my-branch');
      expect(mockGit.raw).toHaveBeenCalledWith(['checkout', 'feat/my-branch']);
    });
  });

  describe('branch list merging (local + remote without duplicates)', () => {
    it('should produce local branches first, then remote-only branches, with no duplicates', async () => {
      // Simulate: local has [main, feat/local-only, feat/both]
      // Remote has [origin/main, origin/feat/both, origin/feat/remote-only]
      // Current branch is 'main', worktree branches = []
      // Expected result: local = [feat/local-only, feat/both], remote-only = [feat/remote-only]

      const currentBranch = 'main';
      const worktreeBranches = new Set<string>();

      // Setup local branches
      mockGit.raw.mockResolvedValueOnce('main\nfeat/local-only\nfeat/both\n');
      const localBranches = (await gitUtils.listBranches()).filter(
        b => b !== currentBranch && !worktreeBranches.has(b)
      );
      const localSet = new Set(localBranches);

      // Setup remote branches
      mockGit.raw.mockResolvedValueOnce('origin/main\norigin/feat/both\norigin/feat/remote-only\norigin/HEAD\n');
      const remoteBranchesRaw = await gitUtils.listRemoteBranches();
      const remoteBranches = remoteBranchesRaw
        .map(b => {
          const slashIdx = b.indexOf('/');
          return slashIdx >= 0 ? b.substring(slashIdx + 1) : b;
        })
        .filter(b => b !== currentBranch && !localSet.has(b) && !worktreeBranches.has(b));
      const uniqueRemote = [...new Set(remoteBranches)];

      const result = [
        ...localBranches.map(name => ({ name, isRemote: false })),
        ...uniqueRemote.map(name => ({ name, isRemote: true })),
      ];

      // Verify: local branches (excluding current)
      expect(result.filter(b => !b.isRemote).map(b => b.name)).toEqual(['feat/local-only', 'feat/both']);
      // Verify: remote-only branches (not in local, not current)
      expect(result.filter(b => b.isRemote).map(b => b.name)).toEqual(['feat/remote-only']);
      // Verify: no duplicates — 'feat/both' should NOT appear in remote list
      const allNames = result.map(b => b.name);
      expect(allNames).toEqual(['feat/local-only', 'feat/both', 'feat/remote-only']);
      // Verify: total count is correct
      expect(result).toHaveLength(3);
    });

    it('should exclude worktree branches from both local and remote', async () => {
      const currentBranch = 'main';
      const worktreeBranches = new Set(['feat/in-worktree']);

      mockGit.raw.mockResolvedValueOnce('main\nfeat/in-worktree\nfeat/free\n');
      const localBranches = (await gitUtils.listBranches()).filter(
        b => b !== currentBranch && !worktreeBranches.has(b)
      );
      const localSet = new Set(localBranches);

      mockGit.raw.mockResolvedValueOnce('origin/feat/in-worktree\norigin/feat/remote-free\n');
      const remoteBranchesRaw = await gitUtils.listRemoteBranches();
      const remoteBranches = remoteBranchesRaw
        .map(b => {
          const slashIdx = b.indexOf('/');
          return slashIdx >= 0 ? b.substring(slashIdx + 1) : b;
        })
        .filter(b => b !== currentBranch && !localSet.has(b) && !worktreeBranches.has(b));
      const uniqueRemote = [...new Set(remoteBranches)];

      const result = [
        ...localBranches.map(name => ({ name, isRemote: false })),
        ...uniqueRemote.map(name => ({ name, isRemote: true })),
      ];

      // feat/in-worktree should be excluded from both lists
      expect(result.map(b => b.name)).toEqual(['feat/free', 'feat/remote-free']);
      expect(result.find(b => b.name === 'feat/in-worktree')).toBeUndefined();
    });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as path from 'path';

// --- Mocks (vi.hoisted ensures these are available when vi.mock factories run) ---
const { mockGitUtils, mockFs, mockExecSync, mockMigrate } = vi.hoisted(() => ({
  mockGitUtils: {
    removeWorktree: vi.fn(),
    deleteBranch: vi.fn(),
    pruneWorktrees: vi.fn(),
    listWorktrees: vi.fn(),
  },
  mockFs: {
    readJSON: vi.fn(),
    readdir: vi.fn(),
    writeJSON: vi.fn(),
    unlinkSync: vi.fn(),
    pathExists: vi.fn(),
    remove: vi.fn(),
  },
  mockExecSync: vi.fn(),
  mockMigrate: vi.fn(),
}));

vi.mock('../utils/git', () => ({
  GitUtils: vi.fn(() => mockGitUtils),
}));

vi.mock('./migration', () => ({
  migrateMetadataToLumiDir: mockMigrate,
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
import { getClonesDir, getRepoStorageDir, METADATA_FILE, SHADOW_CLONES_DIR } from '../constants';

describe('kill', () => {
  const identifier = 'feat/old-feature';
  const rootDir = '/fake/root';
  const targetPath = path.join(getClonesDir(rootDir), identifier);
  const metadataPath = path.join(getRepoStorageDir(rootDir), METADATA_FILE);

  beforeEach(() => {
    vi.clearAllMocks();
    mockGitUtils.removeWorktree.mockResolvedValue(undefined);
    mockGitUtils.deleteBranch.mockResolvedValue(undefined);
    mockGitUtils.listWorktrees.mockResolvedValue([]);
    mockFs.readJSON.mockRejectedValue(new Error('ENOENT'));
    mockFs.writeJSON.mockResolvedValue(undefined);
    mockFs.pathExists.mockResolvedValue(false);
    mockFs.remove.mockResolvedValue(undefined);
    mockFs.readdir.mockRejectedValue(new Error('ENOENT'));
    mockMigrate.mockResolvedValue(false);
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

  it('should gracefully handle removeWorktree failure and still clean up', async () => {
    mockGitUtils.removeWorktree.mockRejectedValue(new Error('worktree not found'));

    // Should NOT throw — graceful fallback to prune
    await kill(identifier, { root: rootDir });

    // Should still prune and delete branch
    expect(mockGitUtils.pruneWorktrees).toHaveBeenCalled();
    expect(mockGitUtils.deleteBranch).toHaveBeenCalledWith('feat/old-feature', true);
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

  // --- Generated prompt cleanup tests ---

  it('should delete generated prompt file when metadata has sourcePrompt in _generated/', async () => {
    mockFs.readJSON.mockResolvedValue({
      'feat/old-feature': {
        baseBranch: 'main',
        sourcePrompt: '_generated/old-feature.md',
      },
    });

    await kill(identifier, { root: rootDir });

    expect(mockFs.unlinkSync).toHaveBeenCalledWith(
      path.join(rootDir, '.prompts', '_generated/old-feature.md'),
    );
    // Metadata should still be cleaned up
    expect(mockFs.writeJSON).toHaveBeenCalledWith(
      metadataPath,
      {},
      { spaces: 2 },
    );
  });

  it('should NOT delete prompt when sourcePrompt is not in _generated/', async () => {
    mockFs.readJSON.mockResolvedValue({
      'feat/old-feature': {
        baseBranch: 'main',
        sourcePrompt: 'user-prompt.md',
      },
    });

    await kill(identifier, { root: rootDir });

    expect(mockFs.unlinkSync).not.toHaveBeenCalled();
    // Metadata should still be cleaned up
    expect(mockFs.writeJSON).toHaveBeenCalled();
  });

  it('should handle already-deleted generated prompt gracefully', async () => {
    mockFs.readJSON.mockResolvedValue({
      'feat/old-feature': {
        baseBranch: 'main',
        sourcePrompt: '_generated/old-feature.md',
      },
    });
    mockFs.unlinkSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });

    // Should not throw
    await kill(identifier, { root: rootDir });

    // Metadata should still be cleaned up
    expect(mockFs.writeJSON).toHaveBeenCalledWith(
      metadataPath,
      {},
      { spaces: 2 },
    );
  });

  // --- Residual directory cleanup tests ---

  it('should clean up residual directory after worktree removal', async () => {
    mockFs.pathExists.mockResolvedValue(true);

    await kill(identifier, { root: rootDir });

    expect(mockFs.pathExists).toHaveBeenCalledWith(targetPath);
    expect(mockFs.remove).toHaveBeenCalledWith(targetPath);
  });

  it('should NOT call remove when no residual directory exists', async () => {
    mockFs.pathExists.mockResolvedValue(false);

    await kill(identifier, { root: rootDir });

    expect(mockFs.pathExists).toHaveBeenCalledWith(targetPath);
    expect(mockFs.remove).not.toHaveBeenCalled();
  });

  // --- Orphan parent directory cleanup tests ---

  it('should clean up empty parent directories for nested branch names', async () => {
    const nestedIdentifier = 'feat/my-feature';
    const nestedTargetPath = path.join(getClonesDir(rootDir), nestedIdentifier);
    const parentPath = path.join(getClonesDir(rootDir), 'feat');

    mockFs.readdir.mockImplementation(async (dir: string) => {
      if (dir === parentPath) return [];
      throw new Error('ENOENT');
    });

    await kill(nestedIdentifier, { root: rootDir });

    expect(mockFs.remove).toHaveBeenCalledWith(parentPath);
  });

  it('should NOT clean up parent directory if it still has siblings', async () => {
    const nestedIdentifier = 'feat/a';
    const parentPath = path.join(getClonesDir(rootDir), 'feat');

    mockFs.readdir.mockImplementation(async (dir: string) => {
      if (dir === parentPath) return [{ name: 'b', isDirectory: () => true }];
      throw new Error('ENOENT');
    });

    await kill(nestedIdentifier, { root: rootDir });

    // The only remove call should NOT be for the parent directory
    const removeCalls = mockFs.remove.mock.calls.map((c: any[]) => c[0]);
    expect(removeCalls).not.toContain(parentPath);
  });

  it('should remove the empty clones root for a flat last branch', async () => {
    const flatIdentifier = 'mybranch';
    const clonesDir = getClonesDir(rootDir);
    mockExecSync.mockReturnValue('mybranch\n');

    // clones root has no remaining worktree subdirs → should be removed
    mockFs.readdir.mockImplementation(async (dir: string) => {
      if (dir === clonesDir) return [];
      throw new Error('ENOENT');
    });

    await kill(flatIdentifier, { root: rootDir });

    expect(mockFs.remove).toHaveBeenCalledWith(clonesDir);
  });

  it('should NOT remove the clones root while other clones remain', async () => {
    const flatIdentifier = 'mybranch';
    const clonesDir = getClonesDir(rootDir);
    mockExecSync.mockReturnValue('mybranch\n');

    // another clone directory still present → root must be preserved
    mockFs.readdir.mockImplementation(async (dir: string) => {
      if (dir === clonesDir) return [{ name: 'other', isDirectory: () => true }];
      throw new Error('ENOENT');
    });

    await kill(flatIdentifier, { root: rootDir });

    const removeCalls = mockFs.remove.mock.calls.map((c: any[]) => c[0]);
    expect(removeCalls).not.toContain(clonesDir);
  });

  it('should handle deeply nested branch names (a/b/c) and remove the empty root', async () => {
    const deepIdentifier = 'a/b/c';
    const clonesDir = getClonesDir(rootDir);
    const parentB = path.join(clonesDir, 'a', 'b');
    const parentA = path.join(clonesDir, 'a');
    mockExecSync.mockReturnValue('a/b/c\n');

    mockFs.readdir.mockImplementation(async (dir: string) => {
      if (dir === parentB || dir === parentA || dir === clonesDir) return [];
      throw new Error('ENOENT');
    });

    await kill(deepIdentifier, { root: rootDir });

    // Both empty parents AND the now-empty clones root should be removed
    expect(mockFs.remove).toHaveBeenCalledWith(parentB);
    expect(mockFs.remove).toHaveBeenCalledWith(parentA);
    expect(mockFs.remove).toHaveBeenCalledWith(clonesDir);
  });

  it('should clean up parent directory containing only .DS_Store (no subdirectories)', async () => {
    const nestedIdentifier = 'feat/ds-store-test';
    const parentPath = path.join(getClonesDir(rootDir), 'feat');

    mockFs.readdir.mockImplementation(async (dir: string) => {
      if (dir === parentPath) return [{ name: '.DS_Store', isDirectory: () => false }];
      throw new Error('ENOENT');
    });

    await kill(nestedIdentifier, { root: rootDir });

    expect(mockFs.remove).toHaveBeenCalledWith(parentPath);
  });

  // --- Legacy .shadow-clones cleanup tests (location-agnostic cleanup) ---

  const legacyContainer = path.join(rootDir, SHADOW_CLONES_DIR);

  it('should clean up empty parent shell and .shadow-clones container after killing a legacy-path worktree', async () => {
    const legacyTarget = path.join(legacyContainer, 'feat', 'x');
    const legacyParent = path.join(legacyContainer, 'feat');
    mockExecSync.mockReturnValue('feat/x\n');
    mockFs.readdir.mockImplementation(async (dir: string) => {
      if (dir === legacyParent || dir === legacyContainer) return [];
      throw new Error('ENOENT');
    });

    await kill('x', { root: rootDir, worktreePath: legacyTarget });

    expect(mockGitUtils.removeWorktree).toHaveBeenCalledWith(legacyTarget, true);
    expect(mockFs.remove).toHaveBeenCalledWith(legacyParent);
    expect(mockFs.remove).toHaveBeenCalledWith(legacyContainer);
  });

  it('should NOT remove .shadow-clones while other legacy clones remain', async () => {
    const legacyTarget = path.join(legacyContainer, 'gone');
    mockExecSync.mockReturnValue('gone\n');
    mockFs.readdir.mockImplementation(async (dir: string) => {
      if (dir === legacyContainer) return [{ name: 'other', isDirectory: () => true }];
      throw new Error('ENOENT');
    });

    await kill('gone', { root: rootDir, worktreePath: legacyTarget });

    const removeCalls = mockFs.remove.mock.calls.map((c: any[]) => c[0]);
    expect(removeCalls).not.toContain(legacyContainer);
  });

  it('should NOT remove .shadow-clones when an unmigrated metadata file remains inside', async () => {
    const legacyTarget = path.join(legacyContainer, 'last-one');
    mockExecSync.mockReturnValue('last-one\n');
    mockFs.readdir.mockImplementation(async (dir: string) => {
      if (dir === legacyContainer) return [{ name: METADATA_FILE, isDirectory: () => false }];
      throw new Error('ENOENT');
    });

    await kill('last-one', { root: rootDir, worktreePath: legacyTarget });

    const removeCalls = mockFs.remove.mock.calls.map((c: any[]) => c[0]);
    expect(removeCalls).not.toContain(legacyContainer);
  });

  it('should remove .shadow-clones when only .DS_Store remains inside', async () => {
    const legacyTarget = path.join(legacyContainer, 'last-one');
    mockExecSync.mockReturnValue('last-one\n');
    mockFs.readdir.mockImplementation(async (dir: string) => {
      if (dir === legacyContainer) return [{ name: '.DS_Store', isDirectory: () => false }];
      throw new Error('ENOENT');
    });

    await kill('last-one', { root: rootDir, worktreePath: legacyTarget });

    expect(mockFs.remove).toHaveBeenCalledWith(legacyContainer);
  });

  it('should skip parent climb and container removal for a custom worktreePath outside known containers', async () => {
    const customPath = '/elsewhere/my-worktree';
    mockExecSync.mockReturnValue('mybranch\n');

    await kill('mybranch', { root: rootDir, worktreePath: customPath });

    expect(mockGitUtils.removeWorktree).toHaveBeenCalledWith(customPath, true);
    // No known container boundary → cleanup never probes or removes directories
    expect(mockFs.readdir).not.toHaveBeenCalled();
    expect(mockFs.remove).not.toHaveBeenCalled();
  });

  it('should not treat a sibling directory sharing the .worktrees prefix as inside the container', async () => {
    // /fake/root.worktrees-backup shares the raw string prefix of /fake/root.worktrees
    const trickyPath = path.join(`${getClonesDir(rootDir)}-backup`, 'mybranch');
    mockExecSync.mockReturnValue('mybranch\n');

    await kill('mybranch', { root: rootDir, worktreePath: trickyPath });

    expect(mockFs.readdir).not.toHaveBeenCalled();
    expect(mockFs.remove).not.toHaveBeenCalled();
  });

  // --- Worktree path resolution (no explicit worktreePath) ---

  const mainEntry = `worktree ${rootDir}\nHEAD aaa\nbranch refs/heads/main`;

  it('should resolve the real worktree path from git when the caller does not pass one', async () => {
    const legacyPath = path.join(legacyContainer, 'feat', 'old-feature');
    mockGitUtils.listWorktrees.mockResolvedValue([
      mainEntry,
      `worktree ${legacyPath}\nHEAD bbb\nbranch refs/heads/feat/old-feature`,
    ]);

    await kill(identifier, { root: rootDir });

    expect(mockGitUtils.removeWorktree).toHaveBeenCalledWith(legacyPath, true);
  });

  it('should resolve by derived dirName when the identifier is not a branch name', async () => {
    const legacyPath = path.join(legacyContainer, 'feat', 'x');
    mockExecSync.mockReturnValue('feat/x\n');
    mockGitUtils.listWorktrees.mockResolvedValue([
      mainEntry,
      `worktree ${legacyPath}\nHEAD bbb\nbranch refs/heads/feat/x`,
    ]);

    await kill('x', { root: rootDir });

    expect(mockGitUtils.removeWorktree).toHaveBeenCalledWith(legacyPath, true);
  });

  it('should fall back to the default path when dirName matches are ambiguous', async () => {
    mockExecSync.mockReturnValue('x\n');
    mockGitUtils.listWorktrees.mockResolvedValue([
      mainEntry,
      `worktree ${path.join(legacyContainer, 'feat', 'x')}\nHEAD bbb\nbranch refs/heads/feat/x`,
      `worktree ${path.join(legacyContainer, 'fix', 'x')}\nHEAD ccc\nbranch refs/heads/fix/x`,
    ]);

    await kill('x', { root: rootDir });

    expect(mockGitUtils.removeWorktree).toHaveBeenCalledWith(
      path.join(getClonesDir(rootDir), 'x'), true,
    );
  });

  it('should never resolve the identifier to the main worktree', async () => {
    mockExecSync.mockReturnValue('main\n');
    mockGitUtils.listWorktrees.mockResolvedValue([mainEntry]);

    await kill('main', { root: rootDir });

    // Falls back to the guessed clone path — the repo root is never a kill target
    expect(mockGitUtils.removeWorktree).toHaveBeenCalledWith(
      path.join(getClonesDir(rootDir), 'main'), true,
    );
  });

  it('should not query git for worktrees when an explicit worktreePath is supplied', async () => {
    await kill(identifier, { root: rootDir, worktreePath: targetPath });

    expect(mockGitUtils.listWorktrees).not.toHaveBeenCalled();
  });

  it('should fall back gracefully when git worktree listing fails', async () => {
    mockGitUtils.listWorktrees.mockRejectedValue(new Error('not a git repo'));

    await kill(identifier, { root: rootDir });

    expect(mockGitUtils.removeWorktree).toHaveBeenCalledWith(targetPath, true);
  });

  // --- Metadata migration chokepoint ---

  it('should migrate metadata to .lumi/ before any container cleanup', async () => {
    const clonesDir = getClonesDir(rootDir);
    mockExecSync.mockReturnValue('mybranch\n');
    mockFs.readdir.mockImplementation(async (dir: string) => {
      if (dir === clonesDir) return [];
      throw new Error('ENOENT');
    });

    await kill('mybranch', { root: rootDir });

    expect(mockMigrate).toHaveBeenCalledWith(rootDir);
    // Migration must run before the container is removed, or an unmigrated
    // metadata file would be deleted with it
    expect(mockMigrate.mock.invocationCallOrder[0]).toBeLessThan(
      mockFs.remove.mock.invocationCallOrder[0],
    );
  });
});

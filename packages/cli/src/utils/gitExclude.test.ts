import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as path from 'path';

const mockFs = vi.hoisted(() => ({
  stat: vi.fn(),
  readFile: vi.fn(),
  appendFile: vi.fn(),
  ensureDir: vi.fn(),
}));

vi.mock('fs-extra', () => ({
  default: mockFs,
  ...mockFs,
}));

import { ensureGitExclude } from './gitExclude';

describe('ensureGitExclude', () => {
  const rootDir = '/fake/root';
  const excludePath = path.join(rootDir, '.git', 'info', 'exclude');

  beforeEach(() => {
    vi.clearAllMocks();
    mockFs.ensureDir.mockResolvedValue(undefined);
    mockFs.appendFile.mockResolvedValue(undefined);
  });

  it('should append missing entries when exclude file exists but lacks them', async () => {
    mockFs.stat.mockResolvedValue({ isFile: () => false });
    mockFs.readFile.mockResolvedValue('# existing content\n*.log\n');

    await ensureGitExclude(rootDir);

    expect(mockFs.appendFile).toHaveBeenCalledWith(
      excludePath,
      expect.stringContaining('.lumi/'),
    );
    expect(mockFs.appendFile).toHaveBeenCalledWith(
      excludePath,
      expect.stringContaining('.agents/rules/lumi-ops-*.md'),
    );
    expect(mockFs.appendFile).toHaveBeenCalledWith(
      excludePath,
      expect.stringContaining('# Lumi-Ops (auto-managed)'),
    );
  });

  it('should be a no-op when all entries already present', async () => {
    mockFs.stat.mockResolvedValue({ isFile: () => false });
    mockFs.readFile.mockResolvedValue('.lumi/\n.agents/rules/lumi-ops-*.md\n');

    await ensureGitExclude(rootDir);

    expect(mockFs.appendFile).not.toHaveBeenCalled();
  });

  it('should only append entries that are missing', async () => {
    mockFs.stat.mockResolvedValue({ isFile: () => false });
    mockFs.readFile.mockResolvedValue('.lumi/\n');

    await ensureGitExclude(rootDir);

    const appendCall = mockFs.appendFile.mock.calls[0];
    const content = appendCall[1] as string;
    expect(content).toContain('.agents/rules/lumi-ops-*.md');
    expect(content).not.toContain('.lumi/');
  });

  it('should create entries when exclude file does not exist', async () => {
    mockFs.stat.mockResolvedValue({ isFile: () => false });
    mockFs.readFile.mockRejectedValue(new Error('ENOENT'));

    await ensureGitExclude(rootDir);

    expect(mockFs.ensureDir).toHaveBeenCalledWith(path.join(rootDir, '.git', 'info'));
    expect(mockFs.appendFile).toHaveBeenCalledWith(
      excludePath,
      expect.stringContaining('.lumi/'),
    );
  });

  it('should handle worktree .git file and resolve to common dir', async () => {
    const worktreeRoot = '/fake/worktree';
    const gitDirTarget = '/fake/root/.git/worktrees/my-branch';
    // commonDir is two levels up from the worktree gitdir => /fake/root/.git
    const commonExcludePath = path.join('/fake/root/.git', 'info', 'exclude');

    mockFs.stat.mockResolvedValue({ isFile: () => true });
    mockFs.readFile.mockImplementation(async (p: string) => {
      if (p === path.join(worktreeRoot, '.git')) {
        return `gitdir: ${gitDirTarget}`;
      }
      // exclude file doesn't exist
      throw new Error('ENOENT');
    });

    await ensureGitExclude(worktreeRoot);

    expect(mockFs.appendFile).toHaveBeenCalledWith(
      commonExcludePath,
      expect.stringContaining('.lumi/'),
    );
  });

  it('should silently return when .git does not exist', async () => {
    mockFs.stat.mockRejectedValue(new Error('ENOENT'));

    await ensureGitExclude(rootDir);

    expect(mockFs.appendFile).not.toHaveBeenCalled();
  });
});

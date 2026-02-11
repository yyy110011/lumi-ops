import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as path from 'path';

// --- Mocks (vi.hoisted ensures these are available when vi.mock factories run) ---
const { mockGitUtils, mockFs } = vi.hoisted(() => ({
  mockGitUtils: {
    isGitRepo: vi.fn(),
    getCurrentBranch: vi.fn(),
    addWorktree: vi.fn(),
    addWorktreeExisting: vi.fn(),
    branchExists: vi.fn(),
  },
  mockFs: {
    ensureDir: vi.fn(),
    pathExists: vi.fn(),
    readFile: vi.fn(),
    readJSON: vi.fn(),
    appendFile: vi.fn(),
    copy: vi.fn(),
    writeFile: vi.fn(),
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
    blue: vi.fn((s: string) => s),
    gray: vi.fn((s: string) => s),
    green: vi.fn((s: string) => s),
  },
}));

// Mock process.exit to prevent test runner from exiting
const mockExit = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);

import { spawn } from './spawn';
import { SHADOW_CLONES_DIR, METADATA_FILE } from '../constants';

describe('spawn', () => {
  const rootDir = '/fake/root';
  const branchName = 'feat/my-feature';
  const shadowDir = path.join(rootDir, SHADOW_CLONES_DIR);
  const targetPath = path.join(shadowDir, branchName);

  beforeEach(() => {
    vi.clearAllMocks();
    mockGitUtils.isGitRepo.mockResolvedValue(true);
    mockGitUtils.getCurrentBranch.mockResolvedValue('main');
    mockGitUtils.addWorktree.mockResolvedValue(undefined);
    mockGitUtils.addWorktreeExisting.mockResolvedValue(undefined);
    mockGitUtils.branchExists.mockResolvedValue(false);
    mockFs.ensureDir.mockResolvedValue(undefined);
    mockFs.pathExists.mockResolvedValue(false);
    mockFs.readFile.mockResolvedValue('');
    mockFs.appendFile.mockResolvedValue(undefined);
    mockFs.copy.mockResolvedValue(undefined);
    mockFs.writeFile.mockResolvedValue(undefined);
    mockFs.writeJSON.mockResolvedValue(undefined);
    mockFs.readJSON.mockRejectedValue(new Error('ENOENT'));
  });

  it('should create shadow clone directory', async () => {
    await spawn(branchName, { root: rootDir });
    expect(mockFs.ensureDir).toHaveBeenCalledWith(shadowDir);
  });

  it('should add .shadow-clones to .gitignore if not present', async () => {
    mockFs.pathExists.mockImplementation(async (p: string) => {
      if (p.endsWith('.gitignore')) return true;
      return false;
    });
    mockFs.readFile.mockResolvedValue('node_modules\ndist\n');

    await spawn(branchName, { root: rootDir });

    expect(mockFs.appendFile).toHaveBeenCalledWith(
      path.join(rootDir, '.gitignore'),
      '.shadow-clones\n',
    );
  });

  it('should NOT append to .gitignore if .shadow-clones already listed', async () => {
    mockFs.pathExists.mockImplementation(async (p: string) => {
      if (p.endsWith('.gitignore')) return true;
      return false;
    });
    mockFs.readFile.mockResolvedValue('node_modules\n.shadow-clones\ndist\n');

    await spawn(branchName, { root: rootDir });

    expect(mockFs.appendFile).not.toHaveBeenCalled();
  });

  it('should create .gitignore if it does not exist', async () => {
    mockFs.pathExists.mockResolvedValue(false);
    mockFs.readFile.mockResolvedValue('');

    await spawn(branchName, { root: rootDir });

    expect(mockFs.appendFile).toHaveBeenCalled();
  });

  it('should create new worktree from current branch when branch does not exist', async () => {
    mockGitUtils.getCurrentBranch.mockResolvedValue('develop');
    mockGitUtils.branchExists.mockResolvedValue(false);

    await spawn(branchName, { root: rootDir });

    expect(mockGitUtils.addWorktree).toHaveBeenCalledWith(branchName, targetPath, 'develop');
    expect(mockGitUtils.addWorktreeExisting).not.toHaveBeenCalled();
  });

  it('should use explicit baseBranch when provided', async () => {
    mockGitUtils.getCurrentBranch.mockResolvedValue('main');
    mockGitUtils.branchExists.mockResolvedValue(false);

    await spawn(branchName, { root: rootDir, baseBranch: 'staging' });

    expect(mockGitUtils.addWorktree).toHaveBeenCalledWith(branchName, targetPath, 'staging');
  });

  it('should write .lumi-metadata.json with baseBranch', async () => {
    mockGitUtils.getCurrentBranch.mockResolvedValue('main');
    mockGitUtils.branchExists.mockResolvedValue(false);

    await spawn(branchName, { root: rootDir, baseBranch: 'develop' });

    expect(mockFs.writeJSON).toHaveBeenCalledWith(
      path.join(shadowDir, METADATA_FILE),
      { [branchName]: { baseBranch: 'develop' } },
      { spaces: 2 },
    );
  });

  it('should write .lumi-metadata.json with current branch when no baseBranch provided', async () => {
    mockGitUtils.getCurrentBranch.mockResolvedValue('main');
    mockGitUtils.branchExists.mockResolvedValue(false);

    await spawn(branchName, { root: rootDir });

    expect(mockFs.writeJSON).toHaveBeenCalledWith(
      path.join(shadowDir, METADATA_FILE),
      { [branchName]: { baseBranch: 'main' } },
      { spaces: 2 },
    );
  });

  it('should attach to existing branch when branch already exists', async () => {
    mockGitUtils.branchExists.mockResolvedValue(true);

    await spawn(branchName, { root: rootDir });

    expect(mockGitUtils.addWorktreeExisting).toHaveBeenCalledWith(targetPath, branchName);
    expect(mockGitUtils.addWorktree).not.toHaveBeenCalled();
  });

  it('should copy .env when it exists', async () => {
    mockFs.pathExists.mockImplementation(async (p: string) => {
      if (p === path.join(rootDir, '.env')) return true;
      if (p.endsWith('.gitignore')) return true;
      return false;
    });
    mockFs.readFile.mockResolvedValue('.shadow-clones\n');

    await spawn(branchName, { root: rootDir });

    expect(mockFs.copy).toHaveBeenCalledWith(
      path.join(rootDir, '.env'),
      path.join(targetPath, '.env'),
    );
  });

  it('should NOT copy .env when it does not exist', async () => {
    mockFs.pathExists.mockResolvedValue(false);

    await spawn(branchName, { root: rootDir });

    expect(mockFs.copy).not.toHaveBeenCalled();
  });

  it('should generate MISSION.md with branch name and description', async () => {
    await spawn(branchName, { root: rootDir, description: 'Build the widget' });

    const writeCall = mockFs.writeFile.mock.calls[0];
    expect(writeCall[0]).toBe(path.join(targetPath, 'MISSION.md'));
    const content = writeCall[1] as string;
    expect(content).toContain('Agent Mission: feat/my-feature');
    expect(content).toContain('Build the widget');
    expect(content).toContain(targetPath);
  });

  it('should NOT generate MISSION.md when no description provided', async () => {
    await spawn(branchName, { root: rootDir });

    // writeFile should not be called at all (no MISSION.md)
    expect(mockFs.writeFile).not.toHaveBeenCalled();
  });

  it('should exit with code 1 when not a git repo', async () => {
    mockGitUtils.isGitRepo.mockResolvedValue(false);

    await spawn(branchName, { root: rootDir });

    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it('should exit with code 1 on general error', async () => {
    mockGitUtils.isGitRepo.mockResolvedValue(true);
    mockGitUtils.addWorktree.mockRejectedValue(new Error('git failed'));

    await spawn(branchName, { root: rootDir });

    expect(mockExit).toHaveBeenCalledWith(1);
  });
});

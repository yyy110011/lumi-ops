import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as path from 'path';
import * as os from 'os';

// --- Mocks (vi.hoisted ensures these are available when vi.mock factories run) ---
const { mockGitUtils, mockFs } = vi.hoisted(() => ({
  mockGitUtils: {
    isGitRepo: vi.fn(),
    getCurrentBranch: vi.fn(),
    hasCommits: vi.fn(),
    addWorktree: vi.fn(),
    addWorktreeExisting: vi.fn(),
    branchExists: vi.fn(),
  },
  mockFs: {
    ensureDir: vi.fn(),
    ensureDirSync: vi.fn(),
    pathExists: vi.fn(),
    readFile: vi.fn(),
    readJSON: vi.fn(),
    readJSONSync: vi.fn(),
    appendFile: vi.fn(),
    copy: vi.fn(),
    writeFile: vi.fn(),
    writeJSON: vi.fn(),
    writeJSONSync: vi.fn(),
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
import { getClonesDir, getRepoStorageDir, METADATA_FILE } from '../constants';

describe('spawn', () => {
  const rootDir = '/fake/root';
  const branchName = 'feat/my-feature';
  const clonesDir = getClonesDir(rootDir);
  const repoStorageDir = getRepoStorageDir(rootDir);
  const targetPath = path.join(clonesDir, branchName);

  beforeEach(() => {
    vi.clearAllMocks();
    mockGitUtils.isGitRepo.mockResolvedValue(true);
    mockGitUtils.getCurrentBranch.mockResolvedValue('main');
    mockGitUtils.hasCommits.mockResolvedValue(true);
    mockGitUtils.addWorktree.mockResolvedValue(undefined);
    mockGitUtils.addWorktreeExisting.mockResolvedValue(undefined);
    mockGitUtils.branchExists.mockResolvedValue(false);
    mockFs.ensureDir.mockResolvedValue(undefined);
    // No longer need to mock pathExists for lumi-ops-id
    mockFs.readFile.mockResolvedValue('');
    mockFs.appendFile.mockResolvedValue(undefined);
    mockFs.copy.mockResolvedValue(undefined);
    mockFs.writeFile.mockResolvedValue(undefined);
    mockFs.writeJSON.mockResolvedValue(undefined);
    mockFs.readJSON.mockRejectedValue(new Error('ENOENT'));
    mockFs.readJSONSync.mockReturnValue({});
  });

  it('should create clones directory', async () => {
    await spawn(branchName, { root: rootDir });
    expect(mockFs.ensureDir).toHaveBeenCalledWith(clonesDir);
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
      path.join(repoStorageDir, METADATA_FILE),
      { [branchName]: { baseBranch: 'develop' } },
      { spaces: 2 },
    );
  });

  it('should write .lumi-metadata.json with current branch when no baseBranch provided', async () => {
    mockGitUtils.getCurrentBranch.mockResolvedValue('main');
    mockGitUtils.branchExists.mockResolvedValue(false);

    await spawn(branchName, { root: rootDir });

    expect(mockFs.writeJSON).toHaveBeenCalledWith(
      path.join(repoStorageDir, METADATA_FILE),
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
      if (p.endsWith('.git')) return true;
      if (p.endsWith('lumi-ops-id')) return true;
      return false;
    });

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
    // New section headers
    expect(content).toContain('## Task');
    expect(content).toContain('## Rules');
    expect(content).toContain('## Instructions');
  });

  it('should NOT generate MISSION.md when no description provided', async () => {
    await spawn(branchName, { root: rootDir });

    // writeFile should not be called at all (no MISSION.md, no .agents/context.md)
    expect(mockFs.writeFile).not.toHaveBeenCalled();
  });

  it('should use custom mission template when provided', async () => {
    const customTemplate = {
      task: '',
      rules: '- Do NOT run tests\n- Use TypeScript strict mode',
      instructions: '1. Read the code\n2. Make changes\n3. Push to remote',
    };

    await spawn(branchName, { root: rootDir, description: 'Custom task', missionTemplate: customTemplate });

    const writeCall = mockFs.writeFile.mock.calls[0];
    const content = writeCall[1] as string;
    expect(content).toContain('Do NOT run tests');
    expect(content).toContain('Push to remote');
    // Should NOT contain default instructions
    expect(content).not.toContain('Conventional Commits');
  });

  it('should fallback to default when no mission template provided', async () => {
    await spawn(branchName, { root: rootDir, description: 'Default task' });

    const writeCall = mockFs.writeFile.mock.calls[0];
    const content = writeCall[1] as string;
    // Should contain default instructions
    expect(content).toContain('Conventional Commits');
    expect(content).toContain('This worktree directory IS your workspace');
  });

  it('should throw when not a git repo', async () => {
    mockGitUtils.isGitRepo.mockResolvedValue(false);

    await expect(spawn(branchName, { root: rootDir })).rejects.toThrow('Not a git repository');
  });

  it('should throw when repo has no commits', async () => {
    mockGitUtils.hasCommits.mockResolvedValue(false);

    await expect(spawn(branchName, { root: rootDir })).rejects.toThrow('no commits');
  });

  it('should throw on general error', async () => {
    mockGitUtils.isGitRepo.mockResolvedValue(true);
    mockGitUtils.addWorktree.mockRejectedValue(new Error('git failed'));

    await expect(spawn(branchName, { root: rootDir })).rejects.toThrow('git failed');
  });

  it('should copy specified folders when copyFolders is provided', async () => {
    mockFs.pathExists.mockImplementation(async (p: string) => {
      if (p === path.join(rootDir, 'config')) return true;
      if (p === path.join(rootDir, 'scripts')) return true;
      return false;
    });

    await spawn(branchName, { root: rootDir, copyFolders: ['config', 'scripts'] });

    expect(mockFs.copy).toHaveBeenCalledWith(
      path.join(rootDir, 'config'),
      path.join(targetPath, 'config'),
    );
    expect(mockFs.copy).toHaveBeenCalledWith(
      path.join(rootDir, 'scripts'),
      path.join(targetPath, 'scripts'),
    );
  });

  it('should skip non-existent folders without error', async () => {
    mockFs.pathExists.mockResolvedValue(false);

    await expect(spawn(branchName, { root: rootDir, copyFolders: ['nonexistent'] })).resolves.not.toThrow();

    // .env copy should not happen (pathExists returns false), and nonexistent folder should be skipped
    expect(mockFs.copy).not.toHaveBeenCalled();
  });

  it('should handle empty copyFolders array', async () => {
    mockFs.pathExists.mockResolvedValue(false);

    await spawn(branchName, { root: rootDir, copyFolders: [] });

    // No additional copies beyond the normal flow
    expect(mockFs.copy).not.toHaveBeenCalled();
  });
});

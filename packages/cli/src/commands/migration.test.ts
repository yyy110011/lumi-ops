import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as path from 'path';
import * as os from 'os';
import { exec } from 'child_process';

// --- Mocks ---
vi.mock('child_process', () => ({
  exec: vi.fn((cmd, cb) => {
    // default success
    cb(null, { stdout: '/fake/.git', stderr: '' });
  }),
}));

// --- Mocks ---
const mockFs = vi.hoisted(() => ({
  existsSync: vi.fn(),
  statSync: vi.fn(),
  ensureDir: vi.fn(),
  move: vi.fn(),
  remove: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  readJSON: vi.fn(),
  writeJSON: vi.fn(),
  readdir: vi.fn(),
  copy: vi.fn(),
  pathExists: vi.fn(),
}));

vi.mock('fs-extra', () => ({
  default: mockFs,
  ...mockFs,
}));


import { hasLegacyClones, migrateLegacyClones } from './migration';
import { SHADOW_CLONES_DIR, getClonesDir, getRepoStorageDir } from '../constants';

const rootDir = '/fake/root';
const legacyDir = path.join(rootDir, SHADOW_CLONES_DIR);
const clonesDir = getClonesDir(rootDir);
const repoStorageDir = getRepoStorageDir(rootDir);

describe('migration', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('hasLegacyClones', () => {
    it('should return true when .shadow-clones/ exists', () => {
      mockFs.existsSync.mockReturnValue(true);
      expect(hasLegacyClones(rootDir)).toBe(true);
      expect(mockFs.existsSync).toHaveBeenCalledWith(legacyDir);
    });

    it('should return false when .shadow-clones/ does not exist', () => {
      mockFs.existsSync.mockReturnValue(false);
      expect(hasLegacyClones(rootDir)).toBe(false);
    });
  });

  describe('migrateLegacyClones', () => {
    it('should return empty results when legacy dir does not exist', async () => {
      mockFs.existsSync.mockReturnValue(false);
      const results = await migrateLegacyClones(rootDir);
      expect(results).toEqual([]);
      expect(mockFs.move).not.toHaveBeenCalled();
    });

    it('should migrate a simple worktree', async () => {
      const oldPath = path.join(legacyDir, 'develop');
      const newPath = path.join(clonesDir, 'develop');
      const gitdirFile = path.join(rootDir, '.git', 'worktrees', 'develop', 'gitdir');

      // Legacy dir exists
      mockFs.existsSync.mockImplementation((p: string) => {
        if (p === legacyDir) return true;
        if (p === path.join(oldPath, '.git')) return true; // worktree .git file
        if (p === gitdirFile) return true; // gitdir file exists
        if (p === path.join(newPath, 'MISSION.md')) return false; // no MISSION.md
        if (p === path.join(legacyDir, '.lumi-metadata.json')) return false;
        if (p === path.join(legacyDir, '.prompts')) return false;
        return false;
      });
      mockFs.pathExists.mockResolvedValue(false); // target does not exist
      mockFs.statSync.mockReturnValue({ isFile: () => true });
      mockFs.readdir.mockResolvedValue([
        { name: 'develop', isDirectory: () => true },
      ]);
      mockFs.readFile.mockResolvedValue(
        `gitdir: ${rootDir}/.git/worktrees/develop`
      );

      const results = await migrateLegacyClones(rootDir);

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({ branch: 'develop', success: true });

      // Should copy directory
      expect(mockFs.copy).toHaveBeenCalledWith(oldPath, newPath, { overwrite: false });

      // Should have verified git worktree
      expect(exec).toHaveBeenCalledWith(
        `git -C "${newPath}" rev-parse --git-dir`,
        expect.any(Function)
      );

      // Should update gitdir
      expect(mockFs.writeFile).toHaveBeenCalledWith(
        gitdirFile,
        path.join(newPath, '.git') + '\n'
      );

      // Should effectively remove old path after successful verify
      expect(mockFs.remove).toHaveBeenCalledWith(oldPath);

      // Should remove legacy dir eventually
      expect(mockFs.remove).toHaveBeenCalledWith(legacyDir);
    });

    it('should migrate a nested branch name (feat/my-feature)', async () => {
      const featDir = path.join(legacyDir, 'feat');
      const oldPath = path.join(featDir, 'my-feature');
      const newPath = path.join(clonesDir, 'feat/my-feature');

      mockFs.existsSync.mockImplementation((p: string) => {
        if (p === legacyDir) return true;
        if (p === path.join(featDir, '.git')) return false; // feat/ is not a worktree
        if (p === path.join(oldPath, '.git')) return true;
        if (p === path.join(rootDir, '.git', 'worktrees', 'my-feature', 'gitdir')) return true;
        if (p === path.join(newPath, 'MISSION.md')) return false;
        if (p === path.join(legacyDir, '.lumi-metadata.json')) return false;
        if (p === path.join(legacyDir, '.prompts')) return false;
        return false;
      });
      mockFs.pathExists.mockResolvedValue(false);
      mockFs.statSync.mockReturnValue({ isFile: () => true });

      // Root readdir returns feat/ directory
      mockFs.readdir.mockImplementation(async (dir: string) => {
        if (dir === legacyDir) {
          return [{ name: 'feat', isDirectory: () => true }];
        }
        if (dir === featDir) {
          return [{ name: 'my-feature', isDirectory: () => true }];
        }
        return [];
      });
      mockFs.readFile.mockResolvedValue(
        `gitdir: ${rootDir}/.git/worktrees/my-feature`
      );

      const results = await migrateLegacyClones(rootDir);

      expect(results).toHaveLength(1);
      expect(results[0].branch).toBe('feat/my-feature');
      expect(mockFs.copy).toHaveBeenCalledWith(oldPath, newPath, { overwrite: false });
      expect(mockFs.remove).toHaveBeenCalledWith(oldPath);
    });

    it('should update MISSION.md path references', async () => {
      const oldPath = path.join(legacyDir, 'develop');
      const newPath = path.join(clonesDir, 'develop');
      const missionContent = `# Mission\n\n- Path: \`${oldPath}\`\n`;

      mockFs.existsSync.mockImplementation((p: string) => {
        if (p === legacyDir) return true;
        if (p === path.join(oldPath, '.git')) return true;
        if (p === path.join(rootDir, '.git', 'worktrees', 'develop', 'gitdir')) return true;
        if (p === path.join(newPath, 'MISSION.md')) return true; // MISSION.md exists
        if (p === path.join(legacyDir, '.lumi-metadata.json')) return false;
        if (p === path.join(legacyDir, '.prompts')) return false;
        return false;
      });
      mockFs.pathExists.mockResolvedValue(false);
      mockFs.statSync.mockReturnValue({ isFile: () => true });
      mockFs.readdir.mockResolvedValue([
        { name: 'develop', isDirectory: () => true },
      ]);
      // First readFile: .git file, second: MISSION.md
      mockFs.readFile.mockImplementation(async (p: string) => {
        if (p.endsWith('.git')) return `gitdir: ${rootDir}/.git/worktrees/develop`;
        if (p.endsWith('MISSION.md')) return missionContent;
        return '';
      });

      await migrateLegacyClones(rootDir);

      // Should write updated MISSION.md with new path
      const writeFileCalls = mockFs.writeFile.mock.calls;
      const missionWrite = writeFileCalls.find(
        (c: any[]) => (c[0] as string).endsWith('MISSION.md')
      );
      expect(missionWrite).toBeTruthy();
      expect(missionWrite![1]).toContain(newPath);
      expect(missionWrite![1]).not.toContain(oldPath);
    });

    it('should merge metadata files during migration', async () => {
      const legacyMetadata = path.join(legacyDir, '.lumi-metadata.json');
      const newMetadata = path.join(repoStorageDir, '.lumi-metadata.json');

      mockFs.existsSync.mockImplementation((p: string) => {
        if (p === legacyDir) return true;
        if (p === legacyMetadata) return true;
        if (p === path.join(legacyDir, 'develop', '.git')) return true;
        if (p === path.join(rootDir, '.git', 'worktrees', 'develop', 'gitdir')) return true;
        if (p === path.join(clonesDir, 'develop', 'MISSION.md')) return false;
        if (p === path.join(legacyDir, '.prompts')) return false;
        return false;
      });
      mockFs.pathExists.mockResolvedValue(false);
      mockFs.statSync.mockReturnValue({ isFile: () => true });
      mockFs.readdir.mockResolvedValue([
        { name: 'develop', isDirectory: () => true },
      ]);
      mockFs.readFile.mockResolvedValue(
        `gitdir: ${rootDir}/.git/worktrees/develop`
      );

      const legacyData = { branch1: { baseBranch: 'main' } };
      const existingData = { branch2: { baseBranch: 'develop' } };

      mockFs.readJSON.mockImplementation(async (p: string) => {
        if (p === newMetadata) return existingData;
        if (p === legacyMetadata) return legacyData;
        throw new Error('not found');
      });

      await migrateLegacyClones(rootDir);

      // Should write merged metadata (new takes precedence)
      expect(mockFs.writeJSON).toHaveBeenCalledWith(
        newMetadata,
        { branch1: { baseBranch: 'main' }, branch2: { baseBranch: 'develop' } },
        { spaces: 2 }
      );
      // Should remove legacy metadata
      expect(mockFs.remove).toHaveBeenCalledWith(legacyMetadata);
    });

    it('should migrate .prompts directory', async () => {
      const legacyPrompts = path.join(legacyDir, '.prompts');
      const newPrompts = path.join(repoStorageDir, '.prompts');

      mockFs.existsSync.mockImplementation((p: string) => {
        if (p === legacyDir) return true;
        if (p === path.join(legacyDir, '.lumi-metadata.json')) return false;
        if (p === legacyPrompts) return true;
        if (p === path.join(legacyDir, 'develop', '.git')) return true;
        if (p === path.join(rootDir, '.git', 'worktrees', 'develop', 'gitdir')) return true;
        if (p === path.join(clonesDir, 'develop', 'MISSION.md')) return false;
        return false;
      });
      mockFs.pathExists.mockResolvedValue(false);
      mockFs.statSync.mockReturnValue({ isFile: () => true });
      mockFs.readdir.mockResolvedValue([
        { name: 'develop', isDirectory: () => true },
      ]);
      mockFs.readFile.mockResolvedValue(
        `gitdir: ${rootDir}/.git/worktrees/develop`
      );

      await migrateLegacyClones(rootDir);

      expect(mockFs.copy).toHaveBeenCalledWith(
        legacyPrompts, newPrompts, { overwrite: false }
      );
      expect(mockFs.remove).toHaveBeenCalledWith(legacyPrompts);
    });

    it('should not move files in dry-run mode', async () => {
      const oldPath = path.join(legacyDir, 'develop');

      mockFs.existsSync.mockImplementation((p: string) => {
        if (p === legacyDir) return true;
        if (p === path.join(oldPath, '.git')) return true;
        return false;
      });
      mockFs.pathExists.mockResolvedValue(false);
      mockFs.statSync.mockReturnValue({ isFile: () => true });
      mockFs.readdir.mockResolvedValue([
        { name: 'develop', isDirectory: () => true },
      ]);
      mockFs.readFile.mockResolvedValue(
        `gitdir: ${rootDir}/.git/worktrees/develop`
      );

      const results = await migrateLegacyClones(rootDir, { dryRun: true });

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(true);
      // Should NOT move or copy or write anything
      expect(mockFs.copy).not.toHaveBeenCalled();
      expect(mockFs.writeFile).not.toHaveBeenCalled();
      expect(mockFs.ensureDir).not.toHaveBeenCalled();
      expect(mockFs.remove).not.toHaveBeenCalled();
    });

    it('should handle move errors gracefully', async () => {
      const oldPath = path.join(legacyDir, 'broken');

      mockFs.existsSync.mockImplementation((p: string) => {
        if (p === legacyDir) return true;
        if (p === path.join(oldPath, '.git')) return true;
        if (p === path.join(legacyDir, '.lumi-metadata.json')) return false;
        if (p === path.join(legacyDir, '.prompts')) return false;
        return false;
      });
      mockFs.statSync.mockReturnValue({ isFile: () => true });
      mockFs.readdir.mockResolvedValue([
        { name: 'broken', isDirectory: () => true },
      ]);
      mockFs.readFile.mockResolvedValue(
        `gitdir: ${rootDir}/.git/worktrees/broken`
      );
      mockFs.copy.mockRejectedValueOnce(new Error('Permission denied'));

      const results = await migrateLegacyClones(rootDir);

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        branch: 'broken',
        success: false,
        error: 'Permission denied',
      });
    });

    it('should skip migration if target path already exists', async () => {
      const oldPath = path.join(legacyDir, 'develop');
      const newPath = path.join(clonesDir, 'develop');
      mockFs.existsSync.mockImplementation((p: string) => {
        if (p === legacyDir) return true;
        if (p === path.join(oldPath, '.git')) return true;
        return false;
      });
      mockFs.statSync.mockReturnValue({ isFile: () => true });
      mockFs.readdir.mockResolvedValue([
        { name: 'develop', isDirectory: () => true },
      ]);
      mockFs.readFile.mockResolvedValue(
        `gitdir: ${rootDir}/.git/worktrees/develop`
      );

      // Target already exists!
      mockFs.pathExists.mockImplementation(async (p: string) => {
        if (p === newPath) return true;
        return false;
      });

      const results = await migrateLegacyClones(rootDir);

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(false);
      expect(results[0].error).toBe('Target exists');
      expect(mockFs.copy).not.toHaveBeenCalled();
    });

    it('should rollback and clean up target if git verification fails', async () => {
      const oldPath = path.join(legacyDir, 'broken');
      const newPath = path.join(clonesDir, 'broken');

      mockFs.existsSync.mockImplementation((p: string) => {
        if (p === legacyDir) return true;
        if (p === path.join(oldPath, '.git')) return true;
        return false;
      });
      mockFs.pathExists.mockResolvedValue(false);
      mockFs.statSync.mockReturnValue({ isFile: () => true });
      mockFs.readdir.mockResolvedValue([
        { name: 'broken', isDirectory: () => true },
      ]);
      mockFs.readFile.mockResolvedValue(
        `gitdir: ${rootDir}/.git/worktrees/broken`
      );
      
      // Make validation fail
      const mockedExec = vi.mocked(exec);
      mockedExec.mockImplementationOnce(((cmd: string, cb: any) => {
        cb(new Error('fatal: not a git path'), { stdout: '', stderr: 'fatal' });
      }) as any);

      const results = await migrateLegacyClones(rootDir);

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(false);
      expect(results[0].error).toContain('Git verification failed');

      // It should have removed newPath
      expect(mockFs.remove).toHaveBeenCalledWith(newPath);
      // It should NOT have removed oldPath
      expect(mockFs.remove).not.toHaveBeenCalledWith(oldPath);
    });
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs-extra';
import { simpleGit, SimpleGit } from 'simple-git';
import { spawn } from '../commands/spawn';
import { kill } from '../commands/kill';
import { list } from '../commands/list';
import { merge } from '../commands/merge';
import { getClonesDir, getRepoStorageDir, METADATA_FILE } from '../constants';

/**
 * E2E tests for @lumi-ops/cli
 *
 * These tests create REAL temporary git repos and perform actual git operations.
 * They are slower than unit tests and are meant for local verification only.
 */

let tmpDir: string;
let git: SimpleGit;

// Suppress process.exit calls from the CLI commands
const originalExit = process.exit;

beforeEach(async () => {
  // Create a real temporary git repo
  // fs.realpathSync resolves macOS /tmp → /private/tmp symlink
  // This ensures paths match between getClonesDir() and git worktree list
  tmpDir = fs.realpathSync(await fs.mkdtemp(path.join(os.tmpdir(), 'lumi-ops-e2e-')));
  // Isolate registry from real ~/.lumi-ops
  process.env.LUMI_OPS_HOME = path.join(tmpDir, '.lumi-ops-test');
  git = simpleGit(tmpDir);

  await git.init();
  await git.addConfig('user.email', 'test@lumi-ops.dev');
  await git.addConfig('user.name', 'Lumi E2E Test');

  // Create an initial commit (git worktree requires at least one commit)
  const readmePath = path.join(tmpDir, 'README.md');
  await fs.writeFile(readmePath, '# Test Repo\n');
  await git.add('.');
  await git.commit('initial commit');

  // Override process.exit to throw instead of killing the test runner
  process.exit = ((code?: number) => {
    throw new Error(`process.exit(${code})`);
  }) as never;
});

afterEach(async () => {
  process.exit = originalExit;
  delete process.env.LUMI_OPS_HOME;
  // Clean up: remove the temp directory, worktrees, and external storage
  try {
    await fs.remove(tmpDir);
  } catch {
    // Best-effort cleanup — Windows/CI may hold locks
  }
  try {
    await fs.remove(`${tmpDir}.worktrees`);
  } catch {
    // Best-effort cleanup
  }
});

// ---------------------------------------------------------------------------
// spawn
// ---------------------------------------------------------------------------
describe('e2e: spawn', () => {
  it('should create a worktree directory under external clones dir', async () => {
    await spawn('feat/e2e-test', { root: tmpDir });

    const worktreePath = path.join(getClonesDir(tmpDir), 'feat/e2e-test');
    expect(await fs.pathExists(worktreePath)).toBe(true);
  });

  it('should create the feature branch', async () => {
    await spawn('feat/branch-check', { root: tmpDir });

    const branches = await git.branchLocal();
    expect(branches.all).toContain('feat/branch-check');
  });

  it('should generate MISSION.md inside the worktree', async () => {
    await spawn('feat/mission-check', { root: tmpDir, description: 'Test objective' });

    const missionPath = path.join(getClonesDir(tmpDir), 'feat/mission-check', '.lumi', 'MISSION.md');
    expect(await fs.pathExists(missionPath)).toBe(true);

    const content = await fs.readFile(missionPath, 'utf-8');
    expect(content).toContain('feat/mission-check');
    expect(content).toContain('Test objective');
  });

  it('should attach to an existing branch instead of creating a new one', async () => {
    // Pre-create a branch with a commit
    await git.checkoutLocalBranch('feat/existing-branch');
    const tempFile = path.join(tmpDir, 'existing.txt');
    await fs.writeFile(tempFile, 'from existing branch\n');
    await git.add('.');
    await git.commit('feat: existing branch commit');
    await git.checkout('main');

    // Spawn should attach to the existing branch, not fail
    await spawn('feat/existing-branch', { root: tmpDir });

    const worktreePath = path.join(getClonesDir(tmpDir), 'feat/existing-branch');
    expect(await fs.pathExists(worktreePath)).toBe(true);

    // The file from the existing branch should be present
    const existingFile = path.join(worktreePath, 'existing.txt');
    expect(await fs.pathExists(existingFile)).toBe(true);
    const content = await fs.readFile(existingFile, 'utf-8');
    expect(content).toBe('from existing branch\n');
  });

  it('should NOT generate MISSION.md when no description is provided', async () => {
    await spawn('feat/no-desc', { root: tmpDir });

    const worktreePath = path.join(getClonesDir(tmpDir), 'feat/no-desc');
    expect(await fs.pathExists(worktreePath)).toBe(true);

    const missionPath = path.join(worktreePath, 'MISSION.md');
    expect(await fs.pathExists(missionPath)).toBe(false);
  });

  it('should record baseBranch in metadata for new branches', async () => {
    await spawn('feat/meta-new', { root: tmpDir, baseBranch: 'main' });

    const metadataPath = path.join(getRepoStorageDir(tmpDir), METADATA_FILE);
    const metadata = await fs.readJSON(metadataPath);
    expect(metadata['feat/meta-new']).toBeDefined();
    expect(metadata['feat/meta-new'].baseBranch).toBe('main');
  });

  it('should NOT record baseBranch for existing branches', async () => {
    // Pre-create a branch
    await git.checkoutLocalBranch('feat/meta-existing');
    await git.checkout('main');

    await spawn('feat/meta-existing', { root: tmpDir });

    const metadataPath = path.join(getRepoStorageDir(tmpDir), METADATA_FILE);
    const metadata = await fs.readJSON(metadataPath);
    expect(metadata['feat/meta-existing']).toBeDefined();
    expect(metadata['feat/meta-existing'].baseBranch).toBeUndefined();
  });

  it('should record custom baseBranch when provided', async () => {
    await git.checkoutLocalBranch('develop');
    await git.checkout('main');

    await spawn('feat/meta-custom-base', { root: tmpDir, baseBranch: 'develop' });

    const metadataPath = path.join(getRepoStorageDir(tmpDir), METADATA_FILE);
    const metadata = await fs.readJSON(metadataPath);
    expect(metadata['feat/meta-custom-base'].baseBranch).toBe('develop');
  });
});

// ---------------------------------------------------------------------------
// merge
// ---------------------------------------------------------------------------
describe('e2e: merge', () => {
  it('should merge worktree changes back to main', async () => {
    const branchName = 'feat/merge-test';
    await spawn(branchName, { root: tmpDir });

    // Make a change inside the worktree
    const worktreePath = path.join(getClonesDir(tmpDir), branchName);
    const newFile = path.join(worktreePath, 'new-feature.txt');
    await fs.writeFile(newFile, 'hello from shadow clone\n');

    const worktreeGit = simpleGit(worktreePath);
    await worktreeGit.add('.');
    await worktreeGit.commit('feat: add new feature file');

    // Merge back to main
    await merge(branchName, { root: tmpDir });

    // Verify the file now exists on main
    const mergedFile = path.join(tmpDir, 'new-feature.txt');
    expect(await fs.pathExists(mergedFile)).toBe(true);
    const content = await fs.readFile(mergedFile, 'utf-8');
    expect(content).toBe('hello from shadow clone\n');
  });

  it('should use custom commitMessage when provided', async () => {
    const branchName = 'feat/custom-msg';
    await spawn(branchName, { root: tmpDir });

    const worktreePath = path.join(getClonesDir(tmpDir), branchName);
    await fs.writeFile(path.join(worktreePath, 'msg-test.txt'), 'custom\n');
    const wtGit = simpleGit(worktreePath);
    await wtGit.add('.');
    await wtGit.commit('feat: for custom msg test');

    await merge(branchName, { root: tmpDir, commitMessage: 'my custom message' });

    // Verify the commit message on main
    const log = await git.log({ maxCount: 1 });
    expect(log.latest?.message).toBe('my custom message');
  });

  it('should merge into a different branch via cwd option', async () => {
    // Create a target branch
    await git.checkoutLocalBranch('develop');
    await git.checkout('main');

    const branchName = 'feat/cwd-merge';
    await spawn(branchName, { root: tmpDir });

    const worktreePath = path.join(getClonesDir(tmpDir), branchName);
    await fs.writeFile(path.join(worktreePath, 'cwd-test.txt'), 'cwd works\n');
    const wtGit = simpleGit(worktreePath);
    await wtGit.add('.');
    await wtGit.commit('feat: cwd test file');

    // Create a worktree for develop to merge into
    const developWT = path.join(getClonesDir(tmpDir), 'develop');
    await git.raw(['worktree', 'add', developWT, 'develop']);

    // Merge into develop via cwd
    await merge(branchName, { root: tmpDir, cwd: developWT });

    // Verify file exists in develop worktree
    expect(await fs.pathExists(path.join(developWT, 'cwd-test.txt'))).toBe(true);

    // Verify file does NOT exist on main
    expect(await fs.pathExists(path.join(tmpDir, 'cwd-test.txt'))).toBe(false);
  });

  it('should throw CONFLICT when merge has conflicts', async () => {
    const branchName = 'feat/conflict-test';
    await spawn(branchName, { root: tmpDir });

    // Modify a file in the clone
    const worktreePath = path.join(getClonesDir(tmpDir), branchName);
    await fs.writeFile(path.join(worktreePath, 'README.md'), 'CLONE version\n');
    const wtGit = simpleGit(worktreePath);
    await wtGit.add('.');
    await wtGit.commit('feat: clone modifies README');

    // Modify the same file on main (conflict)
    await fs.writeFile(path.join(tmpDir, 'README.md'), 'MAIN version\n');
    await git.add('.');
    await git.commit('feat: main modifies README');

    // Merge should throw CONFLICT
    await expect(merge(branchName, { root: tmpDir })).rejects.toThrow('CONFLICT');
  });

  it('should detect conflicts via hasConflicts() after failed merge', async () => {
    const { GitUtils } = await import('../utils/git');
    const branchName = 'feat/detect-conflict';
    await spawn(branchName, { root: tmpDir });

    // Create conflicting changes
    const worktreePath = path.join(getClonesDir(tmpDir), branchName);
    await fs.writeFile(path.join(worktreePath, 'README.md'), 'CLONE side\n');
    const wtGit = simpleGit(worktreePath);
    await wtGit.add('.');
    await wtGit.commit('clone: modify README');

    await fs.writeFile(path.join(tmpDir, 'README.md'), 'MAIN side\n');
    await git.add('.');
    await git.commit('main: modify README');

    // hasConflicts should be false before merge
    const gitUtils = new GitUtils(tmpDir);
    expect(await gitUtils.hasConflicts()).toBe(false);

    // Trigger conflict
    try {
      await merge(branchName, { root: tmpDir });
    } catch {
      // Expected CONFLICT
    }

    // hasConflicts should be true after failed merge
    expect(await gitUtils.hasConflicts()).toBe(true);

    // Resolve conflict and verify auto-clear
    await fs.writeFile(path.join(tmpDir, 'README.md'), 'resolved\n');
    await git.add('.');
    expect(await gitUtils.hasConflicts()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// kill
// ---------------------------------------------------------------------------
describe('e2e: kill', () => {
  it('should remove the worktree directory and delete the branch', async () => {
    const branchName = 'feat/kill-test';
    await spawn(branchName, { root: tmpDir });

    const worktreePath = path.join(getClonesDir(tmpDir), branchName);
    expect(await fs.pathExists(worktreePath)).toBe(true);

    await kill(branchName, { root: tmpDir });

    // Worktree directory should be gone
    expect(await fs.pathExists(worktreePath)).toBe(false);

    // Branch should be deleted
    const branches = await git.branchLocal();
    expect(branches.all).not.toContain(branchName);
  });

  it('should preserve the branch when keepBranch is true', async () => {
    const branchName = 'feat/keep-branch-test';
    await spawn(branchName, { root: tmpDir });

    const worktreePath = path.join(getClonesDir(tmpDir), branchName);
    expect(await fs.pathExists(worktreePath)).toBe(true);

    await kill(branchName, { root: tmpDir, keepBranch: true });

    // Worktree directory should be gone
    expect(await fs.pathExists(worktreePath)).toBe(false);

    // Branch should still exist
    const branches = await git.branchLocal();
    expect(branches.all).toContain(branchName);
  });
});

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------
describe('e2e: list', () => {
  it('should return all spawned shadow clones', async () => {
    await spawn('feat/list-a', { root: tmpDir });
    await spawn('feat/list-b', { root: tmpDir });

    // Capture console.log output
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(' '));

    await list({ root: tmpDir, json: true });

    console.log = originalLog;

    const output = JSON.parse(logs.join(''));
    const shadowBranches = output
      .filter((c: any) => c.isShadow)
      .map((c: any) => c.branch);

    expect(shadowBranches).toContain('feat/list-a');
    expect(shadowBranches).toContain('feat/list-b');
  });
});

// ---------------------------------------------------------------------------
// Full lifecycle
// ---------------------------------------------------------------------------
describe('e2e: full lifecycle', () => {
  it('spawn → make changes → merge → kill (happy path)', async () => {
    const branchName = 'feat/lifecycle';

    // 1. Spawn
    await spawn(branchName, { root: tmpDir, description: 'Lifecycle test' });
    const worktreePath = path.join(getClonesDir(tmpDir), branchName);
    expect(await fs.pathExists(worktreePath)).toBe(true);

    // 2. Make changes in the worktree
    const featureFile = path.join(worktreePath, 'lifecycle.txt');
    await fs.writeFile(featureFile, 'lifecycle works\n');
    const worktreeGit = simpleGit(worktreePath);
    await worktreeGit.add('.');
    await worktreeGit.commit('feat: add lifecycle file');

    // 3. Merge back to main
    await merge(branchName, { root: tmpDir });
    const mergedFile = path.join(tmpDir, 'lifecycle.txt');
    expect(await fs.pathExists(mergedFile)).toBe(true);
    expect(await fs.readFile(mergedFile, 'utf-8')).toBe('lifecycle works\n');

    // 4. Kill
    await kill(branchName, { root: tmpDir });
    expect(await fs.pathExists(worktreePath)).toBe(false);
    const branches = await git.branchLocal();
    expect(branches.all).not.toContain(branchName);
  });
});

// ---------------------------------------------------------------------------
// symlink resolution
// ---------------------------------------------------------------------------
describe('e2e: symlink resolution', () => {
  let symlinkDir: string;

  afterEach(async () => {
    try { await fs.remove(symlinkDir); } catch {}
  });

  it('should detect shadow clones when workspace is opened via symlink', async () => {
    const { parseWorktrees } = await import('../commands/list');
    const { GitUtils } = await import('../utils/git');

    // Create a symlink to the real repo (simulates ~/app -> /mnt/data/app)
    symlinkDir = path.join(path.dirname(tmpDir), 'symlink-test-' + Date.now());
    await fs.ensureSymlink(tmpDir, symlinkDir);

    // Spawn a clone using the REAL path
    await spawn('feat/symlink-test', { root: tmpDir });

    // Simulate extension using symlink path as rootPath
    const git = new GitUtils(symlinkDir);
    const worktreesRaw = await git.listWorktrees();

    // With index-based detection, isShadow is correct regardless of symlink vs real path
    const clonesViaSym = parseWorktrees(worktreesRaw, symlinkDir);
    const shadowViaSym = clonesViaSym.filter(c => c.isShadow);
    expect(shadowViaSym).toHaveLength(1);
    expect(shadowViaSym[0].branch).toBe('feat/symlink-test');

    // Real path also works identically
    const resolvedPath = fs.realpathSync(symlinkDir);
    const clonesViaReal = parseWorktrees(worktreesRaw, resolvedPath);
    const shadowViaReal = clonesViaReal.filter(c => c.isShadow);
    expect(shadowViaReal).toHaveLength(1);
    expect(shadowViaReal[0].branch).toBe('feat/symlink-test');
  });
});

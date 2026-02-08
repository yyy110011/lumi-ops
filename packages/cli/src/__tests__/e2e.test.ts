import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs-extra';
import { simpleGit, SimpleGit } from 'simple-git';
import { spawn } from '../commands/spawn';
import { kill } from '../commands/kill';
import { list } from '../commands/list';
import { merge } from '../commands/merge';

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
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lumi-ops-e2e-'));
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
  // Clean up: remove the temp directory
  try {
    await fs.remove(tmpDir);
  } catch {
    // Best-effort cleanup — Windows/CI may hold locks
  }
});

// ---------------------------------------------------------------------------
// spawn
// ---------------------------------------------------------------------------
describe('e2e: spawn', () => {
  it('should create a worktree directory under .shadow-clones/', async () => {
    await spawn('feat/e2e-test', { root: tmpDir });

    const worktreePath = path.join(tmpDir, '.shadow-clones', 'feat/e2e-test');
    expect(await fs.pathExists(worktreePath)).toBe(true);
  });

  it('should create the feature branch', async () => {
    await spawn('feat/branch-check', { root: tmpDir });

    const branches = await git.branchLocal();
    expect(branches.all).toContain('feat/branch-check');
  });

  it('should generate MISSION.md inside the worktree', async () => {
    await spawn('feat/mission-check', { root: tmpDir, description: 'Test objective' });

    const missionPath = path.join(tmpDir, '.shadow-clones', 'feat/mission-check', 'MISSION.md');
    expect(await fs.pathExists(missionPath)).toBe(true);

    const content = await fs.readFile(missionPath, 'utf-8');
    expect(content).toContain('feat/mission-check');
    expect(content).toContain('Test objective');
  });

  it('should add .shadow-clones to .gitignore', async () => {
    await spawn('feat/gitignore-check', { root: tmpDir });

    const gitignorePath = path.join(tmpDir, '.gitignore');
    expect(await fs.pathExists(gitignorePath)).toBe(true);

    const content = await fs.readFile(gitignorePath, 'utf-8');
    expect(content).toContain('.shadow-clones');
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
    const worktreePath = path.join(tmpDir, '.shadow-clones', branchName);
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
});

// ---------------------------------------------------------------------------
// kill
// ---------------------------------------------------------------------------
describe('e2e: kill', () => {
  it('should remove the worktree directory and delete the branch', async () => {
    const branchName = 'feat/kill-test';
    await spawn(branchName, { root: tmpDir });

    const worktreePath = path.join(tmpDir, '.shadow-clones', branchName);
    expect(await fs.pathExists(worktreePath)).toBe(true);

    await kill(branchName, { root: tmpDir });

    // Worktree directory should be gone
    expect(await fs.pathExists(worktreePath)).toBe(false);

    // Branch should be deleted
    const branches = await git.branchLocal();
    expect(branches.all).not.toContain(branchName);
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
    const worktreePath = path.join(tmpDir, '.shadow-clones', branchName);
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

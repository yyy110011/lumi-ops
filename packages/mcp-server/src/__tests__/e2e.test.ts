import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { execFileSync } from 'child_process';
import { simpleGit, SimpleGit } from 'simple-git';
import {
  spawn,
  kill,
  list,
  merge,
  parseWorktrees,
  GitUtils,
  getClonesDir,
  getRepoStorageDir,
  METADATA_FILE,
  setCloneStatus,
  requestRevision,
  readMetadata,
} from '@lumi-ops/cli';

/**
 * E2E tests for @lumi-ops/mcp-server
 *
 * These tests call CLI functions directly (the same functions the MCP tools wrap)
 * against REAL temporary git repos, verifying the full CLI → git pipeline.
 *
 * They mirror the approach of packages/cli/src/__tests__/e2e.test.ts.
 */

let tmpDir: string;
let git: SimpleGit;

// Suppress process.exit calls from the CLI commands
const originalExit = process.exit;

beforeEach(async () => {
  // Create a real temporary git repo
  // fs.realpathSync resolves macOS /tmp → /private/tmp symlink
  tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lumi-mcp-e2e-')));
  // Isolate registry from real ~/.lumi-ops
  process.env.LUMI_OPS_HOME = path.join(tmpDir, '.lumi-ops-test');
  git = simpleGit(tmpDir);

  await git.init();
  await git.addConfig('user.email', 'test@lumi-ops.dev');
  await git.addConfig('user.name', 'Lumi MCP E2E Test');

  // Create an initial commit (git worktree requires at least one commit)
  const readmePath = path.join(tmpDir, 'README.md');
  fs.writeFileSync(readmePath, '# Test Repo\n');
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
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup
  }
  try {
    fs.rmSync(`${tmpDir}.worktrees`, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup
  }
});

// ---------------------------------------------------------------------------
// Test 1: spawn → list → kill lifecycle
// ---------------------------------------------------------------------------
describe('e2e: spawn → list → kill lifecycle', () => {
  it('should create a clone, list it, then remove it', async () => {
    const branchName = 'feat/mcp-lifecycle';

    // 1. Spawn
    await spawn(branchName, { root: tmpDir, description: 'MCP lifecycle test' });

    const worktreePath = path.join(getClonesDir(tmpDir), branchName);
    expect(fs.existsSync(worktreePath)).toBe(true);

    // 2. List — capture console.log output
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(' '));

    await list({ root: tmpDir, json: true });

    console.log = originalLog;

    const output = JSON.parse(logs.join(''));
    const shadowClones = output.filter((c: any) => c.isShadow);
    const ourClone = shadowClones.find((c: any) => c.branch === branchName);
    expect(ourClone).toBeDefined();
    expect(ourClone.branch).toBe(branchName);

    // 3. Kill
    await kill(branchName, { root: tmpDir });

    expect(fs.existsSync(worktreePath)).toBe(false);
    const branches = await git.branchLocal();
    expect(branches.all).not.toContain(branchName);
  });
});

// ---------------------------------------------------------------------------
// Test 2: spawn → set_status → review
// ---------------------------------------------------------------------------
describe('e2e: spawn → set_status → review', () => {
  it('should set review status in metadata and verify review data', async () => {
    const branchName = 'feat/mcp-review';

    // 1. Spawn with a description
    await spawn(branchName, { root: tmpDir, description: 'Review flow test' });

    const worktreePath = path.join(getClonesDir(tmpDir), branchName);
    expect(fs.existsSync(worktreePath)).toBe(true);

    // 2. Make a commit in the worktree (so review has something to show)
    const featureFile = path.join(worktreePath, 'feature.ts');
    fs.writeFileSync(featureFile, 'export const hello = "world";\n');
    const worktreeGit = simpleGit(worktreePath);
    await worktreeGit.add('.');
    await worktreeGit.commit('feat: add feature file');

    // 3. Set reviewStatus to needsReview using CLI function
    await setCloneStatus(branchName, 'needsReview', { root: tmpDir });

    // 4. Verify metadata was written correctly
    const metadata = await readMetadata(tmpDir);
    expect(metadata[branchName].reviewStatus).toBe('needsReview');

    // 5. Simulate review_clone: get diff stats and commits
    const gitUtils = new GitUtils(tmpDir);
    const rawEntries = await gitUtils.listWorktrees();
    const clones = parseWorktrees(rawEntries, tmpDir);
    const clone = clones.find((c) => c.branch === branchName);
    expect(clone).toBeDefined();

    // Get commits (same as review_clone tool)
    const logRaw = execFileSync('git', ['log', '--oneline', `HEAD..${branchName}`], {
      cwd: tmpDir,
      encoding: 'utf-8',
    });
    const commits = logRaw
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const spaceIdx = line.indexOf(' ');
        return {
          hash: line.substring(0, spaceIdx),
          message: line.substring(spaceIdx + 1),
        };
      });

    expect(commits.length).toBeGreaterThanOrEqual(1);
    expect(commits.some((c) => c.message.includes('add feature file'))).toBe(true);

    // Get diff stat
    const diffStatRaw = execFileSync('git', ['diff', '--numstat', `HEAD...${branchName}`], {
      cwd: tmpDir,
      encoding: 'utf-8',
    });
    expect(diffStatRaw).toContain('feature.ts');
  });
});

// ---------------------------------------------------------------------------
// Test 3: spawn → make changes → merge
// ---------------------------------------------------------------------------
describe('e2e: spawn → make changes → merge', () => {
  it('should merge worktree changes back to the base branch', async () => {
    const branchName = 'feat/mcp-merge';

    // 1. Spawn
    await spawn(branchName, { root: tmpDir });

    const worktreePath = path.join(getClonesDir(tmpDir), branchName);
    expect(fs.existsSync(worktreePath)).toBe(true);

    // 2. Make changes in the worktree
    const newFile = path.join(worktreePath, 'mcp-feature.txt');
    fs.writeFileSync(newFile, 'hello from MCP e2e test\n');
    const worktreeGit = simpleGit(worktreePath);
    await worktreeGit.add('.');
    await worktreeGit.commit('feat: add MCP feature file');

    // 3. Verify clone appears in list
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(' '));
    await list({ root: tmpDir, json: true });
    console.log = originalLog;

    const output = JSON.parse(logs.join(''));
    const shadowBranches = output
      .filter((c: any) => c.isShadow)
      .map((c: any) => c.branch);
    expect(shadowBranches).toContain(branchName);

    // 4. Merge back to main
    await merge(branchName, { root: tmpDir });

    // 5. Verify the file now exists on main
    const mergedFile = path.join(tmpDir, 'mcp-feature.txt');
    expect(fs.existsSync(mergedFile)).toBe(true);
    const content = fs.readFileSync(mergedFile, 'utf-8');
    expect(content).toBe('hello from MCP e2e test\n');
  });
});

// ---------------------------------------------------------------------------
// Test 4: request_revision flow
// ---------------------------------------------------------------------------
describe('e2e: request_revision flow', () => {
  it('should write feedback file and set needsRevision status', async () => {
    const branchName = 'feat/mcp-revision';
    const feedbackText = 'Please fix the error handling in the main function.';

    // 1. Spawn
    await spawn(branchName, { root: tmpDir, description: 'Revision test' });

    const worktreePath = path.join(getClonesDir(tmpDir), branchName);
    expect(fs.existsSync(worktreePath)).toBe(true);

    // 2. Use CLI requestRevision function
    const { feedbackPath } = await requestRevision(branchName, feedbackText, { root: tmpDir });

    // 3. Verify feedback file exists with correct content
    expect(fs.existsSync(feedbackPath)).toBe(true);
    const writtenFeedback = fs.readFileSync(feedbackPath, 'utf-8');
    expect(writtenFeedback).toContain(feedbackText);
    expect(writtenFeedback).toContain('# Review Feedback');

    // 4. Verify metadata has needsRevision
    const metadata = await readMetadata(tmpDir);
    expect(metadata[branchName].reviewStatus).toBe('needsRevision');
  });
});

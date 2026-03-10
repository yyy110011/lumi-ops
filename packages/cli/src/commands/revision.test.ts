import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs-extra';
import { simpleGit } from 'simple-git';
import { requestRevision } from './revision';
import { readMetadata } from './metadata';
import { getClonesDir } from '../constants';

let tmpDir: string;

// Suppress process.exit calls from CLI commands
const originalExit = process.exit;

beforeEach(async () => {
  tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lumi-revision-test-')));
  process.env.LUMI_OPS_HOME = path.join(tmpDir, '.lumi-ops-test');

  // Create a real git repo (worktree operations need it)
  const git = simpleGit(tmpDir);
  await git.init();
  await git.addConfig('user.email', 'test@lumi-ops.dev');
  await git.addConfig('user.name', 'Lumi Revision Test');
  const readmePath = path.join(tmpDir, 'README.md');
  fs.writeFileSync(readmePath, '# Test Repo\n');
  await git.add('.');
  await git.commit('initial commit');

  process.exit = ((code?: number) => {
    throw new Error(`process.exit(${code})`);
  }) as never;
});

afterEach(async () => {
  process.exit = originalExit;
  delete process.env.LUMI_OPS_HOME;
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch { /* best-effort */ }
  try {
    fs.rmSync(`${tmpDir}.worktrees`, { recursive: true, force: true });
  } catch { /* best-effort */ }
});

describe('requestRevision', () => {
  it('should write feedback file and set needsRevision status', async () => {
    const branchName = 'feat/revision-test';
    const feedbackText = 'Please fix the error handling.';

    // Spawn a worktree manually
    const { spawn } = await import('./spawn');
    await spawn(branchName, { root: tmpDir, description: 'Revision test' });

    const worktreePath = path.join(getClonesDir(tmpDir), branchName);
    expect(fs.existsSync(worktreePath)).toBe(true);

    // Call requestRevision
    const result = await requestRevision(branchName, feedbackText, { root: tmpDir });

    // Verify feedback file
    expect(fs.existsSync(result.feedbackPath)).toBe(true);
    const content = fs.readFileSync(result.feedbackPath, 'utf-8');
    expect(content).toContain('# Review Feedback');
    expect(content).toContain(feedbackText);
    expect(content).toContain('.lumi/MISSION.md');

    // Verify metadata
    const metadata = await readMetadata(tmpDir);
    expect(metadata[branchName].reviewStatus).toBe('needsRevision');
  });

  it('should throw when branch worktree does not exist', async () => {
    await expect(
      requestRevision('feat/nonexistent', 'some feedback', { root: tmpDir }),
    ).rejects.toThrow(/no worktree found/i);
  });

  it('should overwrite existing feedback file', async () => {
    const branchName = 'feat/overwrite-test';

    const { spawn } = await import('./spawn');
    await spawn(branchName, { root: tmpDir, description: 'Overwrite test' });

    // First revision
    await requestRevision(branchName, 'First round feedback', { root: tmpDir });

    // Second revision — should overwrite
    const result = await requestRevision(branchName, 'Second round feedback', { root: tmpDir });

    const content = fs.readFileSync(result.feedbackPath, 'utf-8');
    expect(content).toContain('Second round feedback');
    expect(content).not.toContain('First round feedback');
  });

  it('should return correct feedbackPath', async () => {
    const branchName = 'feat/path-test';

    const { spawn } = await import('./spawn');
    await spawn(branchName, { root: tmpDir, description: 'Path test' });

    const worktreePath = path.join(getClonesDir(tmpDir), branchName);
    const result = await requestRevision(branchName, 'test', { root: tmpDir });

    expect(result.feedbackPath).toBe(path.join(worktreePath, '.lumi', 'REVIEW_FEEDBACK.md'));
  });
});

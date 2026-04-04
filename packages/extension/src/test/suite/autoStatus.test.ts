import * as assert from 'assert';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

suite('AutoStatus — deriveCloneId', () => {
  const extensionId = 'ZunRenYao.lumi-ops';
  let deriveCloneId: (wtPath: string) => string | undefined;

  suiteSetup(async () => {
    const extension = vscode.extensions.getExtension(extensionId)!;
    const exports = await extension.activate();
    assert.ok(exports.deriveCloneId, 'Extension should export deriveCloneId');
    deriveCloneId = exports.deriveCloneId;
  });

  test('extracts clone ID from standard worktree path', () => {
    assert.strictEqual(
      deriveCloneId('/repo.worktrees/feat/my-task'),
      'feat/my-task'
    );
  });

  test('handles simple branch names', () => {
    assert.strictEqual(
      deriveCloneId('/repo.worktrees/fix-bug'),
      'fix-bug'
    );
  });

  test('handles deeply nested paths', () => {
    assert.strictEqual(
      deriveCloneId('/home/user/project.worktrees/feat/deep/nested'),
      'feat/deep/nested'
    );
  });

  test('returns undefined when no .worktrees/ marker present', () => {
    assert.strictEqual(
      deriveCloneId('/home/user/project'),
      undefined
    );
  });

  test('returns undefined for empty string', () => {
    assert.strictEqual(deriveCloneId(''), undefined);
  });

  test('handles path with only .worktrees/ marker and trailing content', () => {
    assert.strictEqual(
      deriveCloneId('/a.worktrees/b'),
      'b'
    );
  });
});

suite('AutoStatus — setStatusIfApplicable', () => {
  const extensionId = 'ZunRenYao.lumi-ops';
  let setStatusIfApplicable: (
    mainRepoRoot: string,
    cloneId: string,
    newStatus: string,
    eligibleFrom: string[]
  ) => boolean;

  let tmpDir: string;

  suiteSetup(async () => {
    const extension = vscode.extensions.getExtension(extensionId)!;
    const exports = await extension.activate();
    assert.ok(exports.setStatusIfApplicable, 'Extension should export setStatusIfApplicable');
    setStatusIfApplicable = exports.setStatusIfApplicable;
  });

  setup(() => {
    // Create a temp directory that mimics a repo root.
    // getRepoStorageDir(root) returns `${root}.worktrees`
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumi-test-'));
    const storageDir = `${tmpDir}.worktrees`;
    fs.mkdirSync(storageDir, { recursive: true });
  });

  teardown(() => {
    // Clean up temp dirs
    const storageDir = `${tmpDir}.worktrees`;
    const metadataPath = path.join(storageDir, '.lumi-metadata.json');
    try { fs.unlinkSync(metadataPath); } catch { /* ignore */ }
    try { fs.rmdirSync(storageDir); } catch { /* ignore */ }
    try { fs.rmdirSync(tmpDir); } catch { /* ignore */ }
  });

  function writeMetadata(data: Record<string, any>) {
    const metadataPath = path.join(`${tmpDir}.worktrees`, '.lumi-metadata.json');
    fs.writeFileSync(metadataPath, JSON.stringify(data, null, 2));
  }

  function readMetadata(): Record<string, any> {
    const metadataPath = path.join(`${tmpDir}.worktrees`, '.lumi-metadata.json');
    return JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
  }

  test('transitions from todo to inProgress', () => {
    writeMetadata({ 'feat/test': { reviewStatus: 'todo' } });
    const result = setStatusIfApplicable(tmpDir, 'feat/test', 'inProgress', ['todo']);
    assert.strictEqual(result, true, 'Should return true for eligible transition');
    assert.strictEqual(readMetadata()['feat/test'].reviewStatus, 'inProgress');
  });

  test('transitions from undefined (missing) reviewStatus', () => {
    writeMetadata({ 'feat/test': { parentBranch: 'main' } });
    const result = setStatusIfApplicable(tmpDir, 'feat/test', 'inProgress', ['todo']);
    assert.strictEqual(result, true, 'Missing reviewStatus counts as eligible');
    assert.strictEqual(readMetadata()['feat/test'].reviewStatus, 'inProgress');
  });

  test('does NOT transition from done', () => {
    writeMetadata({ 'feat/test': { reviewStatus: 'done' } });
    const result = setStatusIfApplicable(tmpDir, 'feat/test', 'inProgress', ['todo']);
    assert.strictEqual(result, false, 'done is not in eligibleFrom');
    assert.strictEqual(readMetadata()['feat/test'].reviewStatus, 'done', 'Status should remain done');
  });

  test('does NOT transition from needsRevision', () => {
    writeMetadata({ 'feat/test': { reviewStatus: 'needsRevision' } });
    const result = setStatusIfApplicable(tmpDir, 'feat/test', 'inProgress', ['todo']);
    assert.strictEqual(result, false, 'needsRevision is not in eligibleFrom');
    assert.strictEqual(
      readMetadata()['feat/test'].reviewStatus,
      'needsRevision',
      'Status should remain needsRevision'
    );
  });

  test('does NOT transition from inProgress when only todo is eligible', () => {
    writeMetadata({ 'feat/test': { reviewStatus: 'inProgress' } });
    const result = setStatusIfApplicable(tmpDir, 'feat/test', 'inProgress', ['todo']);
    assert.strictEqual(result, false);
  });

  test('returns false when metadata file is missing', () => {
    const result = setStatusIfApplicable('/nonexistent-path-xyz', 'feat/test', 'inProgress', ['todo']);
    assert.strictEqual(result, false);
  });

  test('returns false when clone entry does not exist in metadata', () => {
    writeMetadata({});
    const result = setStatusIfApplicable(tmpDir, 'feat/nonexistent', 'inProgress', ['todo']);
    assert.strictEqual(result, false);
  });
});

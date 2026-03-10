import * as assert from 'assert';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

suite('PromptLibraryProvider', () => {
  const extensionId = 'ZunRenYao.lumi-ops';
  let promptLibraryProvider: any;
  let tmpDir: string;
  let projectPromptsDir: string;
  let globalPromptsDir: string;
  let originalProjectDir: any;

  suiteSetup(async () => {
    const extension = vscode.extensions.getExtension(extensionId)!;
    const exports = await extension.activate();
    assert.ok(exports.promptLibraryProvider, 'Extension should export promptLibraryProvider');
    promptLibraryProvider = exports.promptLibraryProvider;

    // Save original state
    originalProjectDir = (promptLibraryProvider as any).projectDir;
  });

  setup(() => {
    // Create isolated temp directories for each test
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumi-prompt-test-'));
    projectPromptsDir = path.join(tmpDir, 'project', '.prompts');
    globalPromptsDir = path.join(tmpDir, 'global', '.prompts');
    fs.mkdirSync(projectPromptsDir, { recursive: true });
    fs.mkdirSync(globalPromptsDir, { recursive: true });

    // Point the provider to our temp directories
    promptLibraryProvider.setProjectRoot(vscode.Uri.file(path.join(tmpDir, 'project')));
    (promptLibraryProvider as any).globalDir = vscode.Uri.file(globalPromptsDir);
  });

  teardown(() => {
    // Restore original project directory
    (promptLibraryProvider as any).projectDir = originalProjectDir;

    // Clean up temp directory
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  test('listPrompts returns empty array when no prompts exist', async () => {
    const prompts = await promptLibraryProvider.listPrompts(['project']);
    assert.ok(Array.isArray(prompts), 'Should return an array');
    assert.strictEqual(prompts.length, 0, 'Should be empty when no prompts exist');
  });

  test('listPrompts finds project-scope prompts', async () => {
    // Create a prompt file
    fs.writeFileSync(
      path.join(projectPromptsDir, 'test-prompt.md'),
      '# Test Prompt\nThis is a test prompt.'
    );

    const prompts = await promptLibraryProvider.listPrompts(['project']);
    assert.strictEqual(prompts.length, 1, 'Should find one prompt');
    assert.strictEqual(prompts[0].name, 'test-prompt', 'Name should strip .md extension');
    assert.strictEqual(prompts[0].fileName, 'test-prompt.md');
    assert.strictEqual(prompts[0].scope, 'project');
  });

  test('listPrompts finds global-scope prompts', async () => {
    fs.writeFileSync(
      path.join(globalPromptsDir, 'global-prompt.md'),
      '# Global Prompt\nShared across projects.'
    );

    const prompts = await promptLibraryProvider.listPrompts(['global']);
    assert.strictEqual(prompts.length, 1, 'Should find one global prompt');
    assert.strictEqual(prompts[0].name, 'global-prompt');
    assert.strictEqual(prompts[0].scope, 'global');
  });

  test('listPrompts returns both scopes combined', async () => {
    fs.writeFileSync(
      path.join(projectPromptsDir, 'proj.md'),
      '# Project'
    );
    fs.writeFileSync(
      path.join(globalPromptsDir, 'glob.md'),
      '# Global'
    );

    const prompts = await promptLibraryProvider.listPrompts(['project', 'global']);
    assert.strictEqual(prompts.length, 2, 'Should find prompts from both scopes');
    // Sorted alphabetically by name
    assert.strictEqual(prompts[0].name, 'glob');
    assert.strictEqual(prompts[1].name, 'proj');
  });

  test('listPrompts ignores non-md files', async () => {
    fs.writeFileSync(path.join(projectPromptsDir, 'readme.txt'), 'Not a prompt');
    fs.writeFileSync(path.join(projectPromptsDir, 'real-prompt.md'), '# Real');

    const prompts = await promptLibraryProvider.listPrompts(['project']);
    assert.strictEqual(prompts.length, 1, 'Should only return .md files');
    assert.strictEqual(prompts[0].fileName, 'real-prompt.md');
  });

  test('prompt preview extracts first non-empty line', async () => {
    fs.writeFileSync(
      path.join(projectPromptsDir, 'with-preview.md'),
      '\n\n# My Prompt Title\nContent here.'
    );

    const prompts = await promptLibraryProvider.listPrompts(['project']);
    assert.strictEqual(prompts.length, 1);
    // Preview strips leading # markers
    assert.strictEqual(prompts[0].preview, 'My Prompt Title');
  });

  test('savePrompt creates a new prompt file', async () => {
    await promptLibraryProvider.savePrompt('new-prompt', '# New Prompt\nContent.', 'project');

    const filePath = path.join(projectPromptsDir, 'new-prompt.md');
    assert.ok(fs.existsSync(filePath), 'File should be created');

    const content = fs.readFileSync(filePath, 'utf-8');
    assert.strictEqual(content, '# New Prompt\nContent.');
  });

  test('savePrompt overwrites existing prompt', async () => {
    fs.writeFileSync(path.join(projectPromptsDir, 'existing.md'), 'Old content');

    await promptLibraryProvider.savePrompt('existing', 'New content', 'project');

    const content = fs.readFileSync(path.join(projectPromptsDir, 'existing.md'), 'utf-8');
    assert.strictEqual(content, 'New content');
  });

  test('deletePrompt removes the file', async () => {
    const filePath = path.join(projectPromptsDir, 'to-delete.md');
    fs.writeFileSync(filePath, '# Delete me');
    assert.ok(fs.existsSync(filePath), 'File should exist before delete');

    await promptLibraryProvider.deletePrompt('to-delete.md', 'project');

    assert.ok(!fs.existsSync(filePath), 'File should be deleted');
  });

  test('deletePrompt then listPrompts shows removal', async () => {
    fs.writeFileSync(path.join(projectPromptsDir, 'a.md'), '# A');
    fs.writeFileSync(path.join(projectPromptsDir, 'b.md'), '# B');

    let prompts = await promptLibraryProvider.listPrompts(['project']);
    assert.strictEqual(prompts.length, 2, 'Should start with 2 prompts');

    await promptLibraryProvider.deletePrompt('a.md', 'project');

    prompts = await promptLibraryProvider.listPrompts(['project']);
    assert.strictEqual(prompts.length, 1, 'Should have 1 prompt after delete');
    assert.strictEqual(prompts[0].name, 'b');
  });

  test('getPromptContent reads file content', async () => {
    const expectedContent = '# Full Content\n\nWith multiple lines.\n\n- Item 1\n- Item 2';
    fs.writeFileSync(path.join(projectPromptsDir, 'readable.md'), expectedContent);

    const content = await promptLibraryProvider.getPromptContent('readable.md', 'project');
    assert.strictEqual(content, expectedContent);
  });

  test('copyPromptToScope copies from project to global', async () => {
    fs.writeFileSync(path.join(projectPromptsDir, 'copy-me.md'), '# Copy');

    const result = await promptLibraryProvider.copyPromptToScope('copy-me.md', 'project', 'global');
    assert.strictEqual(result.conflict, false, 'Should not conflict on fresh copy');

    const destPath = path.join(globalPromptsDir, 'copy-me.md');
    assert.ok(fs.existsSync(destPath), 'File should exist in global scope');
    assert.strictEqual(fs.readFileSync(destPath, 'utf-8'), '# Copy');
  });

  test('copyPromptToScope detects conflict', async () => {
    fs.writeFileSync(path.join(projectPromptsDir, 'conflict.md'), '# Project version');
    fs.writeFileSync(path.join(globalPromptsDir, 'conflict.md'), '# Global version');

    const result = await promptLibraryProvider.copyPromptToScope('conflict.md', 'project', 'global');
    assert.strictEqual(result.conflict, true, 'Should detect existing file as conflict');
    // Original global file should be unchanged
    assert.strictEqual(
      fs.readFileSync(path.join(globalPromptsDir, 'conflict.md'), 'utf-8'),
      '# Global version'
    );
  });

  test('CRUD lifecycle: create → read → list → delete → list', async () => {
    // Create
    await promptLibraryProvider.savePrompt('lifecycle', '# Lifecycle Test', 'project');

    // Read
    const content = await promptLibraryProvider.getPromptContent('lifecycle.md', 'project');
    assert.strictEqual(content, '# Lifecycle Test');

    // List
    let prompts = await promptLibraryProvider.listPrompts(['project']);
    assert.strictEqual(prompts.length, 1);
    assert.strictEqual(prompts[0].name, 'lifecycle');

    // Delete
    await promptLibraryProvider.deletePrompt('lifecycle.md', 'project');

    // List again
    prompts = await promptLibraryProvider.listPrompts(['project']);
    assert.strictEqual(prompts.length, 0, 'Should be empty after delete');
  });
});

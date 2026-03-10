import * as assert from 'assert';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

suite('MissionTemplateProvider', () => {
  const extensionId = 'ZunRenYao.lumi-ops';
  let missionTemplateProvider: any;
  let tmpDir: string;
  let projectMissionsDir: string;
  let globalMissionsDir: string;
  let originalProjectDir: any;
  let originalGlobalDir: any;

  suiteSetup(async () => {
    const extension = vscode.extensions.getExtension(extensionId)!;
    const exports = await extension.activate();
    assert.ok(exports.missionTemplateProvider, 'Extension should export missionTemplateProvider');
    missionTemplateProvider = exports.missionTemplateProvider;

    // Save original state
    originalProjectDir = (missionTemplateProvider as any).projectDir;
    originalGlobalDir = (missionTemplateProvider as any).globalDir;
  });

  setup(() => {
    // Create isolated temp directories for each test
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumi-mission-test-'));
    projectMissionsDir = path.join(tmpDir, 'project', '.prompts', '_missions');
    globalMissionsDir = path.join(tmpDir, 'global', '.prompts', '_missions');
    fs.mkdirSync(projectMissionsDir, { recursive: true });
    fs.mkdirSync(globalMissionsDir, { recursive: true });

    // Point the provider to our temp directories
    missionTemplateProvider.setProjectRoot(vscode.Uri.file(path.join(tmpDir, 'project')));
    (missionTemplateProvider as any).globalDir = vscode.Uri.file(globalMissionsDir);
  });

  teardown(() => {
    // Restore original directories
    (missionTemplateProvider as any).projectDir = originalProjectDir;
    (missionTemplateProvider as any).globalDir = originalGlobalDir;

    // Clean up temp directory
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  test('listTemplates returns empty array when no templates exist', async () => {
    const templates = await missionTemplateProvider.listTemplates();
    assert.ok(Array.isArray(templates), 'Should return an array');
    assert.strictEqual(templates.length, 0, 'Should be empty when no templates exist');
  });

  test('listTemplates finds project-scope templates', async () => {
    fs.writeFileSync(
      path.join(projectMissionsDir, 'my-template.md'),
      '---\nname: my-template\n---\n\n## Task\nDo stuff\n'
    );

    const templates = await missionTemplateProvider.listTemplates();
    assert.ok(templates.length >= 1, 'Should find at least one template');

    const projectTemplate = templates.find((t: any) => t.scope === 'project');
    assert.ok(projectTemplate, 'Should find a project-scope template');
    assert.strictEqual(projectTemplate.name, 'my-template');
    assert.strictEqual(projectTemplate.fileName, 'my-template.md');
  });

  test('listTemplates finds global-scope templates', async () => {
    fs.writeFileSync(
      path.join(globalMissionsDir, 'global-template.md'),
      '---\nname: global-template\n---\n\n## Task\nGlobal task\n'
    );

    const templates = await missionTemplateProvider.listTemplates();
    const globalTemplate = templates.find((t: any) => t.scope === 'global');
    assert.ok(globalTemplate, 'Should find a global-scope template');
    assert.strictEqual(globalTemplate.name, 'global-template');
  });

  test('listTemplates returns both scopes', async () => {
    fs.writeFileSync(
      path.join(projectMissionsDir, 'proj.md'),
      '---\nname: proj\n---\n\n## Task\nProject\n'
    );
    fs.writeFileSync(
      path.join(globalMissionsDir, 'glob.md'),
      '---\nname: glob\n---\n\n## Task\nGlobal\n'
    );

    const templates = await missionTemplateProvider.listTemplates();
    assert.strictEqual(templates.length, 2, 'Should find templates from both scopes');
  });

  test('saveTemplate creates a new template file', async () => {
    const template = {
      name: 'new-template',
      fileName: 'new-template.md',
      task: 'New task',
      rules: 'New rules',
      instructions: 'New instructions',
      scope: 'project' as const,
    };

    await missionTemplateProvider.saveTemplate(template);

    const filePath = path.join(projectMissionsDir, 'new-template.md');
    assert.ok(fs.existsSync(filePath), 'File should be created');

    const content = fs.readFileSync(filePath, 'utf-8');
    assert.ok(content.includes('new-template'), 'Should contain template name');
    assert.ok(content.includes('New task'), 'Should contain task');
  });

  test('getTemplate reads and parses a template', async () => {
    fs.writeFileSync(
      path.join(projectMissionsDir, 'readable.md'),
      '---\nname: readable\n---\n\n## Task\nRead this\n\n## Rules\nFollow these\n\n## Instructions\nDo that\n'
    );

    const template = await missionTemplateProvider.getTemplate('readable.md', 'project');
    assert.strictEqual(template.name, 'readable');
    assert.strictEqual(template.task, 'Read this');
    assert.strictEqual(template.rules, 'Follow these');
    assert.strictEqual(template.instructions, 'Do that');
    assert.strictEqual(template.scope, 'project');
  });

  test('deleteTemplate removes the file', async () => {
    const filePath = path.join(projectMissionsDir, 'to-delete.md');
    fs.writeFileSync(filePath, '---\nname: to-delete\n---\n\n## Task\nDelete me\n');
    assert.ok(fs.existsSync(filePath), 'File should exist before delete');

    await missionTemplateProvider.deleteTemplate('to-delete.md', 'project');

    assert.ok(!fs.existsSync(filePath), 'File should be deleted');
  });

  test('copyToScope copies from project to global', async () => {
    fs.writeFileSync(
      path.join(projectMissionsDir, 'copy-me.md'),
      '---\nname: copy-me\n---\n\n## Task\nCopy task\n'
    );

    const result = await missionTemplateProvider.copyToScope('copy-me.md', 'project', 'global');
    assert.strictEqual(result.conflict, false, 'Should not conflict on fresh copy');

    const destPath = path.join(globalMissionsDir, 'copy-me.md');
    assert.ok(fs.existsSync(destPath), 'File should exist in global scope');
  });

  test('copyToScope detects conflict', async () => {
    fs.writeFileSync(
      path.join(projectMissionsDir, 'conflict.md'),
      '---\nname: conflict\n---\n\n## Task\nProject version\n'
    );
    fs.writeFileSync(
      path.join(globalMissionsDir, 'conflict.md'),
      '---\nname: conflict\n---\n\n## Task\nGlobal version\n'
    );

    const result = await missionTemplateProvider.copyToScope('conflict.md', 'project', 'global');
    assert.strictEqual(result.conflict, true, 'Should detect existing file as conflict');
  });

  test('forkDefault creates a template from defaults', async () => {
    const fileUri = await missionTemplateProvider.forkDefault('forked', 'project');
    assert.ok(fileUri, 'Should return a URI');

    const filePath = path.join(projectMissionsDir, 'forked.md');
    assert.ok(fs.existsSync(filePath), 'File should be created');

    const content = fs.readFileSync(filePath, 'utf-8');
    assert.ok(content.includes('name: forked'), 'Should contain forked name');
  });

  test('CRUD lifecycle: save → get → list → delete → list', async () => {
    const template = {
      name: 'lifecycle',
      fileName: 'lifecycle.md',
      task: 'Lifecycle task',
      rules: 'Lifecycle rules',
      instructions: 'Lifecycle instructions',
      scope: 'project' as const,
    };

    // Save
    await missionTemplateProvider.saveTemplate(template);

    // Get
    const retrieved = await missionTemplateProvider.getTemplate('lifecycle.md', 'project');
    assert.strictEqual(retrieved.task, 'Lifecycle task');

    // List
    let templates = await missionTemplateProvider.listTemplates();
    assert.strictEqual(templates.length, 1);

    // Delete
    await missionTemplateProvider.deleteTemplate('lifecycle.md', 'project');

    // List again
    templates = await missionTemplateProvider.listTemplates();
    assert.strictEqual(templates.length, 0, 'Should be empty after delete');
  });
});

import * as assert from 'assert';
import * as vscode from 'vscode';

suite('missionTemplateUtils — parseMissionTemplate', () => {
  const extensionId = 'ZunRenYao.lumi-ops';
  let parseMissionTemplate: (content: string) => any;
  let serializeMissionTemplate: (fields: any) => string;

  suiteSetup(async () => {
    const extension = vscode.extensions.getExtension(extensionId)!;
    const exports = await extension.activate();
    assert.ok(exports.parseMissionTemplate, 'Extension should export parseMissionTemplate');
    assert.ok(exports.serializeMissionTemplate, 'Extension should export serializeMissionTemplate');
    parseMissionTemplate = exports.parseMissionTemplate;
    serializeMissionTemplate = exports.serializeMissionTemplate;
  });

  test('parses full template with all sections', () => {
    const content = [
      '---',
      'name: my-template',
      '---',
      '',
      '## Task',
      'Build a widget',
      '',
      '## Rules',
      'Follow coding standards',
      '',
      '## Instructions',
      '1. Step one',
      '2. Step two',
      '',
    ].join('\n');

    const result = parseMissionTemplate(content);
    assert.strictEqual(result.name, 'my-template');
    assert.strictEqual(result.task, 'Build a widget');
    assert.strictEqual(result.rules, 'Follow coding standards');
    assert.ok(result.instructions.includes('1. Step one'));
    assert.ok(result.instructions.includes('2. Step two'));
  });

  test('parses template with partial sections', () => {
    const content = [
      '---',
      'name: partial',
      '---',
      '',
      '## Task',
      'Only task here',
      '',
    ].join('\n');

    const result = parseMissionTemplate(content);
    assert.strictEqual(result.name, 'partial');
    assert.strictEqual(result.task, 'Only task here');
    assert.strictEqual(result.rules, '');
    assert.strictEqual(result.instructions, '');
  });

  test('parses empty content', () => {
    const result = parseMissionTemplate('');
    assert.strictEqual(result.name, '');
    assert.strictEqual(result.task, '');
    assert.strictEqual(result.rules, '');
    assert.strictEqual(result.instructions, '');
  });

  test('parses content with no frontmatter', () => {
    const content = [
      '## Task',
      'No frontmatter task',
      '',
      '## Rules',
      'No frontmatter rules',
      '',
    ].join('\n');

    const result = parseMissionTemplate(content);
    assert.strictEqual(result.name, '');
    assert.strictEqual(result.task, 'No frontmatter task');
    assert.strictEqual(result.rules, 'No frontmatter rules');
  });

  test('handles special characters in content', () => {
    const content = [
      '---',
      'name: special-chars',
      '---',
      '',
      '## Task',
      'Use `backticks` and **bold** and *italic*',
      '',
      '## Rules',
      '- Item with (parentheses) and [brackets]',
      '- URL: https://example.com?foo=bar&baz=qux',
      '',
    ].join('\n');

    const result = parseMissionTemplate(content);
    assert.strictEqual(result.name, 'special-chars');
    assert.ok(result.task.includes('`backticks`'));
    assert.ok(result.rules.includes('https://example.com'));
  });

  test('handles frontmatter with extra fields (ignores them)', () => {
    const content = [
      '---',
      'name: extended',
      'version: 2',
      '---',
      '',
      '## Task',
      'Extended frontmatter',
      '',
    ].join('\n');

    const result = parseMissionTemplate(content);
    assert.strictEqual(result.name, 'extended');
    assert.strictEqual(result.task, 'Extended frontmatter');
  });

  test('handles multiline section content', () => {
    const content = [
      '---',
      'name: multi',
      '---',
      '',
      '## Task',
      'Line 1',
      'Line 2',
      'Line 3',
      '',
      '## Rules',
      'Rule content',
      '',
    ].join('\n');

    const result = parseMissionTemplate(content);
    assert.ok(result.task.includes('Line 1'));
    assert.ok(result.task.includes('Line 2'));
    assert.ok(result.task.includes('Line 3'));
  });
});

suite('missionTemplateUtils — serializeMissionTemplate', () => {
  const extensionId = 'ZunRenYao.lumi-ops';
  let serializeMissionTemplate: (fields: any) => string;

  suiteSetup(async () => {
    const extension = vscode.extensions.getExtension(extensionId)!;
    const exports = await extension.activate();
    serializeMissionTemplate = exports.serializeMissionTemplate;
  });

  test('serializes all fields to markdown', () => {
    const fields = {
      name: 'test-template',
      task: 'Do the thing',
      rules: 'Be careful',
      instructions: '1. First step',
    };

    const output = serializeMissionTemplate(fields);
    assert.ok(output.includes('---'));
    assert.ok(output.includes('name: test-template'));
    assert.ok(output.includes('## Task'));
    assert.ok(output.includes('Do the thing'));
    assert.ok(output.includes('## Rules'));
    assert.ok(output.includes('Be careful'));
    assert.ok(output.includes('## Instructions'));
    assert.ok(output.includes('1. First step'));
  });

  test('serializes empty fields', () => {
    const fields = {
      name: 'empty',
      task: '',
      rules: '',
      instructions: '',
    };

    const output = serializeMissionTemplate(fields);
    assert.ok(output.includes('name: empty'));
    assert.ok(output.includes('## Task'));
    assert.ok(output.includes('## Rules'));
    assert.ok(output.includes('## Instructions'));
  });
});

suite('missionTemplateUtils — round-trip', () => {
  const extensionId = 'ZunRenYao.lumi-ops';
  let parseMissionTemplate: (content: string) => any;
  let serializeMissionTemplate: (fields: any) => string;

  suiteSetup(async () => {
    const extension = vscode.extensions.getExtension(extensionId)!;
    const exports = await extension.activate();
    parseMissionTemplate = exports.parseMissionTemplate;
    serializeMissionTemplate = exports.serializeMissionTemplate;
  });

  test('parse → serialize → parse produces stable result', () => {
    const original = {
      name: 'round-trip',
      task: 'Build a feature',
      rules: '- Rule 1\n- Rule 2',
      instructions: '1. Step one\n2. Step two',
    };

    const serialized = serializeMissionTemplate(original);
    const parsed = parseMissionTemplate(serialized);

    assert.strictEqual(parsed.name, original.name);
    assert.strictEqual(parsed.task, original.task);
    assert.strictEqual(parsed.rules, original.rules);
    assert.strictEqual(parsed.instructions, original.instructions);

    // Second round-trip should also be stable
    const serialized2 = serializeMissionTemplate(parsed);
    const parsed2 = parseMissionTemplate(serialized2);

    assert.strictEqual(parsed2.name, original.name);
    assert.strictEqual(parsed2.task, original.task);
    assert.strictEqual(parsed2.rules, original.rules);
    assert.strictEqual(parsed2.instructions, original.instructions);
  });

  test('round-trip with special markdown content', () => {
    const original = {
      name: 'markdown-heavy',
      task: '### Sub-heading\n\n```typescript\nconst x = 1;\n```',
      rules: '> Quote block\n\n| Col1 | Col2 |\n|------|------|\n| a    | b    |',
      instructions: '- [x] Checkbox\n- [ ] Unchecked',
    };

    const serialized = serializeMissionTemplate(original);
    const parsed = parseMissionTemplate(serialized);

    assert.strictEqual(parsed.name, original.name);
    assert.strictEqual(parsed.task, original.task);
    assert.strictEqual(parsed.rules, original.rules);
    assert.strictEqual(parsed.instructions, original.instructions);
  });
});

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

suite('MissionTemplateEditorProvider — Webview Message Handlers', () => {
  const extensionId = 'ZunRenYao.lumi-ops';
  let missionEditorProvider: any;
  let tmpDir: string;

  suiteSetup(async () => {
    const extension = vscode.extensions.getExtension(extensionId)!;
    const exports = await extension.activate();
    assert.ok(exports.missionEditorProvider, 'Extension should export missionEditorProvider');
    missionEditorProvider = exports.missionEditorProvider;
  });

  setup(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumi-mission-editor-test-'));
  });

  teardown(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  test('resolveCustomTextEditor sends setFields to webview on open', async () => {
    // Create a temp mission template file
    const templateContent = '---\nname: test-template\n---\n\n## Task\nDo the thing\n\n## Rules\nFollow the rules\n\n## Instructions\n1. Step one\n';
    const filePath = path.join(tmpDir, 'test-template.md');
    fs.writeFileSync(filePath, templateContent);

    const document = await vscode.workspace.openTextDocument(filePath);

    const postedMessages: any[] = [];
    let messageListener: ((msg: any) => void) | undefined;

    const mockPanel: any = {
      webview: {
        options: {},
        html: '',
        postMessage: (msg: any) => {
          postedMessages.push(msg);
          return Promise.resolve(true);
        },
        onDidReceiveMessage: (listener: (msg: any) => void) => {
          messageListener = listener;
          return { dispose: () => {} };
        },
      },
      onDidDispose: (listener: () => void) => {
        return { dispose: () => {} };
      },
    };

    const token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => {} }) };
    await missionEditorProvider.resolveCustomTextEditor(document, mockPanel, token);

    // Should have posted setFields with parsed template data
    const setFieldsMsg = postedMessages.find((m: any) => m.command === 'setFields');
    assert.ok(setFieldsMsg, 'Should send setFields to webview on open');
    assert.strictEqual(setFieldsMsg.name, 'test-template');
    assert.strictEqual(setFieldsMsg.task, 'Do the thing');
    assert.strictEqual(setFieldsMsg.rules, 'Follow the rules');
    assert.strictEqual(setFieldsMsg.instructions, '1. Step one');
  });

  test('update message applies WorkspaceEdit to document', async () => {
    const templateContent = '---\nname: editable\n---\n\n## Task\nOriginal task\n\n## Rules\nOriginal rules\n\n## Instructions\nOriginal instructions\n';
    const filePath = path.join(tmpDir, 'editable.md');
    fs.writeFileSync(filePath, templateContent);

    const document = await vscode.workspace.openTextDocument(filePath);

    let messageListener: ((msg: any) => void) | undefined;
    const postedMessages: any[] = [];

    const mockPanel: any = {
      webview: {
        options: {},
        html: '',
        postMessage: (msg: any) => {
          postedMessages.push(msg);
          return Promise.resolve(true);
        },
        onDidReceiveMessage: (listener: (msg: any) => void) => {
          messageListener = listener;
          return { dispose: () => {} };
        },
      },
      onDidDispose: (listener: () => void) => {
        return { dispose: () => {} };
      },
    };

    const token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => {} }) };
    await missionEditorProvider.resolveCustomTextEditor(document, mockPanel, token);

    assert.ok(messageListener, 'Should have registered message listener');

    // Fire the update message
    await messageListener!({
      command: 'update',
      name: 'editable',
      task: 'Updated task',
      rules: 'Updated rules',
      instructions: 'Updated instructions',
    });

    // The document should now contain the updated content
    const updatedText = document.getText();
    assert.ok(updatedText.includes('Updated task'), 'Document should contain updated task');
    assert.ok(updatedText.includes('Updated rules'), 'Document should contain updated rules');
    assert.ok(updatedText.includes('Updated instructions'), 'Document should contain updated instructions');
  });

  test('resolveCustomTextEditor sets webview HTML', async () => {
    const filePath = path.join(tmpDir, 'html-test.md');
    fs.writeFileSync(filePath, '---\nname: html-test\n---\n\n## Task\nTest\n');

    const document = await vscode.workspace.openTextDocument(filePath);

    const mockPanel: any = {
      webview: {
        options: {},
        html: '',
        postMessage: () => Promise.resolve(true),
        onDidReceiveMessage: () => ({ dispose: () => {} }),
      },
      onDidDispose: () => ({ dispose: () => {} }),
    };

    const token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => {} }) };
    await missionEditorProvider.resolveCustomTextEditor(document, mockPanel, token);

    assert.ok(mockPanel.webview.html.length > 0, 'Should set webview HTML');
    assert.ok(mockPanel.webview.html.includes('Mission Template'), 'HTML should contain "Mission Template" text');
  });
});

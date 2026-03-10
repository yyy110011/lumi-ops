import * as assert from 'assert';
import * as vscode from 'vscode';

/**
 * Creates a mock WebviewView with a controllable onDidReceiveMessage listener.
 */
function createMockWebviewView() {
  let messageListener: ((data: any) => void) | undefined;
  const postedMessages: any[] = [];

  const mockWebview: any = {
    options: {},
    html: '',
    onDidReceiveMessage: (listener: (data: any) => void) => {
      messageListener = listener;
      return { dispose: () => { messageListener = undefined; } };
    },
    postMessage: (msg: any) => {
      postedMessages.push(msg);
      return Promise.resolve(true);
    },
  };

  const mockWebviewView: any = {
    webview: mockWebview,
    show: () => {},
  };

  const fireMessage = (data: any) => {
    if (!messageListener) {
      throw new Error('No message listener registered — was resolveWebviewView called?');
    }
    messageListener(data);
  };

  return { mockWebviewView, fireMessage, postedMessages };
}

suite('PromptLibraryViewProvider — Webview Message Handlers', () => {
  const extensionId = 'ZunRenYao.lumi-ops';
  let provider: any;
  let originalExecuteCommand: typeof vscode.commands.executeCommand;
  let executedCommands: { command: string; args: any[] }[];

  suiteSetup(async () => {
    const extension = vscode.extensions.getExtension(extensionId)!;
    const exports = await extension.activate();
    assert.ok(exports.promptLibraryViewProvider, 'Extension should export promptLibraryViewProvider');
    provider = exports.promptLibraryViewProvider;
  });

  setup(() => {
    executedCommands = [];
    originalExecuteCommand = vscode.commands.executeCommand;
    (vscode.commands as any).executeCommand = (cmd: string, ...args: any[]) => {
      executedCommands.push({ command: cmd, args });
      return Promise.resolve();
    };
  });

  teardown(() => {
    (vscode.commands as any).executeCommand = originalExecuteCommand;
  });

  // ── Prompt Commands ──────────────────────────────────────────

  test('getPrompts message dispatches lumi-ops._getPrompts', () => {
    const { mockWebviewView, fireMessage } = createMockWebviewView();
    provider.resolveWebviewView(mockWebviewView, {}, { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => {} }) });

    fireMessage({ command: 'getPrompts', scopes: ['project', 'global'] });

    const call = executedCommands.find(c => c.command === 'lumi-ops._getPrompts');
    assert.ok(call, 'Should execute lumi-ops._getPrompts');
    assert.deepStrictEqual(call!.args[0], ['project', 'global'], 'Should pass scopes array');
  });

  test('selectPrompt message dispatches lumi-ops._selectPrompt', () => {
    const { mockWebviewView, fireMessage } = createMockWebviewView();
    provider.resolveWebviewView(mockWebviewView, {}, { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => {} }) });

    fireMessage({ command: 'selectPrompt', fileName: 'my-prompt.md', scope: 'project' });

    const call = executedCommands.find(c => c.command === 'lumi-ops._selectPrompt');
    assert.ok(call, 'Should execute lumi-ops._selectPrompt');
    assert.strictEqual(call!.args[0], 'my-prompt.md');
    assert.strictEqual(call!.args[1], 'project');
  });

  test('importFolder message dispatches lumi-ops._importFolder', () => {
    const { mockWebviewView, fireMessage } = createMockWebviewView();
    provider.resolveWebviewView(mockWebviewView, {}, { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => {} }) });

    fireMessage({ command: 'importFolder', scope: 'global' });

    const call = executedCommands.find(c => c.command === 'lumi-ops._importFolder');
    assert.ok(call, 'Should execute lumi-ops._importFolder');
    assert.strictEqual(call!.args[0], 'global');
  });

  test('createPromptInline message dispatches lumi-ops._createPromptInline', () => {
    const { mockWebviewView, fireMessage } = createMockWebviewView();
    provider.resolveWebviewView(mockWebviewView, {}, { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => {} }) });

    fireMessage({ command: 'createPromptInline', name: 'new-prompt', scope: 'project' });

    const call = executedCommands.find(c => c.command === 'lumi-ops._createPromptInline');
    assert.ok(call, 'Should execute lumi-ops._createPromptInline');
    assert.strictEqual(call!.args[0], 'new-prompt');
    assert.strictEqual(call!.args[1], 'project');
  });

  test('deletePrompt message dispatches lumi-ops._deletePrompt', () => {
    const { mockWebviewView, fireMessage } = createMockWebviewView();
    provider.resolveWebviewView(mockWebviewView, {}, { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => {} }) });

    fireMessage({ command: 'deletePrompt', fileName: 'old.md', scope: 'project' });

    const call = executedCommands.find(c => c.command === 'lumi-ops._deletePrompt');
    assert.ok(call, 'Should execute lumi-ops._deletePrompt');
    assert.strictEqual(call!.args[0], 'old.md');
    assert.strictEqual(call!.args[1], 'project');
  });

  test('copyPromptScope message dispatches lumi-ops._copyPromptScope', () => {
    const { mockWebviewView, fireMessage } = createMockWebviewView();
    provider.resolveWebviewView(mockWebviewView, {}, { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => {} }) });

    fireMessage({ command: 'copyPromptScope', fileName: 'copy.md', fromScope: 'project', toScope: 'global' });

    const call = executedCommands.find(c => c.command === 'lumi-ops._copyPromptScope');
    assert.ok(call, 'Should execute lumi-ops._copyPromptScope');
    assert.strictEqual(call!.args[0], 'copy.md');
    assert.strictEqual(call!.args[1], 'project');
    assert.strictEqual(call!.args[2], 'global');
  });

  test('editPrompt message dispatches lumi-ops._editPrompt', () => {
    const { mockWebviewView, fireMessage } = createMockWebviewView();
    provider.resolveWebviewView(mockWebviewView, {}, { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => {} }) });

    fireMessage({ command: 'editPrompt', fileName: 'edit.md', scope: 'global' });

    const call = executedCommands.find(c => c.command === 'lumi-ops._editPrompt');
    assert.ok(call, 'Should execute lumi-ops._editPrompt');
    assert.strictEqual(call!.args[0], 'edit.md');
    assert.strictEqual(call!.args[1], 'global');
  });

  test('getCloneBranches message dispatches lumi-ops._getCloneBranches', () => {
    const { mockWebviewView, fireMessage } = createMockWebviewView();
    provider.resolveWebviewView(mockWebviewView, {}, { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => {} }) });

    fireMessage({ command: 'getCloneBranches' });

    const call = executedCommands.find(c => c.command === 'lumi-ops._getCloneBranches');
    assert.ok(call, 'Should execute lumi-ops._getCloneBranches');
  });

  // ── Mission Template Commands ─────────────────────────────────

  test('switchMission message dispatches lumi-ops._switchMission', () => {
    const { mockWebviewView, fireMessage } = createMockWebviewView();
    provider.resolveWebviewView(mockWebviewView, {}, { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => {} }) });

    fireMessage({ command: 'switchMission', name: 'custom', scope: 'project' });

    const call = executedCommands.find(c => c.command === 'lumi-ops._switchMission');
    assert.ok(call, 'Should execute lumi-ops._switchMission');
    assert.strictEqual(call!.args[0], 'custom');
    assert.strictEqual(call!.args[1], 'project');
  });

  test('editMission message dispatches lumi-ops._editMission', () => {
    const { mockWebviewView, fireMessage } = createMockWebviewView();
    provider.resolveWebviewView(mockWebviewView, {}, { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => {} }) });

    fireMessage({ command: 'editMission' });

    const call = executedCommands.find(c => c.command === 'lumi-ops._editMission');
    assert.ok(call, 'Should execute lumi-ops._editMission');
  });

  test('forkMission message dispatches lumi-ops._forkMission', () => {
    const { mockWebviewView, fireMessage } = createMockWebviewView();
    provider.resolveWebviewView(mockWebviewView, {}, { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => {} }) });

    fireMessage({ command: 'forkMission' });

    const call = executedCommands.find(c => c.command === 'lumi-ops._forkMission');
    assert.ok(call, 'Should execute lumi-ops._forkMission');
  });

  test('getMissionTemplates message dispatches lumi-ops._getMissionTemplates', () => {
    const { mockWebviewView, fireMessage } = createMockWebviewView();
    provider.resolveWebviewView(mockWebviewView, {}, { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => {} }) });

    fireMessage({ command: 'getMissionTemplates' });

    const call = executedCommands.find(c => c.command === 'lumi-ops._getMissionTemplates');
    assert.ok(call, 'Should execute lumi-ops._getMissionTemplates');
  });

  test('copyMissionScope message dispatches lumi-ops._copyMissionScope', () => {
    const { mockWebviewView, fireMessage } = createMockWebviewView();
    provider.resolveWebviewView(mockWebviewView, {}, { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => {} }) });

    fireMessage({ command: 'copyMissionScope', name: 'tmpl', fromScope: 'project', toScope: 'global' });

    const call = executedCommands.find(c => c.command === 'lumi-ops._copyMissionScope');
    assert.ok(call, 'Should execute lumi-ops._copyMissionScope');
    assert.strictEqual(call!.args[0], 'tmpl');
    assert.strictEqual(call!.args[1], 'project');
    assert.strictEqual(call!.args[2], 'global');
  });

  test('editMissionByName message dispatches lumi-ops._editMissionByName', () => {
    const { mockWebviewView, fireMessage } = createMockWebviewView();
    provider.resolveWebviewView(mockWebviewView, {}, { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => {} }) });

    fireMessage({ command: 'editMissionByName', name: 'my-mission', scope: 'global' });

    const call = executedCommands.find(c => c.command === 'lumi-ops._editMissionByName');
    assert.ok(call, 'Should execute lumi-ops._editMissionByName');
    assert.strictEqual(call!.args[0], 'my-mission');
    assert.strictEqual(call!.args[1], 'global');
  });

  test('deleteMission message dispatches lumi-ops._deleteMission', () => {
    const { mockWebviewView, fireMessage } = createMockWebviewView();
    provider.resolveWebviewView(mockWebviewView, {}, { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => {} }) });

    fireMessage({ command: 'deleteMission', name: 'old-mission', scope: 'project' });

    const call = executedCommands.find(c => c.command === 'lumi-ops._deleteMission');
    assert.ok(call, 'Should execute lumi-ops._deleteMission');
    assert.strictEqual(call!.args[0], 'old-mission');
    assert.strictEqual(call!.args[1], 'project');
  });

  // ── PostMessage Methods (Extension → Webview) ────────────────

  test('updatePrompts sends setPrompts message to webview', () => {
    const { mockWebviewView, postedMessages } = createMockWebviewView();
    provider.resolveWebviewView(mockWebviewView, {}, { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => {} }) });

    const prompts = [{ name: 'test', fileName: 'test.md', preview: '# Test', scope: 'project' }];
    provider.updatePrompts(prompts);

    const msg = postedMessages.find((m: any) => m.command === 'setPrompts');
    assert.ok(msg, 'Should post setPrompts message');
    assert.deepStrictEqual(msg.prompts, prompts);
  });

  test('updateCloneBranches sends setCloneBranches message to webview', () => {
    const { mockWebviewView, postedMessages } = createMockWebviewView();
    provider.resolveWebviewView(mockWebviewView, {}, { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => {} }) });

    provider.updateCloneBranches(['feat/a', 'feat/b']);

    const msg = postedMessages.find((m: any) => m.command === 'setCloneBranches');
    assert.ok(msg, 'Should post setCloneBranches message');
    assert.deepStrictEqual(msg.cloneBranches, ['feat/a', 'feat/b']);
  });

  test('updateMissionTemplate sends setMission message to webview', () => {
    const { mockWebviewView, postedMessages } = createMockWebviewView();
    provider.resolveWebviewView(mockWebviewView, {}, { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => {} }) });

    const templates = [{ name: 'custom', fileName: 'custom.md', scope: 'project' }];
    provider.updateMissionTemplate('custom:project', templates);

    const msg = postedMessages.find((m: any) => m.command === 'setMission');
    assert.ok(msg, 'Should post setMission message');
    assert.strictEqual(msg.activeName, 'custom:project');
    assert.deepStrictEqual(msg.templates, templates);
  });

  test('unknown command is silently ignored', () => {
    const { mockWebviewView, fireMessage } = createMockWebviewView();
    provider.resolveWebviewView(mockWebviewView, {}, { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => {} }) });

    assert.doesNotThrow(() => {
      fireMessage({ command: 'nonExistentCommand' });
    }, 'Unknown commands should not throw');
    assert.strictEqual(executedCommands.length, 0);
  });
});

import * as assert from 'assert';
import * as vscode from 'vscode';

/**
 * Creates a mock WebviewView with a controllable onDidReceiveMessage listener.
 * Returns the mock and a `fireMessage` function to simulate postMessage from the webview.
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

suite('ShadowCreatorProvider — Webview Message Handlers', () => {
  const extensionId = 'ZunRenYao.lumi-ops';
  let creatorProvider: any;
  let originalExecuteCommand: typeof vscode.commands.executeCommand;
  let executedCommands: { command: string; args: any[] }[];

  suiteSetup(async () => {
    const extension = vscode.extensions.getExtension(extensionId)!;
    const exports = await extension.activate();
    assert.ok(exports.creatorProvider, 'Extension should export creatorProvider');
    creatorProvider = exports.creatorProvider;
  });

  setup(() => {
    executedCommands = [];
    originalExecuteCommand = vscode.commands.executeCommand;
    // Intercept executeCommand to capture calls
    (vscode.commands as any).executeCommand = (cmd: string, ...args: any[]) => {
      executedCommands.push({ command: cmd, args });
      return Promise.resolve();
    };
  });

  teardown(() => {
    // Restore original
    (vscode.commands as any).executeCommand = originalExecuteCommand;
  });

  test('spawn message dispatches lumi-ops.spawn with correct payload', () => {
    const { mockWebviewView, fireMessage } = createMockWebviewView();
    creatorProvider.resolveWebviewView(mockWebviewView, {}, { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => {} }) });

    fireMessage({
      command: 'spawn',
      branch: 'feat/test',
      description: 'Test description',
      baseBranch: 'main',
      templates: ['default'],
    });

    const spawnCall = executedCommands.find(c => c.command === 'lumi-ops.spawn');
    assert.ok(spawnCall, 'Should execute lumi-ops.spawn');
    assert.deepStrictEqual(spawnCall!.args[0], {
      branch: 'feat/test',
      description: 'Test description',
      baseBranch: 'main',
      templates: ['default'],
    });
  });

  test('getBranches message dispatches lumi-ops.getBranches', () => {
    const { mockWebviewView, fireMessage } = createMockWebviewView();
    creatorProvider.resolveWebviewView(mockWebviewView, {}, { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => {} }) });

    fireMessage({ command: 'getBranches' });

    const call = executedCommands.find(c => c.command === 'lumi-ops.getBranches');
    assert.ok(call, 'Should execute lumi-ops.getBranches');
  });

  test('returnToRoot message dispatches lumi-ops.returnToRoot', () => {
    const { mockWebviewView, fireMessage } = createMockWebviewView();
    creatorProvider.resolveWebviewView(mockWebviewView, {}, { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => {} }) });

    fireMessage({ command: 'returnToRoot' });

    const call = executedCommands.find(c => c.command === 'lumi-ops.returnToRoot');
    assert.ok(call, 'Should execute lumi-ops.returnToRoot');
  });

  test('saveAsPrompt message dispatches lumi-ops.saveAsPrompt with content and scope', () => {
    const { mockWebviewView, fireMessage } = createMockWebviewView();
    creatorProvider.resolveWebviewView(mockWebviewView, {}, { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => {} }) });

    fireMessage({ command: 'saveAsPrompt', content: '# My Prompt', scope: 'project' });

    const call = executedCommands.find(c => c.command === 'lumi-ops.saveAsPrompt');
    assert.ok(call, 'Should execute lumi-ops.saveAsPrompt');
    assert.strictEqual(call!.args[0], '# My Prompt', 'First arg should be content');
    assert.strictEqual(call!.args[1], 'project', 'Second arg should be scope');
  });

  test('unknown command is silently ignored', () => {
    const { mockWebviewView, fireMessage } = createMockWebviewView();
    creatorProvider.resolveWebviewView(mockWebviewView, {}, { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => {} }) });

    assert.doesNotThrow(() => {
      fireMessage({ command: 'nonExistentCommand' });
    }, 'Unknown commands should not throw');
    assert.strictEqual(executedCommands.length, 0, 'No commands should have been executed');
  });

  test('updateBranches sends setBranches message to webview', () => {
    const { mockWebviewView, postedMessages } = createMockWebviewView();
    creatorProvider.resolveWebviewView(mockWebviewView, {}, { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => {} }) });

    const branches = [{ name: 'main', isRemote: false }, { name: 'dev', isRemote: true }];
    creatorProvider.updateBranches(branches, 'main', ['feat/existing']);

    const msg = postedMessages.find((m: any) => m.command === 'setBranches');
    assert.ok(msg, 'Should post setBranches message');
    assert.deepStrictEqual(msg.branches, branches);
    assert.strictEqual(msg.currentBranch, 'main');
    assert.deepStrictEqual(msg.worktreeBranches, ['feat/existing']);
  });

  test('resetForm sends resetForm message to webview', () => {
    const { mockWebviewView, postedMessages } = createMockWebviewView();
    creatorProvider.resolveWebviewView(mockWebviewView, {}, { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => {} }) });

    creatorProvider.resetForm();

    const msg = postedMessages.find((m: any) => m.command === 'resetForm');
    assert.ok(msg, 'Should post resetForm message');
  });

  test('loadPrompt sends loadPrompt message to webview', () => {
    const { mockWebviewView, postedMessages } = createMockWebviewView();
    creatorProvider.resolveWebviewView(mockWebviewView, {}, { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => {} }) });

    creatorProvider.loadPrompt('my-prompt', '# Content');

    const msg = postedMessages.find((m: any) => m.command === 'loadPrompt');
    assert.ok(msg, 'Should post loadPrompt message');
    assert.strictEqual(msg.name, 'my-prompt');
    assert.strictEqual(msg.content, '# Content');
  });

  test('setBranchName sends setBranchName message to webview', () => {
    const { mockWebviewView, postedMessages } = createMockWebviewView();
    creatorProvider.resolveWebviewView(mockWebviewView, {}, { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => {} }) });

    creatorProvider.setBranchName('feat/auto');

    const msg = postedMessages.find((m: any) => m.command === 'setBranchName');
    assert.ok(msg, 'Should post setBranchName message');
    assert.strictEqual(msg.name, 'feat/auto');
  });
});

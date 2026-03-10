import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Extension Activation', () => {
  const extensionId = 'ZunRenYao.lumi-ops';

  test('extension should be present', () => {
    const extension = vscode.extensions.getExtension(extensionId);
    assert.ok(extension, `Extension ${extensionId} should be installed`);
  });

  test('extension should activate successfully', async () => {
    const extension = vscode.extensions.getExtension(extensionId)!;
    await extension.activate();
    assert.strictEqual(extension.isActive, true, 'Extension should be active after activation');
  });
});

suite('Command Registration', () => {
  const expectedCommands = [
    'lumi-ops.spawn',
    'lumi-ops.kill',
    'lumi-ops.merge',
    'lumi-ops.refresh',
    'lumi-ops.open',
    'lumi-ops.cycleReviewStatus',
    'lumi-ops.copyBranchName',
    'lumi-ops.returnToRoot',
    'lumi-ops.openWorktreeManager',
    'lumi-ops.openSettings',
    'lumi-ops.pickCopyFolders',
    'lumi-ops.openPromptFile',
    'lumi-ops.saveAsPrompt',
    'lumi-ops.rebase',
    'lumi-ops.abortRebase',
    'lumi-ops.getBranches',
  ];

  let registeredCommands: string[];

  suiteSetup(async () => {
    // Ensure extension is activated
    const extension = vscode.extensions.getExtension('ZunRenYao.lumi-ops')!;
    await extension.activate();

    // Get all registered commands (including internal)
    registeredCommands = await vscode.commands.getCommands(true);
  });

  for (const cmd of expectedCommands) {
    test(`command "${cmd}" should be registered`, () => {
      assert.ok(
        registeredCommands.includes(cmd),
        `Command "${cmd}" should be registered but was not found`
      );
    });
  }
});

suite('Configuration', () => {
  const configKeys: Array<{ key: string; expectedDefault: unknown }> = [
    { key: 'rootAgentMode', expectedDefault: false },
    { key: 'copyOnSpawn', expectedDefault: '' },
    { key: 'cloneAgentRules', expectedDefault: true },
    { key: 'activeMissionTemplate', expectedDefault: 'default' },
  ];

  for (const { key, expectedDefault } of configKeys) {
    test(`configuration "lumi-ops.${key}" should be accessible with correct default`, () => {
      const config = vscode.workspace.getConfiguration('lumi-ops');
      const value = config.get(key);
      assert.strictEqual(
        value,
        expectedDefault,
        `Config "lumi-ops.${key}" should default to ${JSON.stringify(expectedDefault)}, got ${JSON.stringify(value)}`
      );
    });
  }
});

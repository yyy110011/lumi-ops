import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Commands — Branches', () => {
  let registeredCommands: string[];

  suiteSetup(async () => {
    const extension = vscode.extensions.getExtension('ZunRenYao.lumi-ops')!;
    await extension.activate();
    registeredCommands = await vscode.commands.getCommands(true);
  });

  test('lumi-ops.getBranches command is registered', () => {
    assert.ok(
      registeredCommands.includes('lumi-ops.getBranches'),
      'getBranches command should be registered'
    );
  });

  test('lumi-ops.getBranches executes without error', async () => {
    // The test fixture is a git repo — getBranches should work
    await assert.doesNotReject(
      async () => { await vscode.commands.executeCommand('lumi-ops.getBranches'); },
      'getBranches command should execute without error'
    );
  });

  test('lumi-ops.copyBranchName command is registered', () => {
    assert.ok(
      registeredCommands.includes('lumi-ops.copyBranchName'),
      'copyBranchName command should be registered'
    );
  });

  test('lumi-ops.copyBranchName executes without error (no argument)', async () => {
    // Without an item argument, it should return early silently
    await assert.doesNotReject(
      async () => { await vscode.commands.executeCommand('lumi-ops.copyBranchName'); },
      'copyBranchName should not throw when called without arguments'
    );
  });
});

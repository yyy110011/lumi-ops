import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Commands — Navigation', () => {
  let registeredCommands: string[];

  suiteSetup(async () => {
    const extension = vscode.extensions.getExtension('ZunRenYao.lumi-ops')!;
    await extension.activate();
    registeredCommands = await vscode.commands.getCommands(true);
  });

  test('lumi-ops.open command is registered', () => {
    assert.ok(
      registeredCommands.includes('lumi-ops.open'),
      'open command should be registered'
    );
  });

  test('lumi-ops.open executes without error (no argument → noop)', async () => {
    // Without a valid `item` argument, `open` checks `item?.clone?.path` and does nothing
    await assert.doesNotReject(
      async () => { await vscode.commands.executeCommand('lumi-ops.open'); },
      'open command should not throw when called without arguments'
    );
  });

  test('lumi-ops.returnToRoot command is registered', () => {
    assert.ok(
      registeredCommands.includes('lumi-ops.returnToRoot'),
      'returnToRoot command should be registered'
    );
  });

  test('lumi-ops.cycleReviewStatus command is registered', () => {
    assert.ok(
      registeredCommands.includes('lumi-ops.cycleReviewStatus'),
      'cycleReviewStatus command should be registered'
    );
  });

  test('lumi-ops.cycleReviewStatus executes without error (no argument)', async () => {
    // Without a branchName argument, it returns early
    await assert.doesNotReject(
      async () => { await vscode.commands.executeCommand('lumi-ops.cycleReviewStatus'); },
      'cycleReviewStatus should not throw when called without arguments'
    );
  });

  test('lumi-ops.copyBranchName command is registered', () => {
    assert.ok(
      registeredCommands.includes('lumi-ops.copyBranchName'),
      'copyBranchName command should be registered'
    );
  });
});

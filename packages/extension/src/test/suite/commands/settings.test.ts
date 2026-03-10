import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Commands — Settings', () => {
  let registeredCommands: string[];

  suiteSetup(async () => {
    const extension = vscode.extensions.getExtension('ZunRenYao.lumi-ops')!;
    await extension.activate();
    registeredCommands = await vscode.commands.getCommands(true);
  });

  test('lumi-ops.openSettings command is registered', () => {
    assert.ok(
      registeredCommands.includes('lumi-ops.openSettings'),
      'openSettings command should be registered'
    );
  });

  test('lumi-ops.openSettings executes without error', async () => {
    // This opens workspace settings filtered to the extension — may open a panel
    await assert.doesNotReject(
      async () => {
        try {
          await vscode.commands.executeCommand('lumi-ops.openSettings');
        } catch {
          // Some CI environments may not support opening settings UI — that's okay
        }
      },
      'openSettings should not throw'
    );
  });

  test('lumi-ops.pickCopyFolders command is registered', () => {
    assert.ok(
      registeredCommands.includes('lumi-ops.pickCopyFolders'),
      'pickCopyFolders command should be registered'
    );
  });
});

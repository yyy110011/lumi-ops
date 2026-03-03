import * as vscode from 'vscode';
import { kill } from '@lumi-ops/cli';
import { CommandDeps } from './types';

export function registerKillCommands(
  context: vscode.ExtensionContext,
  deps: CommandDeps,
): vscode.Disposable[] {
  const { rootPath, shadowTreeProvider, creatorProvider } = deps;

  const killCmd = vscode.commands.registerCommand('lumi-ops.kill', async (item: any) => {
    const branchName = item?.clone?.branch || await vscode.window.showInputBox({
      prompt: 'Enter the branch name to kill',
      placeHolder: 'feature/my-old-task'
    });

    if (branchName) {
      const choice = await vscode.window.showWarningMessage(
        `How do you want to kill the shadow clone for "${branchName}"?`,
        { modal: true },
        'Remove Clone Only',
        'Kill Clone + Branch'
      );

      if (choice === 'Kill Clone + Branch' || choice === 'Remove Clone Only') {
        const keepBranch = choice === 'Remove Clone Only';
        try {
          await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Killing shadow clone: ${branchName}`,
            cancellable: false
          }, async () => {
            await kill(branchName, { root: rootPath!, keepBranch });
          });
          
          const msg = keepBranch
            ? `Shadow clone ${branchName} removed (branch preserved).`
            : `Shadow clone ${branchName} killed.`;
          vscode.window.showInformationMessage(msg);
          shadowTreeProvider.refresh();
          creatorProvider.resetForm();
        } catch (error: any) {
          vscode.window.showErrorMessage(`Failed to kill shadow clone: ${error.message}`);
        }
      }
    }
  });

  return [killCmd];
}

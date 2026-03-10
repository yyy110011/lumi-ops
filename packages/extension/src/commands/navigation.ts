import * as vscode from 'vscode';
import { CommandDeps } from './types';

export function registerNavigationCommands(
  context: vscode.ExtensionContext,
  deps: CommandDeps,
): vscode.Disposable[] {
  const { rootPath, shadowTreeProvider } = deps;

  const open = vscode.commands.registerCommand('lumi-ops.open', (item: any) => {
    const clonePath = item?.clone?.path;
    if (clonePath) {
      const uri = vscode.Uri.file(clonePath);
      vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: true });
    }
  });

  const cycleReviewStatus = vscode.commands.registerCommand('lumi-ops.cycleReviewStatus', async (branchName: string) => {
    if (!branchName) return;
    shadowTreeProvider.cycleReviewStatus(branchName);
  });

  const copyBranchName = vscode.commands.registerCommand('lumi-ops.copyBranchName', async (item: any) => {
    const branchName = item?.clone?.currentBranch;
    if (!branchName) return;
    await vscode.env.clipboard.writeText(branchName);
    vscode.window.showInformationMessage(`Copied: ${branchName}`);
  });

  const returnToRoot = vscode.commands.registerCommand('lumi-ops.returnToRoot', async () => {
    if (rootPath) {
      const uri = vscode.Uri.file(rootPath);
      vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: false });
    }
  });

  return [open, cycleReviewStatus, copyBranchName, returnToRoot];
}

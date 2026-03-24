import * as vscode from 'vscode';
import { CommandDeps } from './types';

export function registerNavigationCommands(
  context: vscode.ExtensionContext,
  deps: CommandDeps,
): vscode.Disposable[] {
  const { rootPath, allRoots, shadowTreeProvider } = deps;
  const isMultiRoot = (allRoots?.length ?? 0) > 1;

  const open = vscode.commands.registerCommand('lumi-ops.open', (item: any) => {
    const clonePath = item?.clone?.path;
    if (!clonePath) return;

    // Skip if already open in current workspace
    const alreadyOpen = vscode.workspace.workspaceFolders?.some(
      f => f.uri.fsPath === clonePath
    );
    if (alreadyOpen) return;

    const uri = vscode.Uri.file(clonePath);
    vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: true });
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

  const returnToRoot = vscode.commands.registerCommand('lumi-ops.returnToRoot', async (targetRoot?: string) => {
    const target = targetRoot || rootPath;
    if (!target) return;

    // Check if target is already in the current workspace folders
    const alreadyOpen = vscode.workspace.workspaceFolders?.some(
      f => f.uri.fsPath === target
    );
    if (alreadyOpen) {
      // Already visible — no-op
      return;
    }

    const uri = vscode.Uri.file(target);
    // Multi-root: always new window (don't replace current workspace)
    // Single-root: replace current window (original behavior)
    vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: isMultiRoot });
  });

  return [open, cycleReviewStatus, copyBranchName, returnToRoot];
}

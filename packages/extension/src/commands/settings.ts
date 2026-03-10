import * as vscode from 'vscode';
import * as path from 'path';
import { GitUtils } from '@lumi-ops/cli';
import { CommandDeps } from './types';

export function registerSettingsCommands(
  context: vscode.ExtensionContext,
  deps: CommandDeps,
): vscode.Disposable[] {
  const { rootPath } = deps;

  const openSettings = vscode.commands.registerCommand('lumi-ops.openSettings', () => {
    vscode.commands.executeCommand('workbench.action.openWorkspaceSettings', '@ext:ZunRenYao.lumi-ops');
  });

  const pickCopyFolders = vscode.commands.registerCommand('lumi-ops.pickCopyFolders', async () => {
    if (!rootPath) {
      vscode.window.showErrorMessage('No workspace folder open.');
      return;
    }

    try {
      const git = new GitUtils(rootPath);
      const untrackedEntries = await git.listUntrackedEntries();

      if (untrackedEntries.length === 0) {
        vscode.window.showInformationMessage('No untracked/gitignored files found in workspace root.');
        return;
      }

      const config = vscode.workspace.getConfiguration('lumi-ops');
      const currentStr = config.get<string>('copyOnSpawn') || '';
      const current = currentStr.split('\n').map((s: string) => s.trim()).filter(Boolean);
      const currentSet = new Set(current);

      const items: vscode.QuickPickItem[] = [];
      for (const name of untrackedEntries) {
        const entryUri = vscode.Uri.file(path.join(rootPath, name));
        let isDir = false;
        try {
          const stat = await vscode.workspace.fs.stat(entryUri);
          isDir = (stat.type & vscode.FileType.Directory) !== 0;
        } catch { /* skip if can't stat */ }
        items.push({
          label: isDir ? `$(folder) ${name}` : `$(file) ${name}`,
          description: name,
          picked: currentSet.has(name),
        });
      }

      const selected = await vscode.window.showQuickPick(items, {
        canPickMany: true,
        placeHolder: 'Select untracked/gitignored items to copy into shadow clones on spawn',
      });

      if (selected !== undefined) {
        const selectedNames = selected.map((item: vscode.QuickPickItem) => item.description!);
        await config.update('copyOnSpawn', selectedNames.join('\n'), vscode.ConfigurationTarget.Workspace);
        vscode.window.showInformationMessage(`Copy on Spawn: ${selectedNames.length} item(s) configured.`);
      }
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to list workspace entries: ${error.message}`);
    }
  });

  return [openSettings, pickCopyFolders];
}

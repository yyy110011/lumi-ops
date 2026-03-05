import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { GitUtils, getRepoStorageDir, METADATA_FILE } from '@lumi-ops/cli';
import type { CommandDeps } from './types';
import type { ShadowItem } from '../ShadowTreeProvider';

export function registerRebaseCommands(
  context: vscode.ExtensionContext,
  deps: CommandDeps
): vscode.Disposable[] {
  const { rootPath, statusBus } = deps;

  return [
    vscode.commands.registerCommand('lumi-ops.rebase', async (item?: ShadowItem) => {
      if (!rootPath || !item) return;

      const branch = item.clone.branch;
      const metadataPath = path.join(getRepoStorageDir(rootPath), METADATA_FILE);

      // Read baseBranch from metadata
      let metadata: Record<string, any> = {};
      try {
        const raw = fs.readFileSync(metadataPath, 'utf-8');
        metadata = JSON.parse(raw);
      } catch {
        vscode.window.showErrorMessage('Could not read clone metadata.');
        return;
      }

      const baseBranch = metadata[branch]?.baseBranch;
      if (!baseBranch) {
        vscode.window.showWarningMessage(`No base branch recorded for "${branch}".`);
        return;
      }

      const clonePath = item.clone.path;
      const git = new GitUtils(clonePath);

      try {
        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: `Rebasing ${branch} onto ${baseBranch}…` },
          async () => {
            await git.rebase(baseBranch);
          }
        );

        // Success — update metadata
        metadata[branch].needsRebase = false;
        fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
        statusBus.fire('*');
        vscode.window.showInformationMessage(`✅ Rebased "${branch}" onto "${baseBranch}" successfully.`);
      } catch (err: any) {
        // Rebase conflict — abort the rebase so the worktree isn't stuck
        try {
          await git.rebase('--abort');
        } catch {
          // abort may fail if rebase wasn't started — that's ok
        }
        vscode.window.showWarningMessage(
          `⚠️ Rebase of "${branch}" onto "${baseBranch}" failed with conflicts. ` +
          `Open the clone and resolve manually.`
        );
      }
    }),
  ];
}

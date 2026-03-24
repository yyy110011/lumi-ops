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
      if (!item || !item.clone) return;
      // Resolve root from clone metadata (multi-root support) or fallback
      const effectiveRoot = (item.clone as any).repoRoot || rootPath;
      if (!effectiveRoot) return;

      const branch = item.clone.branch;
      const metadataPath = path.join(getRepoStorageDir(effectiveRoot), METADATA_FILE);

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
        // Rebase conflict — do NOT abort. Leave conflict state for manual resolution.
        statusBus.fire('*'); // Refresh sidebar to show 🔀 rebasing prefix
        vscode.window.showWarningMessage(
          `⚠️ Rebase of "${branch}" onto "${baseBranch}" has conflicts. ` +
          `Open the clone to resolve, or right-click → Abort Rebase.`
        );
      }
    }),

    vscode.commands.registerCommand('lumi-ops.abortRebase', async (item?: ShadowItem) => {
      if (!item || !item.clone) return;
      const clonePath = item.clone.path;
      const git = new GitUtils(clonePath);
      try {
        await git.rebase('--abort');
        statusBus.fire('*');
        vscode.window.showInformationMessage(`Rebase aborted for "${item.clone.dirName}".`);
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to abort rebase: ${err.message}`);
      }
    }),
  ];
}

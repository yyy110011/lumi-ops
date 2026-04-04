import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { getRepoStorageDir, METADATA_FILE, ROOT_AGENT_RULE_CONTENT } from '@lumi-ops/cli';
import type { CommandDeps } from './types';
import type { ShadowItem } from '../ShadowTreeProvider';

export function registerCloneTypeCommands(
  context: vscode.ExtensionContext,
  deps: CommandDeps,
): vscode.Disposable[] {
  const { rootPath, shadowTreeProvider, statusBus } = deps;

  const convertToIntegration = vscode.commands.registerCommand(
    'lumi-ops.convertToIntegration',
    async (item?: ShadowItem) => {
      if (!item || !item.clone) return;
      const clone = item.clone;
      const effectiveRoot = clone.repoRoot || rootPath;
      if (!effectiveRoot) return;

      const cloneId = clone.dirName;

      // 1. Update metadata: set cloneType = 'integration'
      const metadataPath = path.join(getRepoStorageDir(effectiveRoot), METADATA_FILE);
      try {
        let metadata: Record<string, any> = {};
        try {
          const raw = fs.readFileSync(metadataPath, 'utf-8');
          metadata = JSON.parse(raw);
        } catch {
          // No metadata yet — will create
        }

        if (!metadata[cloneId]) {
          metadata[cloneId] = {};
        }
        metadata[cloneId].cloneType = 'integration';
        fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to update metadata: ${err.message}`);
        return;
      }

      // 2. Write root agent rules into clone's .agents/rules/
      const rulesDir = path.join(clone.path, '.agents', 'rules');
      try {
        await fs.promises.mkdir(rulesDir, { recursive: true });
        await fs.promises.writeFile(
          path.join(rulesDir, 'lumi-ops-root-agent.md'),
          ROOT_AGENT_RULE_CONTENT,
        );

        // 3. Remove clone agent rules if present
        const cloneAgentPath = path.join(rulesDir, 'lumi-ops-clone-agent.md');
        try {
          await fs.promises.unlink(cloneAgentPath);
        } catch {
          // Doesn't exist — fine
        }
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to write agent rules: ${err.message}`);
        return;
      }

      // 4. Fire refresh
      statusBus.fire('*');
      shadowTreeProvider.refresh();

      // 5. Show notification
      vscode.window.showInformationMessage(
        `🔀 "${cloneId}" promoted to Integration Branch. Root agent rules injected.`,
      );
    },
  );

  return [convertToIntegration];
}

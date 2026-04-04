import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ROOT_AGENT_RULE_CONTENT } from '@lumi-ops/cli';

const RULE_FILENAME = 'lumi-ops-root-agent.md';

function getRulesDir(rootPath: string): string {
  return path.join(rootPath, '.agents', 'rules');
}

export async function syncRootAgentRule(rootPath: string, isCloneWorkspace: boolean): Promise<void> {
  const config = vscode.workspace.getConfiguration('lumi-ops');
  const enabled = config.get<boolean>('rootAgentMode', false);
  const rulesDir = getRulesDir(rootPath);
  const ruleFilePath = path.join(rulesDir, RULE_FILENAME);

  if (enabled && !isCloneWorkspace) {
    // Write rule file
    await fs.promises.mkdir(rulesDir, { recursive: true });
    await fs.promises.writeFile(ruleFilePath, ROOT_AGENT_RULE_CONTENT);
  } else if (!isCloneWorkspace) {
    // Only clean up in root workspace context — clone windows must not touch root rules
    try { await fs.promises.unlink(ruleFilePath); } catch { /* doesn't exist */ }
  }
}

export function registerRootAgentMode(
  context: vscode.ExtensionContext,
  rootPath: string | undefined,
  isCloneWorkspace: boolean,
): void {
  if (!rootPath) return;

  // Sync on activation
  syncRootAgentRule(rootPath, isCloneWorkspace);

  // Re-sync when the setting changes
  const disposable = vscode.workspace.onDidChangeConfiguration((e: vscode.ConfigurationChangeEvent) => {
    if (e.affectsConfiguration('lumi-ops.rootAgentMode')) {
      syncRootAgentRule(rootPath, isCloneWorkspace);
    }
  });

  context.subscriptions.push(disposable);
}

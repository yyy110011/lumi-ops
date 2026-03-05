import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

const RULE_FILENAME = 'lumi-ops-clone-agent.md';

const CLONE_AGENT_RULE_CONTENT = `# Clone Agent Rules (Lumi-Ops)

You are working inside a **Shadow Clone** worktree managed by the Lumi-Ops extension.

## After Completing Work

1. Create \`MISSION_COMPLETE.md\` in the worktree root summarising what you did.
2. Call the MCP tool **set_clone_status** with status \`needsReview\`.

## Revision Cycle

If a file called \`REVIEW_FEEDBACK.md\` exists in the worktree root, you are in a **revision cycle**:

1. Read \`MISSION.md\` → \`MISSION_COMPLETE.md\` → \`REVIEW_FEEDBACK.md\` (in that order).
2. Address every item listed in the feedback.
3. Update \`MISSION_COMPLETE.md\` with what you changed.
4. Call **set_clone_status** with status \`needsReview\` again.
`;

function getRulesDir(rootPath: string): string {
  return path.join(rootPath, '.agents', 'rules');
}

async function syncCloneAgentRule(rootPath: string, isCloneWorkspace: boolean): Promise<void> {
  const config = vscode.workspace.getConfiguration('lumi-ops');
  const enabled = config.get<boolean>('cloneAgentRules', false);
  const rulesDir = getRulesDir(rootPath);
  const ruleFilePath = path.join(rulesDir, RULE_FILENAME);

  if (enabled && isCloneWorkspace) {
    // Write rule file
    await fs.promises.mkdir(rulesDir, { recursive: true });
    await fs.promises.writeFile(ruleFilePath, CLONE_AGENT_RULE_CONTENT);
  } else {
    // Delete rule file if it exists
    try { await fs.promises.unlink(ruleFilePath); } catch { /* doesn't exist */ }
  }
}

export function registerCloneAgentRules(
  context: vscode.ExtensionContext,
  rootPath: string | undefined,
  isCloneWorkspace: boolean,
): void {
  if (!rootPath) return;

  // Sync on activation
  syncCloneAgentRule(rootPath, isCloneWorkspace);

  // Re-sync when the setting changes
  const disposable = vscode.workspace.onDidChangeConfiguration((e: vscode.ConfigurationChangeEvent) => {
    if (e.affectsConfiguration('lumi-ops.cloneAgentRules')) {
      syncCloneAgentRule(rootPath, isCloneWorkspace);
    }
  });

  context.subscriptions.push(disposable);
}

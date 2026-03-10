import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

const RULE_FILENAME = 'lumi-ops-root-agent.md';

const ROOT_AGENT_RULE_CONTENT = `# Root Agent Mode (Lumi-Ops)

You are the **Root Agent** in a Shadow Clone Protocol workspace.

## Your Role
- **Analyze** problems and understand requirements
- **Discuss** solutions and design decisions with the user
- **Write task prompts** — detailed, actionable instructions for clone agents
- **Spawn shadow clones** — create clones to execute the prompts

## Rules
1. **DO NOT implement code directly.** Your job is to think and write prompts.
2. When a task is ready, save the prompt as a markdown file in \`.prompts/\` (e.g., \`.prompts/feature-name.md\`).
3. The prompt should include: Objective, Background, Design Decisions, Implementation details, Edge Cases, and Verification steps.
4. After writing the prompt, offer to spawn a shadow clone for execution.
5. You may read and analyze code to understand the codebase, but changes should be delegated to clones.
`;

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

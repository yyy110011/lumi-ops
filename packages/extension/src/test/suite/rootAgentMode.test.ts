import * as assert from 'assert';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Polls for a condition to become true, retrying at a fixed interval.
 * More reliable than fixed setTimeout — returns immediately when met,
 * and tolerates slow CI environments by waiting up to `timeoutMs`.
 */
async function waitForCondition(
  condition: () => boolean,
  timeoutMs: number = 5000,
  intervalMs: number = 100
): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Condition not met within ${timeoutMs}ms`);
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
}

suite('Root Agent Mode', () => {
  const RULE_FILENAME = 'lumi-ops-root-agent.md';
  let workspaceRoot: string;
  let rulesDir: string;
  let ruleFilePath: string;
  let syncRootAgentRule: (rootPath: string, isCloneWorkspace: boolean) => Promise<void>;

  suiteSetup(async () => {
    // Use the test fixture workspace root
    const wsFolder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(wsFolder, 'Workspace folder should be available');
    workspaceRoot = wsFolder.uri.fsPath;
    rulesDir = path.join(workspaceRoot, '.agents', 'rules');
    ruleFilePath = path.join(rulesDir, RULE_FILENAME);

    // Get the syncRootAgentRule function from the extension's API
    const ext = vscode.extensions.getExtension('ZunRenYao.lumi-ops');
    assert.ok(ext, 'Extension should be available');
    const api = ext.isActive ? ext.exports : await ext.activate();
    assert.ok(api?.syncRootAgentRule, 'syncRootAgentRule should be exposed in the extension API');
    syncRootAgentRule = api.syncRootAgentRule;
  });

  teardown(async () => {
    // Always disable rootAgentMode and clean up the rule file after each test
    const config = vscode.workspace.getConfiguration('lumi-ops');
    await config.update('rootAgentMode', false, vscode.ConfigurationTarget.Workspace);

    // Directly sync to remove the file (isCloneWorkspace=false to allow cleanup)
    await syncRootAgentRule(workspaceRoot, false);

    // Force-remove any remnant
    try { fs.unlinkSync(ruleFilePath); } catch { /* doesn't exist */ }
  });

  test('enabling rootAgentMode creates the rule file', async () => {
    const config = vscode.workspace.getConfiguration('lumi-ops');
    await config.update('rootAgentMode', true, vscode.ConfigurationTarget.Workspace);

    // Directly call syncRootAgentRule to trigger file creation
    // (The config change listener may not fire in worktree-based test envs)
    await syncRootAgentRule(workspaceRoot, false);
    await waitForCondition(() => fs.existsSync(ruleFilePath));

    assert.ok(
      fs.existsSync(ruleFilePath),
      `Rule file should exist at ${ruleFilePath} when rootAgentMode is enabled`
    );

    // Verify content
    const content = fs.readFileSync(ruleFilePath, 'utf-8');
    assert.ok(content.includes('Root Agent Mode'), 'Rule file should contain Root Agent Mode header');
    assert.ok(content.includes('DO NOT implement code directly'), 'Rule file should contain instructions');
  });

  test('disabling rootAgentMode removes the rule file', async () => {
    // First enable
    const config = vscode.workspace.getConfiguration('lumi-ops');
    await config.update('rootAgentMode', true, vscode.ConfigurationTarget.Workspace);
    await syncRootAgentRule(workspaceRoot, false);
    await waitForCondition(() => fs.existsSync(ruleFilePath));
    assert.ok(fs.existsSync(ruleFilePath), 'Rule file should exist after enabling');

    // Then disable
    await config.update('rootAgentMode', false, vscode.ConfigurationTarget.Workspace);
    await syncRootAgentRule(workspaceRoot, false);
    await waitForCondition(() => !fs.existsSync(ruleFilePath));

    assert.ok(
      !fs.existsSync(ruleFilePath),
      'Rule file should be removed when rootAgentMode is disabled'
    );
  });

  test('toggle cycle: enable → disable → enable works correctly', async () => {
    const config = vscode.workspace.getConfiguration('lumi-ops');

    // Enable
    await config.update('rootAgentMode', true, vscode.ConfigurationTarget.Workspace);
    await syncRootAgentRule(workspaceRoot, false);
    await waitForCondition(() => fs.existsSync(ruleFilePath));
    assert.ok(fs.existsSync(ruleFilePath), 'Rule file should exist after first enable');

    // Disable
    await config.update('rootAgentMode', false, vscode.ConfigurationTarget.Workspace);
    await syncRootAgentRule(workspaceRoot, false);
    await waitForCondition(() => !fs.existsSync(ruleFilePath));
    assert.ok(!fs.existsSync(ruleFilePath), 'Rule file should be gone after disable');

    // Re-enable
    await config.update('rootAgentMode', true, vscode.ConfigurationTarget.Workspace);
    await syncRootAgentRule(workspaceRoot, false);
    await waitForCondition(() => fs.existsSync(ruleFilePath));
    assert.ok(fs.existsSync(ruleFilePath), 'Rule file should exist after re-enable');
  });
});

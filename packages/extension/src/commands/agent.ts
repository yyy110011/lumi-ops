import * as vscode from 'vscode';
import { launch, resolveAgentStatus, hasSession, attachSession, getClonesDir } from '@lumi-ops/cli';
import type { DriverName } from '@lumi-ops/cli';
import { CommandDeps } from './types';
import * as path from 'path';

export function registerAgentCommands(
  context: vscode.ExtensionContext,
  deps: CommandDeps,
): vscode.Disposable[] {
  const { rootPath, shadowTreeProvider } = deps;

  const launchCmd = vscode.commands.registerCommand('lumi-ops.launchAgent', async (item: any) => {
    const cloneId = item?.clone?.dirName;
    if (!cloneId || !rootPath) {
      vscode.window.showErrorMessage('Cannot launch agent: no clone selected or no workspace root.');
      return;
    }

    // Read configured driver from settings
    const config = vscode.workspace.getConfiguration('lumi-ops');
    const driver = config.get<string>('driver', 'claude') as DriverName;

    try {
      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `🤖 Launching ${driver} on ${cloneId}...`,
        cancellable: false,
      }, async () => {
        await launch(cloneId, {
          root: rootPath!,
          driver,
        });
      });

      vscode.window.showInformationMessage(`✨ Agent (${driver}) running on ${cloneId}`);
      shadowTreeProvider.refresh();
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to launch agent: ${error.message}`);
    }
  });

  const attachCmd = vscode.commands.registerCommand('lumi-ops.attachAgent', async (item: any) => {
    const cloneId = item?.clone?.dirName;
    if (!cloneId || !rootPath) {
      vscode.window.showErrorMessage('Cannot attach: no clone selected or no workspace root.');
      return;
    }

    const worktreePath = path.join(getClonesDir(rootPath), cloneId);

    try {
      const status = await resolveAgentStatus(worktreePath);

      if (!status) {
        vscode.window.showWarningMessage(`No agent has been launched on "${cloneId}" yet. Use ▶ Launch Agent first.`);
        return;
      }

      if (!hasSession(status.tmuxSession)) {
        vscode.window.showWarningMessage(`Agent session ended (status: ${status.status}). Launch a new agent to start a fresh session.`);
        return;
      }

      // Open a VS Code terminal attached to the tmux session
      const terminal = vscode.window.createTerminal({
        name: `🤖 ${cloneId}`,
        shellPath: '/usr/bin/env',
        shellArgs: ['tmux', 'attach-session', '-t', status.tmuxSession],
      });
      terminal.show();
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to attach: ${error.message}`);
    }
  });

  return [launchCmd, attachCmd];
}

import * as vscode from 'vscode';
import { spawn, GitUtils } from '@lumi-ops/cli';
import { CommandDeps } from './types';

export function registerSpawnCommands(
  context: vscode.ExtensionContext,
  deps: CommandDeps,
): vscode.Disposable[] {
  const { rootPath, shadowTreeProvider, creatorProvider, missionTemplateProvider } = deps;

  const refresh = vscode.commands.registerCommand('lumi-ops.refresh', () => {
    shadowTreeProvider.refresh();
  });

  const spawnCmd = vscode.commands.registerCommand('lumi-ops.spawn', async (args?: { branch: string, description: string, baseBranch?: string, templates?: { name: string; content: string }[] }) => {
    if (!rootPath) {
      vscode.window.showErrorMessage('No workspace folder open.');
      return;
    }

    let branchName = args?.branch;
    let description = args?.description;
    let baseBranch = args?.baseBranch;

    if (!branchName) {
      branchName = await vscode.window.showInputBox({
        prompt: 'Enter the name for the new feature branch / shadow clone',
        placeHolder: 'feature/my-new-task'
      });
    }

    if (!args && branchName && !description) {
      description = await vscode.window.showInputBox({
        prompt: 'Enter a task description / objective for this agent (leave empty to skip)',
        placeHolder: 'e.g. Refactor the login page using Zod validation'
      });
    }

    if (branchName) {
      try {

        await vscode.window.withProgress({
          location: vscode.ProgressLocation.Notification,
          title: `Spawning shadow clone: ${branchName}`,
          cancellable: false
        }, async (progress: vscode.Progress<{ message?: string }>) => {
          const git = new GitUtils(rootPath);

          // If the target branch doesn't exist locally, fetch it from remote (no checkout)
          const localExists = await git.branchExists(branchName);
          if (!localExists) {
            const remoteBranches = await git.listRemoteBranches();
            const matchingRemote = remoteBranches.find((rb: string) => {
              const slashIdx = rb.indexOf('/');
              const shortName = slashIdx >= 0 ? rb.substring(slashIdx + 1) : rb;
              return shortName === branchName;
            });
            if (matchingRemote) {
              const remoteName = matchingRemote.substring(0, matchingRemote.indexOf('/'));
              await git.fetchBranch(branchName, remoteName);
            }
          }

          // If baseBranch is a remote-only branch, fetch it locally (no checkout needed)
          if (baseBranch) {
            const baseExists = await git.branchExists(baseBranch);
            if (!baseExists) {
              const remoteBranches = await git.listRemoteBranches();
              const matchingRemote = remoteBranches.find((rb: string) => {
                const slashIdx = rb.indexOf('/');
                const shortName = slashIdx >= 0 ? rb.substring(slashIdx + 1) : rb;
                return shortName === baseBranch;
              });
              if (matchingRemote) {
                const remoteName = matchingRemote.substring(0, matchingRemote.indexOf('/'));
                await git.fetchBranch(baseBranch, remoteName);
              }
            }
          }

          await spawn(branchName, { root: rootPath, description, baseBranch, templates: args?.templates,
            copyFolders: (vscode.workspace.getConfiguration('lumi-ops').get<string>('copyOnSpawn') || '').split('\n').map((s: string) => s.trim()).filter(Boolean),
            onProgress: (message: string) => progress.report({ message }),
            missionTemplate: await (async () => {
              try {
                const active = await missionTemplateProvider.getActiveTemplate();
                if (active.name !== 'default' || active.rules || active.instructions) {
                  return { task: active.task, rules: active.rules, instructions: active.instructions };
                }
              } catch { /* fallback to default */ }
              return undefined;
            })()
          });

        });

        
        vscode.window.showInformationMessage(`Shadow clone ${branchName} created successfully.`);
        shadowTreeProvider.refresh();
        creatorProvider.resetForm();
      } catch (error: any) {
        vscode.window.showErrorMessage(`Failed to spawn shadow clone: ${error.message}`);
      }
    }
  });

  return [refresh, spawnCmd];
}

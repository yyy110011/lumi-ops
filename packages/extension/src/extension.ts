import * as vscode from 'vscode';
import * as path from 'path';
import { ShadowTreeProvider } from './ShadowTreeProvider';
import { ShadowCreatorProvider } from './ShadowCreatorProvider';


import { spawn, kill, merge, GitUtils } from '@lumi-ops/cli';



export async function activate(context: vscode.ExtensionContext) {

  // DEV MODE HACK: Auto-open the monorepo root if debugging and no folder is open
  if (context.extensionMode === vscode.ExtensionMode.Development) {
    if (!vscode.workspace.workspaceFolders) {
      vscode.window.showInformationMessage('🚀 Dev Mode: Auto-opening workspace...');

      // Assuming the extension is running from packages/extension, we go up two levels to root
      const rootPath = path.resolve(context.extensionPath, '../../');
      const uri = vscode.Uri.file(rootPath);

      vscode.commands.executeCommand('vscode.openFolder', uri);
      return; // Stop activation here as the window will reload
    }
  }

  // Auto-open MISSION.md when in a shadow clone workspace
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0];
  if (workspaceRoot) {
    const missionFile = vscode.Uri.joinPath(workspaceRoot.uri, 'MISSION.md');
    
    setTimeout(async () => {
      try {
        await vscode.workspace.fs.stat(missionFile);
        
        const doc = await vscode.workspace.openTextDocument(missionFile);
        await vscode.window.showTextDocument(doc, { 
          preview: false,
          preserveFocus: true 
        });
        
        const action = await vscode.window.showInformationMessage(
          '👻 Shadow Clone ready! Copy prompt to paste in chat?',
          'Copy Prompt'
        );
        if (action === 'Copy Prompt') {
          await vscode.env.clipboard.writeText(
            'Please read @MISSION.md and start working on the objective described in it.'
          );
          vscode.window.showInformationMessage('✅ Prompt copied to clipboard!');
        }
      } catch (e) {
        // No MISSION.md found, not a shadow clone workspace
      }
    }, 1000);
  }




  const rootPath = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0
    ? vscode.workspace.workspaceFolders[0].uri.fsPath
    : undefined;

  const shadowTreeProvider = new ShadowTreeProvider(rootPath);
  vscode.window.registerTreeDataProvider('lumi-ops.activeClones', shadowTreeProvider);

  const creatorProvider = new ShadowCreatorProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('lumi-ops.creator', creatorProvider)
  );

  // -- Polling for live updates --
  const pollInterval = setInterval(() => {
    shadowTreeProvider.refresh();
  }, 5000);

  // -- Instant refresh on branch switch (watch .git/HEAD) --
  if (rootPath) {
    const gitHeadPattern = new vscode.RelativePattern(rootPath, '.git/HEAD');
    const gitHeadWatcher = vscode.workspace.createFileSystemWatcher(gitHeadPattern);
    gitHeadWatcher.onDidChange(() => shadowTreeProvider.refresh());
    context.subscriptions.push(gitHeadWatcher);
  }

  // Clean up on deactivate
  context.subscriptions.push({
    dispose: () => clearInterval(pollInterval)
  });

  // -- Commands --

  context.subscriptions.push(
    vscode.commands.registerCommand('lumi-ops.refresh', () => {
      shadowTreeProvider.refresh();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('lumi-ops.spawn', async (args?: { branch: string, description: string }) => {
      if (!rootPath) {
        vscode.window.showErrorMessage('No workspace folder open.');
        return;
      }

      let branchName = args?.branch;
      let description = args?.description;

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
          }, async () => {
            await spawn(branchName, { root: rootPath, description });

          });

          
          vscode.window.showInformationMessage(`Shadow clone ${branchName} created successfully.`);
          shadowTreeProvider.refresh();
          creatorProvider.resetForm();
        } catch (error: any) {
          vscode.window.showErrorMessage(`Failed to spawn shadow clone: ${error.message}`);
        }
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('lumi-ops.kill', async (item: any) => {
      const branchName = item?.clone?.branch || await vscode.window.showInputBox({
        prompt: 'Enter the branch name to kill',
        placeHolder: 'feature/my-old-task'
      });

      if (branchName) {
        const choice = await vscode.window.showWarningMessage(
          `How do you want to kill the shadow clone for "${branchName}"?`,
          { modal: true },
          'Remove Clone Only',
          'Kill Clone + Branch'
        );

        if (choice === 'Kill Clone + Branch' || choice === 'Remove Clone Only') {
          const keepBranch = choice === 'Remove Clone Only';
          try {
            await vscode.window.withProgress({
              location: vscode.ProgressLocation.Notification,
              title: `Killing shadow clone: ${branchName}`,
              cancellable: false
            }, async () => {
              await kill(branchName, { root: rootPath!, keepBranch });
            });
            
            const msg = keepBranch
              ? `Shadow clone ${branchName} removed (branch preserved).`
              : `Shadow clone ${branchName} killed.`;
            vscode.window.showInformationMessage(msg);
            shadowTreeProvider.refresh();
            creatorProvider.resetForm();
          } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to kill shadow clone: ${error.message}`);
          }
        }
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('lumi-ops.merge', async (item: any) => {
      const branchName = item?.clone?.branch;
      if (!branchName) return;

      try {
        await vscode.window.withProgress({
          location: vscode.ProgressLocation.Notification,
          title: `Merging shadow clone: ${branchName}`,
          cancellable: false
        }, async () => {
          await merge(branchName, { root: rootPath! });
        });

        const selection = await vscode.window.showInformationMessage(
          `Successfully merged ${branchName}! Delete the shadow clone?`,
          'Yes, Delete It',
          'No'
        );

        if (selection === 'Yes, Delete It') {
           await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Killing shadow clone: ${branchName}`,
            cancellable: false
          }, async () => {
            await kill(branchName, { root: rootPath! });
          });
          vscode.window.showInformationMessage(`Shadow clone ${branchName} deleted.`);
          shadowTreeProvider.refresh();
        }

      } catch (error: any) {
        vscode.window.showErrorMessage(`Merge failed: ${error.message}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('lumi-ops.open', (clone: any) => {
      if (clone && clone.path) {
        const uri = vscode.Uri.file(clone.path);
        vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: true });
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('lumi-ops.getBranches', async () => {
      if (!rootPath) return;
      try {
        const git = new GitUtils(rootPath);
        const currentBranch = await git.getCurrentBranch();

        // Parse worktree branches from porcelain output
        const worktreeEntries = await git.listWorktrees();
        const worktreeBranches = new Set(
          worktreeEntries
            .map(entry => {
              const match = entry.match(/branch refs\/heads\/(.+)/);
              return match ? match[1] : null;
            })
            .filter(Boolean) as string[]
        );

        const branches = (await git.listBranches()).filter(
          b => b !== currentBranch && !worktreeBranches.has(b)
        );
        creatorProvider.updateBranches(branches);
      } catch (e) {
        // Silently ignore — branches just won't populate
      }
    })
  );
}

export function deactivate() {}

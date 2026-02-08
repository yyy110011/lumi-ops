import * as vscode from 'vscode';
import * as path from 'path';
import { ShadowTreeProvider } from './ShadowTreeProvider';
import { ShadowCreatorProvider } from './ShadowCreatorProvider';


import { spawn, kill, merge } from '@lumi-ops/cli';



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

  // Auto-open MISSION.md and send prompt to chat when in a shadow clone
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0];
  if (workspaceRoot) {
    const missionFile = vscode.Uri.joinPath(workspaceRoot.uri, 'MISSION.md');
    
    setTimeout(async () => {
      try {
        await vscode.workspace.fs.stat(missionFile);
        
        // Open MISSION.md pinned
        const doc = await vscode.workspace.openTextDocument(missionFile);
        await vscode.window.showTextDocument(doc, { 
          preview: false,
          preserveFocus: true 
        });
        
        // Auto-open chat with mission prompt (string shorthand for broader compatibility)
        setTimeout(() => {
          vscode.commands.executeCommand(
            'workbench.action.chat.open',
            'Please read @MISSION.md and start working on the objective described in it.'
          );
        }, 1500);
        
        vscode.window.setStatusBarMessage('👻 Shadow Clone Context Loaded — Chat ready!', 5000);
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

      if (branchName && !description) {
        description = await vscode.window.showInputBox({
          prompt: 'Enter a task description / objective for this agent',
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
        const confirm = await vscode.window.showWarningMessage(
          `Are you sure you want to kill the shadow clone for ${branchName}? This will delete the worktree and the branch.`,
          { modal: true },
          'Yes, Kill it'
        );

        if (confirm === 'Yes, Kill it') {
          try {
            await vscode.window.withProgress({
              location: vscode.ProgressLocation.Notification,
              title: `Killing shadow clone: ${branchName}`,
              cancellable: false
            }, async () => {
              await kill(branchName, { root: rootPath! });

            });
            
            vscode.window.showInformationMessage(`Shadow clone ${branchName} killed.`);
            shadowTreeProvider.refresh();
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
}

export function deactivate() {}

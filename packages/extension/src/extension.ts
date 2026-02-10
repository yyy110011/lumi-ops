import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
import { ShadowTreeProvider, ShadowItem, LumiStatus } from './ShadowTreeProvider';
import { ShadowCreatorProvider } from './ShadowCreatorProvider';
import { StatusWatcher } from './StatusWatcher';
import { spawn, kill, merge, startAgentInWorktree } from '@lumi-ops/cli';


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
              // Kill tmux session first if it exists
              try {
                execSync(`tmux kill-session -t "lumi-${branchName}"`, { stdio: 'ignore' });
              } catch (e) {
                // Session may not exist, that's fine
              }

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
          // Kill tmux session if active
          try {
            execSync(`tmux kill-session -t "lumi-${branchName}"`, { stdio: 'ignore' });
          } catch (e) { /* no session, fine */ }

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
        }
        shadowTreeProvider.refresh();

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

  // -- Start Agent on idle clone --
  context.subscriptions.push(
    vscode.commands.registerCommand('lumi-ops.startAgent', async (item: ShadowItem) => {
      if (!item?.clone?.branch || !item?.clone?.path) {
        vscode.window.showWarningMessage('No clone selected');
        return;
      }

      // Check if already running
      if (item.status?.status === 'coding' || item.status?.status === 'testing') {
        vscode.window.showWarningMessage('Agent is already running on this clone');
        return;
      }

      const driver = 'gemini -y';

      try {
        await vscode.window.withProgress({
          location: vscode.ProgressLocation.Notification,
          title: `Starting agent on ${item.clone.branch}...`,
          cancellable: false
        }, async () => {
          await startAgentInWorktree({
            worktreePath: item.clone.path,
            branchName: item.clone.branch,
            driver
          });
        });

        vscode.window.showInformationMessage(`Agent started on ${item.clone.branch}`);
        shadowTreeProvider.refresh();
      } catch (error: any) {
        vscode.window.showErrorMessage(`Failed to start agent: ${error.message}`);
      }
    })
  );

  // -- Attach to tmux session command --
  context.subscriptions.push(
    vscode.commands.registerCommand('lumi-ops.attach', async (item: ShadowItem) => {
      if (!item.status?.session) {
        vscode.window.showWarningMessage('No active tmux session for this clone');
        return;
      }

      const terminal = vscode.window.createTerminal({
        name: `🤖 ${item.status.session}`
      });

      terminal.show();
      terminal.sendText(`tmux attach -t ${item.status.session}`);
    })
  );

  // -- Kill tmux session command --
  context.subscriptions.push(
    vscode.commands.registerCommand('lumi-ops.killSession', async (item: ShadowItem) => {
      if (!item.status?.session) {
        vscode.window.showWarningMessage('No active session to kill');
        return;
      }

      const confirm = await vscode.window.showWarningMessage(
        `Kill agent session "${item.status.session}"?`,
        { modal: true },
        'Kill'
      );

      if (confirm === 'Kill') {
        // Try to kill tmux session (may already be dead)
        try {
          execSync(`tmux kill-session -t ${item.status.session}`, { stdio: 'ignore' });
        } catch (e) {
          // Session already dead or tmux not running — that's fine
        }

        // Always update status file
        try {
          const statusPath = path.join(item.clone.path, '.lumi-status.json');
          const newStatus: LumiStatus = {
            ...item.status,
            status: 'idle',
            message: 'Session terminated'
          };
          fs.writeFileSync(statusPath, JSON.stringify(newStatus, null, 2));
        } catch (e) {
          // Ignore file write errors
        }

        shadowTreeProvider.refresh();
        vscode.window.showInformationMessage(`Killed session: ${item.status.session}`);
      }
    })
  );

  // -- Show Agent Logs Command --
  context.subscriptions.push(
    vscode.commands.registerCommand('lumi-ops.showLogs', async (item: ShadowItem) => {
      const logPath = path.join(item.clone.path, 'agent.log');

      // Check if log file exists
      if (!fs.existsSync(logPath)) {
        vscode.window.showWarningMessage(`No agent.log found for ${item.label}`);
        return;
      }

      // Open as read-only document
      const uri = vscode.Uri.file(logPath);
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc, {
        preview: true,
        preserveFocus: false
      });
    })
  );

  // -- Watch Agent Logs (Live) Command --
  const logWatchers = new Map<string, fs.FSWatcher>();

  context.subscriptions.push(
    vscode.commands.registerCommand('lumi-ops.watchLogs', async (item: ShadowItem) => {
      const logPath = path.join(item.clone.path, 'agent.log');
      const channelName = `🤖 ${item.label}`;

      // Create or reuse output channel
      const channel = vscode.window.createOutputChannel(channelName);
      channel.show();

      // Initial content
      if (fs.existsSync(logPath)) {
        channel.append(fs.readFileSync(logPath, 'utf-8'));
      }

      // Watch for changes
      if (logWatchers.has(logPath)) {
        logWatchers.get(logPath)?.close();
      }

      try {
        const watcher = fs.watch(logPath, (event) => {
          if (event === 'change') {
            // Re-read and update
            channel.clear();
            if (fs.existsSync(logPath)) {
              channel.append(fs.readFileSync(logPath, 'utf-8'));
            }
          }
        });

        logWatchers.set(logPath, watcher);
      } catch (e) {
        vscode.window.showWarningMessage(`Could not watch log file: ${e}`);
      }
    })
  );

  // Cleanup log watchers on deactivate
  context.subscriptions.push({
    dispose: () => {
      for (const watcher of logWatchers.values()) {
        watcher.close();
      }
      logWatchers.clear();
    }
  });

  // -- Status Watcher for Panic Button --
  if (rootPath) {
    const statusWatcher = new StatusWatcher(
      rootPath,
      async (branch, message, worktreePath) => {
        // Show error notification with action button
        const action = await vscode.window.showErrorMessage(
          `🚨 Agent "${branch}" is stuck: ${message}`,
          { modal: false },
          'Jump In'
        );
        
        if (action === 'Jump In') {
          // 1. Open new VS Code window with worktree
          const uri = vscode.Uri.file(worktreePath);
          vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: true });
          
          // 2. Read status to get session name and attach
          const statusPath = path.join(worktreePath, '.lumi-status.json');
          try {
            const status: LumiStatus = JSON.parse(fs.readFileSync(statusPath, 'utf-8'));
            if (status.session) {
              const terminal = vscode.window.createTerminal({
                name: `🤖 ${status.session}`
              });
              terminal.show();
              terminal.sendText(`tmux attach -t ${status.session}`);
            }
          } catch (e) {
            // Fallback: just open the window
          }
        }
      }
    );
    
    statusWatcher.start();
    
    context.subscriptions.push({
      dispose: () => statusWatcher.dispose()
    });
  }

  // -- Jump In Command (manual intervention from tree view) --
  context.subscriptions.push(
    vscode.commands.registerCommand('lumi-ops.jumpIn', async (item: ShadowItem) => {
      if (!item) return;
      
      // Open window
      const uri = vscode.Uri.file(item.clone.path);
      vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: true });
      
      // Attach terminal if session exists
      if (item.status?.session) {
        const terminal = vscode.window.createTerminal({
          name: `🤖 ${item.status.session}`
        });
        terminal.show();
        terminal.sendText(`tmux attach -t ${item.status.session}`);
      }
    })
  );
}

export function deactivate() {}

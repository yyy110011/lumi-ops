import * as vscode from 'vscode';
import * as path from 'path';
import { ShadowTreeProvider } from './ShadowTreeProvider';
import { ShadowCreatorProvider } from './ShadowCreatorProvider';
import { PromptLibraryProvider, PromptItem } from './PromptLibraryProvider';


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

  const promptLibraryProvider = new PromptLibraryProvider(context.globalStorageUri);
  vscode.window.registerTreeDataProvider('lumi-ops.promptLibrary', promptLibraryProvider);

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
            // If branch doesn't exist locally, try checking it out from remote
            const git = new GitUtils(rootPath);
            const localExists = await git.branchExists(branchName);
            if (!localExists) {
              const remoteBranches = await git.listRemoteBranches();
              const matchingRemote = remoteBranches.find(rb => {
                const slashIdx = rb.indexOf('/');
                const shortName = slashIdx >= 0 ? rb.substring(slashIdx + 1) : rb;
                return shortName === branchName;
              });
              if (matchingRemote) {
                // Checkout creates a local tracking branch from the remote
                await git.checkoutBranch(branchName);
              }
            }
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

        // Get local branches (exclude current and worktree branches)
        const localBranches = (await git.listBranches()).filter(
          b => b !== currentBranch && !worktreeBranches.has(b)
        );
        const localSet = new Set(localBranches);

        // Fetch remote refs (non-fatal if offline)
        try { await git.fetchRemote(); } catch (_) { /* offline — skip */ }

        // Get remote branches, strip remote prefix, exclude those already local/worktree/current
        const remoteBranches = (await git.listRemoteBranches())
          .map(b => {
            const slashIdx = b.indexOf('/');
            return slashIdx >= 0 ? b.substring(slashIdx + 1) : b;
          })
          .filter(b => b !== currentBranch && !localSet.has(b) && !worktreeBranches.has(b));
        // Deduplicate (multiple remotes may track same branch)
        const uniqueRemote = [...new Set(remoteBranches)];

        const branches = [
          ...localBranches.map(name => ({ name, isRemote: false })),
          ...uniqueRemote.map(name => ({ name, isRemote: true })),
        ];
        creatorProvider.updateBranches(branches);
      } catch (e) {
        // Silently ignore — branches just won't populate
      }
    })
  );

  // -- Prompt Library Commands --

  context.subscriptions.push(
    vscode.commands.registerCommand('lumi-ops.importPrompt', async () => {
      const files = await vscode.window.showOpenDialog({
        canSelectMany: false,
        filters: { 'Markdown': ['md'] },
        openLabel: 'Import Prompt'
      });
      if (files && files.length > 0) {
        await promptLibraryProvider.importPrompt(files[0]);
        vscode.window.showInformationMessage('Prompt imported successfully.');
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('lumi-ops.newPrompt', async () => {
      const name = await vscode.window.showInputBox({
        prompt: 'Enter a name for the new prompt template',
        placeHolder: 'e.g. refactor-component'
      });
      if (name) {
        const fileName = name.endsWith('.md') ? name : `${name}.md`;
        await promptLibraryProvider.savePrompt(fileName, '');
        const fileUri = promptLibraryProvider.getPromptFileUri(fileName);
        const doc = await vscode.workspace.openTextDocument(fileUri);
        await vscode.window.showTextDocument(doc);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('lumi-ops.usePrompt', async (item: PromptItem) => {
      if (!item) return;
      try {
        const content = await promptLibraryProvider.getPromptContent(item.fileName);
        creatorProvider.loadPrompt(item.label, content);
      } catch (error: any) {
        vscode.window.showErrorMessage(`Failed to load prompt: ${error.message}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('lumi-ops.editPrompt', async (item: PromptItem) => {
      if (!item) return;
      const fileUri = promptLibraryProvider.getPromptFileUri(item.fileName);
      const doc = await vscode.workspace.openTextDocument(fileUri);
      await vscode.window.showTextDocument(doc);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('lumi-ops.deletePrompt', async (item: PromptItem) => {
      if (!item) return;
      const confirm = await vscode.window.showWarningMessage(
        `Delete prompt "${item.label}"?`,
        { modal: true },
        'Delete'
      );
      if (confirm === 'Delete') {
        await promptLibraryProvider.deletePrompt(item.fileName);
        vscode.window.showInformationMessage(`Prompt "${item.label}" deleted.`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('lumi-ops.saveAsPrompt', async (content?: string) => {
      if (!content) return;
      const name = await vscode.window.showInputBox({
        prompt: 'Enter a name for this prompt template',
        placeHolder: 'e.g. my-agent-prompt'
      });
      if (name) {
        const fileName = name.endsWith('.md') ? name : `${name}.md`;
        await promptLibraryProvider.savePrompt(fileName, content);
        vscode.window.showInformationMessage(`Prompt "${name}" saved to library.`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('lumi-ops.getPrompts', async () => {
      try {
        const items = await promptLibraryProvider.getChildren();
        const prompts = items.map(item => ({
          name: item.fileName,
          preview: item.firstLine.length > 50 ? item.firstLine.substring(0, 50) + '…' : item.firstLine
        }));
        creatorProvider.updatePrompts(prompts);
      } catch {
        creatorProvider.updatePrompts([]);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('lumi-ops.selectPrompt', async (fileName: string) => {
      if (!fileName) return;
      try {
        const content = await promptLibraryProvider.getPromptContent(fileName);
        const name = fileName.replace(/\.md$/, '');
        creatorProvider.loadPrompt(name, content);
      } catch (error: any) {
        vscode.window.showErrorMessage(`Failed to load prompt: ${error.message}`);
      }
    })
  );
}

export function deactivate() {}

import * as vscode from 'vscode';
import * as path from 'path';
import { ShadowTreeProvider } from './ShadowTreeProvider';
import { ShadowCreatorProvider } from './ShadowCreatorProvider';


import { spawn, kill, merge, GitUtils, SHADOW_CLONES_DIR, METADATA_FILE } from '@lumi-ops/cli';



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

  const shadowTreeProvider = new ShadowTreeProvider(rootPath, context.extensionPath);
  vscode.window.registerTreeDataProvider('lumi-ops.activeClones', shadowTreeProvider);

  const creatorProvider = new ShadowCreatorProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('lumi-ops.creator', creatorProvider)
  );

  // -- Polling for live updates + branch change detection --
  let lastKnownBranch: string | undefined;
  const pollInterval = setInterval(async () => {
    shadowTreeProvider.refresh();

    // Detect branch changes and refresh dropdown data
    if (rootPath) {
      try {
        const git = new GitUtils(rootPath);
        const current = await git.getCurrentBranch();
        if (lastKnownBranch !== undefined && current !== lastKnownBranch) {
          vscode.commands.executeCommand('lumi-ops.getBranches');
        }
        lastKnownBranch = current;
      } catch {
        // ignore git errors
      }
    }
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
    vscode.commands.registerCommand('lumi-ops.spawn', async (args?: { branch: string, description: string, baseBranch?: string }) => {
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
          }, async () => {
            const git = new GitUtils(rootPath);

            // If the target branch doesn't exist locally, fetch it from remote (no checkout)
            const localExists = await git.branchExists(branchName);
            if (!localExists) {
              const remoteBranches = await git.listRemoteBranches();
              const matchingRemote = remoteBranches.find(rb => {
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
                const matchingRemote = remoteBranches.find(rb => {
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

            await spawn(branchName, { root: rootPath, description, baseBranch });

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
      if (!branchName || !rootPath) return;

      try {
        const git = new GitUtils(rootPath);
        const fs = await import('fs');

        // 1. Read baseBranch from centralized metadata
        const metadataPath = path.join(rootPath, SHADOW_CLONES_DIR, METADATA_FILE);
        let baseBranch: string | undefined;
        try {
          const raw = fs.readFileSync(metadataPath, 'utf-8');
          const metadata = JSON.parse(raw);
          baseBranch = metadata[branchName]?.baseBranch;
        } catch {
          // No metadata — baseBranch stays undefined
        }

        // 2. Get current branch + build worktree branch→path map
        const currentBranch = await git.getCurrentBranch();
        const worktreeEntries = await git.listWorktrees();
        const worktreeMap = new Map<string, string>(); // branch → worktree path
        for (const entry of worktreeEntries) {
          const lines = entry.split('\n');
          const wtLine = lines.find((l: string) => l.startsWith('worktree '));
          const wtPath = wtLine ? wtLine.substring('worktree '.length) : undefined;
          const branch = lines.find((l: string) => l.startsWith('branch'))?.split(' ').pop()?.replace('refs/heads/', '');
          if (wtPath && branch) {
            worktreeMap.set(branch, wtPath);
          }
        }

        // 3. Build QuickPick items — all local branches, pinned at top: base + current
        type MergeOption = vscode.QuickPickItem & { targetBranch?: string };
        const pinnedItems: MergeOption[] = [];
        const pinnedSet = new Set<string>();

        // Pin base branch (recommended)
        if (baseBranch && baseBranch !== branchName) {
          const inWorktree = worktreeMap.has(baseBranch) && baseBranch !== currentBranch;
          pinnedItems.push({
            label: baseBranch,
            description: inWorktree ? '⚠️ worktree · ← recommended' : '← recommended',
            targetBranch: baseBranch,
          });
          pinnedSet.add(baseBranch);
        }

        // Pin current branch (if different from base)
        if (currentBranch !== branchName && !pinnedSet.has(currentBranch)) {
          pinnedItems.push({
            label: currentBranch,
            description: '← current',
            targetBranch: currentBranch,
          });
          pinnedSet.add(currentBranch);
        }

        // Remaining local branches (excluding source + already pinned)
        const allBranches = await git.listBranches();
        const otherBranches = allBranches
          .filter(b => b !== branchName && !pinnedSet.has(b))
          .sort();

        const items: MergeOption[] = [
          ...pinnedItems,
          ...(otherBranches.length > 0 ? [{ label: '', kind: vscode.QuickPickItemKind.Separator } as MergeOption] : []),
          ...otherBranches.map(b => {
            const inWorktree = worktreeMap.has(b) && b !== currentBranch;
            return {
              label: b,
              description: inWorktree ? '⚠️ worktree' : '',
              targetBranch: b,
            };
          }),
        ];

        // 4. Show QuickPick (always show — user picks target)
        const picked = await vscode.window.showQuickPick(items, {
          placeHolder: `Merge ${branchName} → ...`,
        });
        if (!picked || !picked.targetBranch) return;

        const targetBranch = picked.targetBranch;

        // 5. Warn if target is in another worktree
        if (worktreeMap.has(targetBranch) && targetBranch !== currentBranch) {
          const confirm = await vscode.window.showWarningMessage(
            `⚠️ "${targetBranch}" is currently checked out in another worktree. Merging will modify that worktree. Continue?`,
            { modal: true },
            'Merge Anyway'
          );
          if (confirm !== 'Merge Anyway') return;
        }

        // 6. Use default commit message
        const commitMessage = `feat: merged ${branchName} (squash)`;

        // 7. Resolve the cwd: find existing worktree or create a temporary one
        let mergeCwd: string;
        let createdTempWorktree = false;

        if (targetBranch === currentBranch) {
          // Target is root's current branch — merge directly in root
          mergeCwd = rootPath;
        } else if (worktreeMap.has(targetBranch)) {
          // Target is in an existing worktree — use that path
          mergeCwd = worktreeMap.get(targetBranch)!;
        } else {
          // Target not in any worktree — create one under .shadow-clones/
          const newWorktreePath = path.join(rootPath, SHADOW_CLONES_DIR, targetBranch);
          try {
            await git.addWorktreeExisting(newWorktreePath, targetBranch);
          } catch (wtError: any) {
            const msg = wtError.message?.includes('already checked out')
              ? `Branch '${targetBranch}' is already checked out in another worktree.`
              : `Cannot create worktree for '${targetBranch}': ${wtError.message}`;
            vscode.window.showErrorMessage(msg);
            return;
          }
          mergeCwd = newWorktreePath;
          createdTempWorktree = true;
        }

        // 8. Execute merge
        await vscode.window.withProgress({
          location: vscode.ProgressLocation.Notification,
          title: `Merging ${branchName} → ${targetBranch}`,
          cancellable: false
        }, async () => {
          await merge(branchName, { root: rootPath!, commitMessage, cwd: mergeCwd });
        });

        // 9. Clean up temp worktree if we created one (conflict throws before reaching here)
        if (createdTempWorktree) {
          try {
            await git.removeWorktree(mergeCwd);
          } catch {
            // Non-fatal — user can clean up manually or via GC
          }
        }

        // 10. Post-merge: offer to delete the source clone
        const selection = await vscode.window.showInformationMessage(
          `Successfully merged ${branchName} → ${targetBranch}! Delete the shadow clone?`,
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
        if (error.message === 'CONFLICT') {
          shadowTreeProvider.refresh();
          vscode.window.showWarningMessage(
            `Merge conflict detected for ${branchName}. Please resolve conflicts manually.`
          );
        } else {
          vscode.window.showErrorMessage(`Merge failed: ${error.message}`);
        }
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('lumi-ops.open', (item: any) => {
      const clonePath = item?.clone?.path;
      if (clonePath) {
        const uri = vscode.Uri.file(clonePath);
        vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: true });
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('lumi-ops.cycleReviewStatus', async (item: any) => {
      const branchName = item?.clone?.branch;
      const currentStatus = item?.clone?.reviewStatus;
      if (!branchName) return;
      await shadowTreeProvider.cycleReviewStatus(branchName, currentStatus);
    })
  );



  context.subscriptions.push(
    vscode.commands.registerCommand('lumi-ops.getBranches', async () => {
      if (!rootPath) return;
      try {
        const git = new GitUtils(rootPath);
        const currentBranch = await git.getCurrentBranch();

        // Collect worktree-occupied branches so UI can filter them from Branch Name dropdown
        const worktreeEntries = await git.listWorktrees();
        const worktreeBranches = worktreeEntries
          .map(entry => {
            const match = entry.match(/branch refs\/heads\/(.+)/);
            return match ? match[1] : null;
          })
          .filter(Boolean) as string[];

        // ALL local branches (excluding current — it's added separately in the webview)
        const allLocal = await git.listBranches();
        const localBranches = allLocal.filter(b => b !== currentBranch);
        const localSet = new Set(allLocal);

        // Fetch remote refs (non-fatal if offline)
        try { await git.fetchRemote(); } catch (_) { /* offline — skip */ }

        // Remote branches not already local
        const remoteBranches = (await git.listRemoteBranches())
          .map(b => {
            const slashIdx = b.indexOf('/');
            return slashIdx >= 0 ? b.substring(slashIdx + 1) : b;
          })
          .filter(b => !localSet.has(b));
        const uniqueRemote = [...new Set(remoteBranches)];

        const branches = [
          ...localBranches.map(name => ({ name, isRemote: false })),
          ...uniqueRemote.map(name => ({ name, isRemote: true })),
        ];
        creatorProvider.updateBranches(branches, currentBranch, worktreeBranches);
      } catch (e) {
        // Silently ignore — branches just won't populate
      }
    })
  );
}

export function deactivate() {}

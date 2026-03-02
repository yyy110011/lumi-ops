import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ShadowTreeProvider } from './ShadowTreeProvider';
import { ShadowCreatorProvider } from './ShadowCreatorProvider';
import { PromptLibraryViewProvider } from './PromptLibraryViewProvider';
import { PromptLibraryProvider, PromptScope } from './PromptLibraryProvider';
import { MissionTemplateProvider } from './MissionTemplateProvider';
import { MissionTemplateEditorProvider } from './MissionTemplateEditorProvider';
import { WorktreeManagerPanel } from './WorktreeManagerPanel';
import { StatusEventBus } from './StatusEventBus';
import { runMigrations } from './migrations';

import { spawn, kill, merge, GitUtils, getClonesDir, getRepoStorageDir, LUMI_OPS_HOME, METADATA_FILE, registerRepo } from '@lumi-ops/cli';

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




  let rootPath = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0
    ? vscode.workspace.workspaceFolders[0].uri.fsPath
    : undefined;

  // Resolve symlinks so our paths match what git worktree list returns
  if (rootPath) {
    try { rootPath = fs.realpathSync(rootPath); } catch { /* keep original if resolve fails */ }
  }

  let shadowBranchName: string | undefined = undefined;
  let currentWorkspacePath: string | undefined = undefined;

  // Detect if we are inside a .worktrees/ directory to resolve back to the repo root
  if (rootPath) {
    const worktreesMatch = rootPath.match(/^(.+)\.worktrees[\\\/]/);
    
    if (worktreesMatch && worktreesMatch[1]) {
      currentWorkspacePath = rootPath;
      rootPath = worktreesMatch[1]; // Resolve back to the main repository root
      
      try {
        const git = new GitUtils(currentWorkspacePath);
        shadowBranchName = await git.getCurrentBranch();
      } catch (e) {
        console.error("Failed to get worktree branch name via GitUtils:", e);
      }
    }
  }

  // Run all one-time migrations
  await runMigrations(context, rootPath);

  const statusBus = new StatusEventBus();
  context.subscriptions.push({ dispose: () => statusBus.dispose() });

  const shadowTreeProvider = new ShadowTreeProvider(rootPath, context.extensionPath, statusBus, shadowBranchName, currentWorkspacePath);
  const activeClonesView = vscode.window.createTreeView('lumi-ops.activeClones', { treeDataProvider: shadowTreeProvider });
  context.subscriptions.push(activeClonesView);

  const creatorProvider = new ShadowCreatorProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('lumi-ops.creator', creatorProvider)
  );

  const promptLibraryViewProvider = new PromptLibraryViewProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('lumi-ops.promptLibrary', promptLibraryViewProvider)
  );

  const promptLibraryProvider = new PromptLibraryProvider();
  if (rootPath) {
    promptLibraryProvider.setProjectRoot(vscode.Uri.file(rootPath));
  }

  // -- Mission Template Provider --
  const missionTemplateProvider = new MissionTemplateProvider();
  if (rootPath) {
    missionTemplateProvider.setProjectRoot(vscode.Uri.file(rootPath));
  }

  // -- Mission Template Custom Editor --
  const missionEditorProvider = new MissionTemplateEditorProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      MissionTemplateEditorProvider.viewType,
      missionEditorProvider,
      { supportsMultipleEditorsPerDocument: false },
    )
  );

  // -- fs.watch for instant cross-window prompt refresh --
  const refreshPromptsNow = () => {
    vscode.commands.executeCommand('lumi-ops._getPrompts');
  };

  const globalPromptsPath = path.join(LUMI_OPS_HOME, '.prompts');
  try {
    if (!fs.existsSync(globalPromptsPath)) {
      fs.mkdirSync(globalPromptsPath, { recursive: true });
    }
    const globalWatcher = fs.watch(globalPromptsPath, () => {
      refreshPromptsNow();
    });
    context.subscriptions.push({ dispose: () => globalWatcher.close() });
  } catch (e) {
    console.error('[lumi-ops] ❌ Failed to watch global prompts:', e);
  }

  if (rootPath) {
    const projectPromptsPath = path.join(rootPath, '.prompts');
    try {
      if (!fs.existsSync(projectPromptsPath)) {
        fs.mkdirSync(projectPromptsPath, { recursive: true });
      }
      const projectWatcher = fs.watch(projectPromptsPath, () => {
        refreshPromptsNow();
      });
      context.subscriptions.push({ dispose: () => projectWatcher.close() });
    } catch (e) {
      console.error('[lumi-ops] ❌ Failed to watch project prompts:', e);
    }
  }

  // -- fs.watch for instant cross-window metadata (status) refresh --
  if (rootPath) {
    const metadataDir = getClonesDir(rootPath);
    try {
      if (!fs.existsSync(metadataDir)) {
        fs.mkdirSync(metadataDir, { recursive: true });
      }
      let metaDebounce: ReturnType<typeof setTimeout> | null = null;
      const metadataWatcher = fs.watch(metadataDir, (_, filename) => {
        if (filename && filename !== METADATA_FILE) return;
        if (metaDebounce) clearTimeout(metaDebounce);
        metaDebounce = setTimeout(() => { statusBus.fire('*'); }, 150);
      });
      context.subscriptions.push({ dispose: () => metadataWatcher.close() });
    } catch (e) {
      console.error('[lumi-ops] \u274c Failed to watch metadata:', e);
    }
  }

  // -- Polling for live updates + branch change detection (fallback) --
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

  // -- Worktree Manager Panel --
  context.subscriptions.push(
    vscode.commands.registerCommand('lumi-ops.openWorktreeManager', () => {
      WorktreeManagerPanel.createOrShow(context.extensionUri);
    })
  );

  // Restore Worktree Manager panel on reload
  vscode.window.registerWebviewPanelSerializer(WorktreeManagerPanel.viewType, {
    async deserializeWebviewPanel(panel: vscode.WebviewPanel, _state: any) {
      panel.webview.options = {
        enableScripts: true,
        localResourceRoots: [context.extensionUri],
      };
      WorktreeManagerPanel.revive(panel, context.extensionUri);
    },
  });

  // Auto-register current workspace repo in the global registry
  if (rootPath) {
    try {
      registerRepo(path.basename(rootPath), rootPath);
    } catch { /* non-fatal */ }
  }

  // -- Commands --

  // Open Settings command (gear button in sidebar title) — directly opens QuickPick
  context.subscriptions.push(
    vscode.commands.registerCommand('lumi-ops.openSettings', () => {
      vscode.commands.executeCommand('workbench.action.openWorkspaceSettings', 'lumi-ops.copyOnSpawn');
    })
  );

  // Pick Copy Folders command (triggered from settings command-link)
  context.subscriptions.push(
    vscode.commands.registerCommand('lumi-ops.pickCopyFolders', async () => {
      if (!rootPath) {
        vscode.window.showErrorMessage('No workspace folder open.');
        return;
      }

      try {
        const git = new GitUtils(rootPath);
        const untrackedEntries = await git.listUntrackedEntries();

        if (untrackedEntries.length === 0) {
          vscode.window.showInformationMessage('No untracked/gitignored files found in workspace root.');
          return;
        }

        const config = vscode.workspace.getConfiguration('lumi-ops');
        const currentStr = config.get<string>('copyOnSpawn') || '';
        const current = currentStr.split('\n').map(s => s.trim()).filter(Boolean);
        const currentSet = new Set(current);

        // Check each entry to determine if it's a file or directory
        const items: vscode.QuickPickItem[] = [];
        for (const name of untrackedEntries) {
          const entryUri = vscode.Uri.file(path.join(rootPath, name));
          let isDir = false;
          try {
            const stat = await vscode.workspace.fs.stat(entryUri);
            isDir = (stat.type & vscode.FileType.Directory) !== 0;
          } catch { /* skip if can't stat */ }
          items.push({
            label: isDir ? `$(folder) ${name}` : `$(file) ${name}`,
            description: name,
            picked: currentSet.has(name),
          });
        }

        const selected = await vscode.window.showQuickPick(items, {
          canPickMany: true,
          placeHolder: 'Select untracked/gitignored items to copy into shadow clones on spawn',
        });

        if (selected !== undefined) {
          const selectedNames = selected.map(item => item.description!);
          await config.update('copyOnSpawn', selectedNames.join('\n'), vscode.ConfigurationTarget.Workspace);
          vscode.window.showInformationMessage(`Copy on Spawn: ${selectedNames.length} item(s) configured.`);
        }
      } catch (error: any) {
        vscode.window.showErrorMessage(`Failed to list workspace entries: ${error.message}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('lumi-ops.refresh', () => {
      shadowTreeProvider.refresh();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('lumi-ops.spawn', async (args?: { branch: string, description: string, baseBranch?: string, templates?: { name: string; content: string }[] }) => {
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
          }, async (progress) => {
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

            await spawn(branchName, { root: rootPath, description, baseBranch, templates: args?.templates,
              copyFolders: (vscode.workspace.getConfiguration('lumi-ops').get<string>('copyOnSpawn') || '').split('\n').map(s => s.trim()).filter(Boolean),
              onProgress: (message) => progress.report({ message }),
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
        const metadataPath = path.join(getRepoStorageDir(rootPath), METADATA_FILE);
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

        // 6. Let user edit commit message
        const commitMessage = await vscode.window.showInputBox({
          prompt: `Squash merge ${branchName} → ${targetBranch}`,
          value: `feat: merged ${branchName} (shadow clone)`,
        });
        if (commitMessage === undefined) return;

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
          // Target not in any worktree — create one under clones dir
          const newWorktreePath = path.join(getClonesDir(rootPath), targetBranch);
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
    vscode.commands.registerCommand('lumi-ops.cycleReviewStatus', async (branchName: string) => {
      if (!branchName) return;
      shadowTreeProvider.cycleReviewStatus(branchName);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('lumi-ops.copyBranchName', async (item: any) => {
      const branchName = item?.clone?.branch;
      if (!branchName) return;
      await vscode.env.clipboard.writeText(branchName);
      vscode.window.showInformationMessage(`Copied: ${branchName}`);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('lumi-ops.returnToRoot', async () => {
      if (rootPath) {
        const uri = vscode.Uri.file(rootPath);
        vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: false });
      }
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

  // -- Prompt management (webview internal commands) --

  /** Send active clone branches to webview for ✦ indicators */
  async function notifyCloneBranches() {
    if (!rootPath) return;
    try {
      const git = new GitUtils(rootPath);
      const worktreeEntries = await git.listWorktrees();
      const cloneBranches = worktreeEntries
        .map(entry => {
          const match = entry.match(/branch refs\/heads\/(.+)/);
          return match ? match[1] : null;
        })
        .filter(Boolean) as string[];
      promptLibraryViewProvider.updateCloneBranches(cloneBranches);
    } catch {
      // ignore
    }
  }

  // Auto-refresh prompt library ✦ indicators on worktree changes
  context.subscriptions.push(statusBus.onDidChange(() => { notifyCloneBranches(); }));

  context.subscriptions.push(
    vscode.commands.registerCommand('lumi-ops._getPrompts', async (scopes?: PromptScope[]) => {
      try {
        const activeScopes = scopes || ['global', 'project'];
        const items = await promptLibraryProvider.listPrompts(activeScopes);
        promptLibraryViewProvider.updatePrompts(items);
      } catch {
        promptLibraryViewProvider.updatePrompts([]);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('lumi-ops._selectPrompt', async (fileName: string, scope?: PromptScope) => {
      if (!fileName) return;
      try {
        const content = await promptLibraryProvider.getPromptContent(fileName, scope || 'project');
        const name = fileName.replace(/\.md$/, '');
        const branch = 'feat/' + name;
        creatorProvider.loadPrompt(name, content);
        creatorProvider.setBranchName(branch);
      } catch (error: any) {
        vscode.window.showErrorMessage(`Failed to load prompt: ${error.message}`);
      }
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('lumi-ops._createPromptInline', async (name: string, scope?: PromptScope) => {
      if (!name) return;
      
      const targetScope = scope || 'project';
      const cleanName = name.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
      const fileName = `${cleanName}.md`;
      const fileUri = promptLibraryProvider.getPromptFileUri(fileName, targetScope);
      
      try {
        await vscode.workspace.fs.stat(fileUri);
        vscode.window.showErrorMessage(`Prompt "${fileName}" already exists in ${targetScope} scope.`);
        return;
      } catch {
        // File does not exist, safe to create
      }

      try {
        await vscode.workspace.fs.writeFile(fileUri, new Uint8Array(0));
        vscode.commands.executeCommand('lumi-ops._getPrompts', undefined); // Refresh ui list
        const doc = await vscode.workspace.openTextDocument(fileUri);
        await vscode.window.showTextDocument(doc, { preview: false });
      } catch (error: any) {
        vscode.window.showErrorMessage(`Failed to create prompt: ${error.message}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('lumi-ops.openPromptFile', async (fileName: string, scope?: PromptScope) => {
      if (!fileName) return;
      try {
        const fileUri = promptLibraryProvider.getPromptFileUri(fileName, scope || 'project');
        const doc = await vscode.workspace.openTextDocument(fileUri);
        await vscode.window.showTextDocument(doc, { preview: false });
      } catch (error: any) {
        vscode.window.showErrorMessage(`Failed to open prompt: ${error.message}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('lumi-ops._importFolder', async (scope?: PromptScope) => {
      const targetScope = scope || 'project';
      const selections = await vscode.window.showOpenDialog({
        canSelectMany: true,
        canSelectFolders: true,
        canSelectFiles: true,
        filters: { 'Markdown': ['md'] },
        openLabel: 'Import'
      });
      if (!selections || selections.length === 0) return;

      let totalCount = 0;
      for (const uri of selections) {
        const stat = await vscode.workspace.fs.stat(uri);
        if ((stat.type & vscode.FileType.Directory) !== 0) {
          totalCount += await promptLibraryProvider.importFolder(uri, targetScope);
        } else {
          await promptLibraryProvider.importPrompt(uri, targetScope);
          totalCount++;
        }
      }
      vscode.window.showInformationMessage(`Imported ${totalCount} prompt(s) to ${targetScope}.`);
      vscode.commands.executeCommand('lumi-ops._getPrompts');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('lumi-ops._addPrompt', async (scope?: PromptScope) => {
      const targetScope = scope || 'project';
      const name = await vscode.window.showInputBox({
        prompt: 'Prompt name',
        placeHolder: 'e.g. refactor-component'
      });
      if (!name) return;

      const content = await vscode.window.showInputBox({
        prompt: 'Prompt content (or leave empty to edit in file)',
        placeHolder: 'Describe the task objective...'
      });

      const fileName = name.endsWith('.md') ? name : `${name}.md`;
      await promptLibraryProvider.savePrompt(fileName, content || '', targetScope);
      vscode.commands.executeCommand('lumi-ops._getPrompts');

      if (!content) {
        const fileUri = promptLibraryProvider.getPromptFileUri(fileName, targetScope);
        const doc = await vscode.workspace.openTextDocument(fileUri);
        await vscode.window.showTextDocument(doc);
      } else {
        vscode.window.showInformationMessage(`Prompt "${name}" created in ${targetScope}.`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('lumi-ops._deletePrompt', async (fileName: string, scope?: PromptScope) => {
      if (!fileName) return;
      const targetScope = scope || 'project';
      const promptName = fileName.replace(/\.md$/, '');
      const suppress = context.globalState.get<boolean>('suppressDeleteConfirm', false);

      if (!suppress) {
        const confirm = await vscode.window.showWarningMessage(
          `Delete prompt "${promptName}" (${targetScope})?`,
          { modal: true },
          'Delete',
          "Delete & Don't Ask Again"
        );
        if (!confirm) return;
        if (confirm === "Delete & Don't Ask Again") {
          await context.globalState.update('suppressDeleteConfirm', true);
        }
      }

      await promptLibraryProvider.deletePrompt(fileName, targetScope);
      vscode.commands.executeCommand('lumi-ops._getPrompts');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('lumi-ops.saveAsPrompt', async (content?: string, scope?: PromptScope) => {
      if (!content) return;
      const targetScope = scope || 'project';
      const name = await vscode.window.showInputBox({
        prompt: 'Enter a name for this prompt template',
        placeHolder: 'e.g. my-agent-prompt'
      });
      if (name) {
        const fileName = name.endsWith('.md') ? name : `${name}.md`;
        await promptLibraryProvider.savePrompt(fileName, content, targetScope);
        vscode.window.showInformationMessage(`Prompt "${name}" saved to ${targetScope}.`);
        vscode.commands.executeCommand('lumi-ops._getPrompts');
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('lumi-ops._copyPromptScope', async (fileName: string, fromScope: PromptScope, toScope: PromptScope) => {
      if (!fileName || !fromScope || !toScope) return;
      try {
        const { conflict } = await promptLibraryProvider.copyPromptToScope(fileName, fromScope, toScope);
        if (conflict) {
          const choice = await vscode.window.showQuickPick(
            ['Overwrite', 'Rename', 'Cancel'],
            { placeHolder: `A prompt with this name already exists in ${toScope}. Overwrite or Rename?` }
          );
          if (choice === 'Overwrite') {
            await promptLibraryProvider.copyPromptToScopeOverwrite(fileName, fromScope, toScope);
          } else if (choice === 'Rename') {
            const newName = await vscode.window.showInputBox({
              prompt: 'Enter new name for the copied prompt',
              value: fileName.replace(/\.md$/, '') + '-copy',
              validateInput: (v) => (!v?.trim() ? 'Name cannot be empty' : null),
            });
            if (newName) {
              const newFileName = newName.endsWith('.md') ? newName : `${newName}.md`;
              await promptLibraryProvider.copyPromptToScopeRenamed(fileName, newFileName, fromScope, toScope);
            }
          }
          // Cancel — do nothing
        }
        vscode.commands.executeCommand('lumi-ops._getPrompts');
      } catch (error: any) {
        vscode.window.showErrorMessage(`Failed to copy prompt: ${error.message}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('lumi-ops._editPrompt', async (fileName: string, scope?: PromptScope) => {
      if (!fileName) return;
      const targetScope = scope || 'project';
      try {
        const fileUri = promptLibraryProvider.getPromptFileUri(fileName, targetScope);
        const doc = await vscode.workspace.openTextDocument(fileUri);
        await vscode.window.showTextDocument(doc);
      } catch (error: any) {
        vscode.window.showErrorMessage(`Failed to open prompt: ${error.message}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('lumi-ops._getCloneBranches', async () => {
      await notifyCloneBranches();
    })
  );

  // -- Mission Template Commands --

  /** Refresh the mission template row in the prompt library webview. */
  async function notifyMissionTemplates() {
    try {
      const templates = await missionTemplateProvider.listTemplates();
      const active = await missionTemplateProvider.getActiveTemplateName();
      // Validate: active template must exist in the expected scope
      let activeKey = active.name === 'default' ? 'default' : `${active.name}:${active.scope}`;
      if (active.name !== 'default') {
        const match = templates.some(t => t.name === active.name && (active.scope === null || t.scope === active.scope));
        if (!match) {
          activeKey = 'default';
        }
      }
      promptLibraryViewProvider.updateMissionTemplate(activeKey, templates);
    } catch {
      promptLibraryViewProvider.updateMissionTemplate('default', []);
    }
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('lumi-ops._getMissionTemplates', async () => {
      await notifyMissionTemplates();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('lumi-ops._switchMission', async (name: string, scope?: string) => {
      if (!name) return;
      await missionTemplateProvider.setActiveTemplate(name, scope as any);
      await notifyMissionTemplates();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('lumi-ops._editMission', async () => {
      const active = await missionTemplateProvider.getActiveTemplateName();
      if (active.name === 'default') {
        vscode.window.showInformationMessage('Default mission template cannot be edited. Use "+" to fork it first.');
        return;
      }
      // Find the template file and open it (the custom editor will handle rendering)
      const templates = await missionTemplateProvider.listTemplates();
      const match = templates.find(t => t.name === active.name && (active.scope === null || t.scope === active.scope));
      if (match) {
        const fileUri = missionTemplateProvider.getTemplateFileUri(match.fileName, match.scope as any);
        await vscode.commands.executeCommand('vscode.openWith', fileUri, MissionTemplateEditorProvider.viewType);
      } else {
        vscode.window.showErrorMessage(`Mission template "${active.name}" not found.`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('lumi-ops._forkMission', async () => {
      const name = await vscode.window.showInputBox({
        prompt: 'Name for your new mission template',
        placeHolder: 'e.g. my-workflow',
        validateInput: (value) => {
          if (!value || !value.trim()) return 'Name cannot be empty';
          if (!/^[a-zA-Z0-9_-]+$/.test(value.trim())) return 'Only letters, numbers, hyphens, and underscores';
          return null;
        }
      });
      if (!name) return;

      const scope = rootPath ? 'project' : 'global';
      try {
        const fileUri = await missionTemplateProvider.forkDefault(name.trim(), scope);
        await missionTemplateProvider.setActiveTemplate(name.trim(), scope);
        await notifyMissionTemplates();
        // Open the new template with custom editor
        await vscode.commands.executeCommand('vscode.openWith', fileUri, MissionTemplateEditorProvider.viewType);
        vscode.window.showInformationMessage(`Mission template "${name}" created and activated.`);
      } catch (error: any) {
        vscode.window.showErrorMessage(`Failed to create mission template: ${error.message}`);
      }
    })
  );

  // Copy mission template to other scope from dropdown
  context.subscriptions.push(
    vscode.commands.registerCommand('lumi-ops._copyMissionScope', async (templateName: string, fromScope: string, toScope: string) => {
      if (!templateName || !fromScope || !toScope) return;
      try {
        const { conflict } = await missionTemplateProvider.copyToScope(`${templateName}.md`, fromScope as any, toScope as any);
        if (conflict) {
          const choice = await vscode.window.showQuickPick(
            ['Overwrite', 'Rename', 'Cancel'],
            { placeHolder: `A template with this name already exists in ${toScope}. Overwrite or Rename?` }
          );
          if (choice === 'Overwrite') {
            await missionTemplateProvider.copyToScopeOverwrite(`${templateName}.md`, fromScope as any, toScope as any);
          } else if (choice === 'Rename') {
            const newName = await vscode.window.showInputBox({
              prompt: 'Enter new name for the copied template',
              value: templateName + '-copy',
              validateInput: (v) => (!v?.trim() ? 'Name cannot be empty' : null),
            });
            if (newName) {
              const newFileName = newName.endsWith('.md') ? newName : `${newName}.md`;
              await missionTemplateProvider.copyToScopeRenamed(`${templateName}.md`, newFileName, fromScope as any, toScope as any);
            }
          }
        }
        await notifyMissionTemplates();
      } catch (error: any) {
        vscode.window.showErrorMessage(`Failed to copy template: ${error.message}`);
      }
    })
  );

  // Edit a specific mission template by name+scope
  context.subscriptions.push(
    vscode.commands.registerCommand('lumi-ops._editMissionByName', async (name: string, scope: string) => {
      if (!name || !scope) return;
      try {
        const fileUri = missionTemplateProvider.getTemplateFileUri(`${name}.md`, scope as any);
        await vscode.commands.executeCommand('vscode.openWith', fileUri, MissionTemplateEditorProvider.viewType);
      } catch (error: any) {
        vscode.window.showErrorMessage(`Failed to open template: ${error.message}`);
      }
    })
  );

  // Delete a mission template
  context.subscriptions.push(
    vscode.commands.registerCommand('lumi-ops._deleteMission', async (name: string, scope: string) => {
      if (!name || !scope) return;
      const confirm = await vscode.window.showWarningMessage(
        `Delete mission template "${name}" (${scope})?`, { modal: true }, 'Delete'
      );
      if (confirm !== 'Delete') return;
      try {
        await missionTemplateProvider.deleteTemplate(`${name}.md`, scope as any);
        // If deleting the active template, reset to default
        const active = await missionTemplateProvider.getActiveTemplateName();
        if (active.name === name && (active.scope === null || active.scope === scope)) {
          await missionTemplateProvider.setActiveTemplate('default');
        }
        await notifyMissionTemplates();
      } catch (error: any) {
        vscode.window.showErrorMessage(`Failed to delete template: ${error.message}`);
      }
    })
  );
}

export function deactivate() {}

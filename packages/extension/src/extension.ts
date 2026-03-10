import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
import { ShadowTreeProvider } from './ShadowTreeProvider';
import { ShadowCreatorProvider } from './ShadowCreatorProvider';
import { PromptLibraryViewProvider } from './PromptLibraryViewProvider';
import { PromptLibraryProvider } from './PromptLibraryProvider';
import { MissionTemplateProvider } from './MissionTemplateProvider';
import { MissionTemplateEditorProvider } from './MissionTemplateEditorProvider';
import { parseMissionTemplate, serializeMissionTemplate } from './missionTemplateUtils';
import { WorktreeManagerPanel } from './WorktreeManagerPanel';
import { StatusEventBus } from './StatusEventBus';
import { runMigrations } from './migrations';
import { deriveCloneId, setStatusIfApplicable } from './autoStatus';

import { GitUtils, getClonesDir, getRepoStorageDir, LUMI_OPS_HOME, METADATA_FILE, registerRepo } from '@lumi-ops/cli';

import { CommandDeps } from './commands/types';
import { registerSettingsCommands } from './commands/settings';
import { registerSpawnCommands } from './commands/spawn';
import { registerKillCommands } from './commands/kill';
import { registerMergeCommands } from './commands/merge';
import { registerNavigationCommands } from './commands/navigation';
import { registerBranchCommands } from './commands/branches';
import { registerPromptLibraryCommands } from './commands/promptLibrary';
import { registerMissionTemplateCommands } from './commands/missionTemplate';
import { registerRootAgentMode, syncRootAgentRule } from './rootAgentMode';

import { registerRebaseCommands } from './commands/rebase';

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
    const missionFile = vscode.Uri.joinPath(workspaceRoot.uri, '.lumi', 'MISSION.md');
    
    setTimeout(async () => {
      try {
        await vscode.workspace.fs.stat(missionFile);
        
        const doc = await vscode.workspace.openTextDocument(missionFile);
        await vscode.window.showTextDocument(doc, { 
          preview: false,
          preserveFocus: true 
        });

        // Determine prompt content based on clone's reviewStatus
        let prompt = 'Please read @.lumi/MISSION.md and start working on the objective described in it.';
        let message = '👻 Shadow Clone ready! Copy prompt to paste in chat?';

        try {
          const wsPath = workspaceRoot.uri.fsPath;
          const cloneId = deriveCloneId(wsPath);
          if (cloneId) {
            const gitCommonDir = execSync('git rev-parse --git-common-dir', {
              cwd: wsPath,
              encoding: 'utf-8',
            }).trim();
            const mainRepoRoot = path.dirname(path.resolve(wsPath, gitCommonDir));
            const metadataPath = path.join(getRepoStorageDir(mainRepoRoot), METADATA_FILE);
            const raw = fs.readFileSync(metadataPath, 'utf-8');
            const metadata = JSON.parse(raw);
            const reviewStatus = metadata[cloneId]?.reviewStatus;

            if (reviewStatus === 'needsRevision') {
              message = '🔄 Revision needed! Copy revision prompt to paste in chat?';
              prompt = 'You have review feedback. Read @.lumi/MISSION.md → @.lumi/MISSION_COMPLETE.md → @.lumi/REVIEW_FEEDBACK.md, then fix the issues listed in .lumi/REVIEW_FEEDBACK.md. After fixing, update .lumi/MISSION_COMPLETE.md.';
            }
          }
        } catch {
          // Could not read status — fall back to default prompt
        }
        
        const action = await vscode.window.showInformationMessage(
          message,
          'Copy Prompt'
        );
        if (action === 'Copy Prompt') {
          await vscode.env.clipboard.writeText(prompt);
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
    const worktreesMatch = rootPath.match(/^(.+)\.worktrees[\\/]/);
    
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

  // Root Agent Mode: inject/remove .agents/rules/ based on setting
  const isCloneWorkspace = !!currentWorkspacePath;
  registerRootAgentMode(context, rootPath, isCloneWorkspace);


  // -- Auto-status transitions for clone workspaces --
  if (isCloneWorkspace && rootPath && currentWorkspacePath) {
    // Derive mainRepoRoot using git (canonical method for worktrees)
    let mainRepoRoot: string | undefined;
    try {
      const gitCommonDir = execSync('git rev-parse --git-common-dir', {
        cwd: currentWorkspacePath,
        encoding: 'utf-8',
      }).trim();
      mainRepoRoot = path.dirname(path.resolve(currentWorkspacePath, gitCommonDir));
    } catch {
      console.warn('[lumi-ops] Could not derive mainRepoRoot via git, skipping auto-status transitions.');
    }

    if (mainRepoRoot) {
      const cloneId = deriveCloneId(currentWorkspacePath);
      if (cloneId) {
        // Auto todo → inProgress when clone workspace opens
        setStatusIfApplicable(mainRepoRoot, cloneId, 'inProgress', ['todo']);
      }
    }
  }

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

    // Seed example prompt on first activation
    const seededKey = 'lumi-ops.examplePromptSeeded';
    if (!context.globalState.get<boolean>(seededKey)) {
      const existingMdFiles = fs.readdirSync(globalPromptsPath).filter((f: string) => f.endsWith('.md'));
      if (existingMdFiles.length === 0) {
        const exampleContent = `# Example: Add User Authentication

> This is an example prompt showing how to write effective task descriptions
> for Shadow Clone agents. Feel free to delete or modify this file.

## Objective
Add JWT-based authentication to the Express.js API.

## Background
- The API currently has no authentication
- We need to protect all \`/api/\` routes
- Use the existing \`users\` table in the database

## Implementation Details
- Add \`jsonwebtoken\` and \`bcrypt\` dependencies
- Create \`src/middleware/auth.ts\` with JWT verification
- Add \`POST /auth/login\` and \`POST /auth/register\` endpoints
- Protect all \`/api/*\` routes with the auth middleware

## Edge Cases
- Token expiration handling (default 24h)
- Invalid/malformed token responses (401)
- Duplicate email registration (409)

## Verification
1. Run \`npm test\` — all existing tests should still pass
2. Test login flow: register → login → access protected route
3. Test rejection: access protected route without token → 401
`;
        fs.writeFileSync(path.join(globalPromptsPath, 'example-task.md'), exampleContent);
      }
      context.globalState.update(seededKey, true);
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

  // -- fs.watch for ref changes (needsRebase detection) --
  if (rootPath) {
    const gitDir = path.join(rootPath, '.git');
    const refsDir = path.join(gitDir, 'refs', 'heads');
    try {
      if (fs.existsSync(refsDir)) {
        let refDebounce: ReturnType<typeof setTimeout> | null = null;
        const refWatcher = fs.watch(refsDir, { recursive: true }, (_, filename) => {
          if (!filename) return;
          if (refDebounce) clearTimeout(refDebounce);
          refDebounce = setTimeout(async () => {
            try {
              const metadataPath = path.join(getRepoStorageDir(rootPath!), METADATA_FILE);
              let metadata: Record<string, any> = {};
              try {
                const raw = fs.readFileSync(metadataPath, 'utf-8');
                metadata = JSON.parse(raw);
              } catch {
                return; // No metadata
              }

              let changed = false;
              for (const [branch, meta] of Object.entries(metadata)) {
                if (!meta?.baseBranch) continue;
                // Check if the changed ref matches this clone's baseBranch
                // filename can be "main" or "feat/xxx" (nested)
                const changedBranch = filename!.replace(/\\/g, '/');
                if (changedBranch !== meta.baseBranch) continue;

                const git = new GitUtils(rootPath!);
                const ahead = await git.getCommitsAhead(meta.baseBranch, branch);
                const needsRebase = ahead > 0;
                if (meta.needsRebase !== needsRebase) {
                  meta.needsRebase = needsRebase;
                  changed = true;
                }
              }

              if (changed) {
                fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
                statusBus.fire('*');
              }
            } catch (e) {
              console.error('[lumi-ops] ref watcher error:', e);
            }
          }, 150);
        });
        context.subscriptions.push({ dispose: () => refWatcher.close() });
      }
    } catch (e) {
      console.error('[lumi-ops] \u274c Failed to watch refs:', e);
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

  // -- Register all commands from modules --
  const deps: CommandDeps = {
    rootPath,
    shadowTreeProvider,
    creatorProvider,
    promptLibraryProvider,
    promptLibraryViewProvider,
    missionTemplateProvider,
    statusBus,
  };

  context.subscriptions.push(
    ...registerSettingsCommands(context, deps),
    ...registerSpawnCommands(context, deps),
    ...registerKillCommands(context, deps),
    ...registerMergeCommands(context, deps),
    ...registerNavigationCommands(context, deps),
    ...registerBranchCommands(context, deps),
    ...registerPromptLibraryCommands(context, deps),
    ...registerMissionTemplateCommands(context, deps),
    ...registerRebaseCommands(context, deps),
  );

  // Expose internals for integration tests
  return {
    shadowTreeProvider,
    creatorProvider,
    promptLibraryProvider,
    promptLibraryViewProvider,
    missionTemplateProvider,
    missionEditorProvider,
    statusBus,
    deriveCloneId,
    setStatusIfApplicable,
    parseMissionTemplate,
    serializeMissionTemplate,
    syncRootAgentRule,
  };
}

export function deactivate() {}

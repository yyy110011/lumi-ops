import * as vscode from 'vscode';
import * as path from 'path';
import { kill, merge, GitUtils, getClonesDir, getRepoStorageDir, METADATA_FILE } from '@lumi-ops/cli';
import { CommandDeps } from './types';

export function registerMergeCommands(
  context: vscode.ExtensionContext,
  deps: CommandDeps,
): vscode.Disposable[] {
  const { rootPath, shadowTreeProvider } = deps;

  const mergeCmd = vscode.commands.registerCommand('lumi-ops.merge', async (item: any) => {
    const clone = item?.clone;
    if (!clone) return;
    // Resolve root from clone metadata (multi-root support) or fallback to primary
    const effectiveRoot = clone.repoRoot || rootPath;
    if (!effectiveRoot) return;
    const branchName = clone.currentBranch;  // Actual branch with commits
    const cloneId = clone.dirName;           // Stable identity for metadata/kill

    try {
      const git = new GitUtils(effectiveRoot);
      const fs = await import('fs');

      // 1. Read baseBranch from centralized metadata
      const metadataPath = path.join(getRepoStorageDir(effectiveRoot), METADATA_FILE);
      let baseBranch: string | undefined;
      try {
        const raw = fs.readFileSync(metadataPath, 'utf-8');
        const metadata = JSON.parse(raw);
        baseBranch = metadata[cloneId]?.baseBranch;
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
        .filter((b: string) => b !== branchName && !pinnedSet.has(b))
        .sort();

      const items: MergeOption[] = [
        ...pinnedItems,
        ...(otherBranches.length > 0 ? [{ label: '', kind: vscode.QuickPickItemKind.Separator } as MergeOption] : []),
        ...otherBranches.map((b: string) => {
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
        mergeCwd = effectiveRoot;
      } else if (worktreeMap.has(targetBranch)) {
        // Target is in an existing worktree — use that path
        mergeCwd = worktreeMap.get(targetBranch)!;
      } else {
        // Target not in any worktree — create one under clones dir
        const newWorktreePath = path.join(getClonesDir(effectiveRoot), targetBranch);
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
        await merge(branchName, { root: effectiveRoot, commitMessage, cwd: mergeCwd });
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
          title: `Killing shadow clone: ${cloneId}`,
          cancellable: false
        }, async () => {
          await kill(cloneId, { root: effectiveRoot });
        });
        vscode.window.showInformationMessage(`Shadow clone ${cloneId} deleted.`);
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
  });

  return [mergeCmd];
}

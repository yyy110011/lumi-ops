import * as vscode from 'vscode';
import { GitUtils } from '@lumi-ops/cli';
import { CommandDeps } from './types';

export function registerBranchCommands(
  context: vscode.ExtensionContext,
  deps: CommandDeps,
): vscode.Disposable[] {
  const { rootPath, creatorProvider } = deps;

  const getBranches = vscode.commands.registerCommand('lumi-ops.getBranches', async (repoRoot?: string) => {
    // Use provided repoRoot (from webview repo selector) or fallback to primary rootPath
    const effectiveRoot = repoRoot || rootPath;
    if (!effectiveRoot) return;
    try {
      const git = new GitUtils(effectiveRoot);
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
  });

  return [getBranches];
}

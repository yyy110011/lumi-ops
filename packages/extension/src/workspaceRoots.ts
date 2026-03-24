import * as vscode from 'vscode';
import * as fs from 'fs';
import { execSync } from 'child_process';

export interface ResolvedRoot {
  /** The main repo root path (deduplicated). */
  rootPath: string;
  /** If the workspace folder is inside a .worktrees/ directory, this is the clone workspace path. */
  cloneWorkspacePath?: string;
  /** The branch name of the clone workspace (if applicable). */
  shadowBranchName?: string;
  /** Whether this root was detected from a clone worktree folder. */
  isClone: boolean;
}

/**
 * Resolve all workspace folders to their main repo roots.
 * Deduplicates folders that belong to the same git tree.
 *
 * For example, if the user has both `/repo` and `/repo.worktrees/feat/x`
 * in their workspace, they resolve to the same root `/repo` and are merged.
 */
export function resolveWorkspaceRoots(): ResolvedRoot[] {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return [];

  const seen = new Map<string, ResolvedRoot>();

  for (const folder of folders) {
    let folderPath = folder.uri.fsPath;

    // Resolve symlinks
    try { folderPath = fs.realpathSync(folderPath); } catch { /* keep original */ }

    let rootPath = folderPath;
    let cloneWorkspacePath: string | undefined;
    let shadowBranchName: string | undefined;
    let isClone = false;

    // Check if inside a .worktrees/ directory
    const worktreesMatch = folderPath.match(/^(.+)\.worktrees[\\/]/);
    if (worktreesMatch && worktreesMatch[1]) {
      rootPath = worktreesMatch[1];
      cloneWorkspacePath = folderPath;
      isClone = true;

      try {
        shadowBranchName = getCurrentBranchSync(folderPath);
      } catch {
        // Failed to get branch name — non-fatal
      }
    } else {
      // Verify this folder is actually a git repo
      try {
        execSync('git rev-parse --git-dir', { cwd: folderPath, encoding: 'utf-8', stdio: 'pipe' });
      } catch {
        // Not a git repo — skip this folder
        continue;
      }
    }

    // Deduplicate by rootPath — first entry wins, but clone info is accumulated
    if (!seen.has(rootPath)) {
      seen.set(rootPath, { rootPath, cloneWorkspacePath, shadowBranchName, isClone });
    } else if (isClone && !seen.get(rootPath)!.cloneWorkspacePath) {
      // If we previously saw the root directly, now we also have clone info
      const existing = seen.get(rootPath)!;
      existing.cloneWorkspacePath = cloneWorkspacePath;
      existing.shadowBranchName = shadowBranchName;
      existing.isClone = true;
    }
  }

  return Array.from(seen.values());
}

/**
 * Synchronous helper to get the current branch name.
 * Used during activation where async isn't always convenient.
 */
function getCurrentBranchSync(cwd: string): string | undefined {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', {
      cwd,
      encoding: 'utf-8',
      stdio: 'pipe',
    }).trim();
  } catch {
    return undefined;
  }
}

/**
 * Show a QuickPick to select a root when multiple roots are available.
 * Auto-selects if only one root exists.
 */
export async function pickRoot(roots: ResolvedRoot[]): Promise<string | undefined> {
  if (roots.length === 0) return undefined;
  if (roots.length === 1) return roots[0].rootPath;

  const items = roots.map(r => ({
    label: r.rootPath.split('/').pop() || r.rootPath,
    description: r.rootPath,
    rootPath: r.rootPath,
  }));

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select repository',
  });

  return picked?.rootPath;
}

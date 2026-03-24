import * as fs from 'fs';
import * as path from 'path';

export interface AutoCloseWatcherDeps {
  existsSync: (p: string) => boolean;
  watch: (dir: string, listener: (event: string, filename: string | null) => void) => fs.FSWatcher;
  closeWindow: () => void;
}

const defaultDeps: AutoCloseWatcherDeps = {
  existsSync: fs.existsSync,
  watch: (dir, listener) => fs.watch(dir, listener),
  closeWindow: () => {
    // Dynamically require vscode to keep the module testable without vscode mock
    const vscode = require('vscode');
    vscode.commands.executeCommand('workbench.action.closeWindow');
  },
};

/**
 * Set up a file system watcher that auto-closes the VS Code window
 * when the clone's worktree directory is removed (e.g., by `kill()`).
 *
 * Watches the **parent** directory of the worktree path. When the
 * directory basename disappears, it triggers `workbench.action.closeWindow`.
 *
 * @param worktreePath - Absolute path to the clone's worktree directory
 * @param deps - Injectable dependencies for testing
 * @returns A dispose function to clean up the watcher, or undefined if setup failed
 */
export function setupAutoCloseWatcher(
  worktreePath: string,
  deps: AutoCloseWatcherDeps = defaultDeps,
): { dispose: () => void } | undefined {
  const parentDir = path.dirname(worktreePath);
  const dirName = path.basename(worktreePath);

  try {
    const watcher = deps.watch(parentDir, (_event, filename) => {
      if (filename === dirName && !deps.existsSync(worktreePath)) {
        watcher.close();
        deps.closeWindow();
      }
    });
    return { dispose: () => watcher.close() };
  } catch {
    // Non-fatal: parent directory may not exist or watcher may fail
    return undefined;
  }
}

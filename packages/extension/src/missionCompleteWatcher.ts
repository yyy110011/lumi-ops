/**
 * Fallback watcher for MISSION_COMPLETE.md file creation.
 * When a clone agent writes MISSION_COMPLETE.md, this watcher
 * automatically transitions the clone's reviewStatus to 'needsReview'.
 *
 * This is a fallback mechanism — the runner script in launch.ts handles
 * the primary status transition. This watcher catches cases where:
 * - The agent was started manually (not via `lumi-ops launch`)
 * - The runner script's Node.js status update failed
 */

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { getClonesDir } from '@lumi-ops/cli';
import { deriveCloneId, setStatusIfApplicable } from './autoStatus';
import { StatusEventBus } from './StatusEventBus';

/**
 * Set up a recursive watcher on each repo's `.worktrees/` directory.
 * Watches for MISSION_COMPLETE.md file creation events and auto-transitions
 * the clone status to 'needsReview' if currently 'inProgress'.
 *
 * @param allRoots - All resolved workspace repo roots
 * @param statusBus - Event bus for UI refresh
 * @returns Disposables to clean up watchers
 */
export function setupMissionCompleteWatchers(
  allRoots: string[],
  statusBus: StatusEventBus,
): vscode.Disposable[] {
  const disposables: vscode.Disposable[] = [];

  for (const root of allRoots) {
    const clonesDir = getClonesDir(root);

    try {
      if (!fs.existsSync(clonesDir)) {
        continue; // No worktrees directory yet — skip
      }

      let debounce: ReturnType<typeof setTimeout> | null = null;

      const watcher = fs.watch(clonesDir, { recursive: true }, (_event, filename) => {
        if (!filename) return;

        // Only care about MISSION_COMPLETE.md files
        const normalized = filename.replace(/\\/g, '/');
        if (!normalized.endsWith('.lumi/MISSION_COMPLETE.md')) return;

        // Debounce to avoid duplicate events
        if (debounce) clearTimeout(debounce);
        debounce = setTimeout(() => {
          // Derive clone ID from the full path
          const fullPath = path.join(clonesDir, normalized);
          if (!fs.existsSync(fullPath)) return; // Only handle creation, not deletion

          const worktreePath = path.resolve(fullPath, '..', '..');
          const cloneId = deriveCloneId(worktreePath);
          if (!cloneId) return;

          // Transition inProgress → needsReview
          const changed = setStatusIfApplicable(root, cloneId, 'needsReview', ['inProgress']);
          if (changed) {
            statusBus.fire('*');
          }
        }, 300);
      });

      disposables.push({ dispose: () => watcher.close() });
    } catch (e) {
      console.error(`[lumi-ops] ❌ Failed to watch for MISSION_COMPLETE.md in ${clonesDir}:`, e);
    }
  }

  return disposables;
}

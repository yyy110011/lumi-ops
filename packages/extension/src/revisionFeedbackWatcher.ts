import * as fs from 'fs';
import * as path from 'path';

export interface RevisionFeedbackWatcherDeps {
  existsSync: (p: string) => boolean;
  watch: (dir: string, listener: (event: string, filename: string | null) => void) => fs.FSWatcher;
  mkdirSync: (dir: string, opts?: fs.MakeDirectoryOptions) => void;
  showRevisionPopup: () => Promise<string | undefined>;
  copyToClipboard: (text: string) => Promise<void>;
  showConfirmation: (msg: string) => void;
}

const REVISION_PROMPT =
  'You have review feedback. Read @.lumi/MISSION.md → @.lumi/MISSION_COMPLETE.md → @.lumi/REVIEW_FEEDBACK.md, then fix the issues listed in .lumi/REVIEW_FEEDBACK.md. After fixing, update .lumi/MISSION_COMPLETE.md.';

const FEEDBACK_FILENAME = 'REVIEW_FEEDBACK.md';
const LUMI_DIR = '.lumi';
const DEBOUNCE_MS = 300;

const defaultDeps: RevisionFeedbackWatcherDeps = {
  existsSync: fs.existsSync,
  watch: (dir, listener) => fs.watch(dir, listener),
  mkdirSync: (dir, opts) => fs.mkdirSync(dir, opts),
  showRevisionPopup: async () => {
    const vscode = require('vscode');
    return vscode.window.showInformationMessage(
      '🔄 Revision needed! Copy revision prompt to paste in chat?',
      'Copy Prompt',
    );
  },
  copyToClipboard: async (text: string) => {
    const vscode = require('vscode');
    await vscode.env.clipboard.writeText(text);
  },
  showConfirmation: (msg: string) => {
    const vscode = require('vscode');
    vscode.window.showInformationMessage(msg);
  },
};

/**
 * Set up a file system watcher that shows a revision popup when
 * `.lumi/REVIEW_FEEDBACK.md` is created or modified in the clone workspace.
 *
 * Watches the `.lumi/` directory for REVIEW_FEEDBACK.md file events.
 * When the file appears (creation/modification, not deletion), shows
 * an information message offering to copy the revision prompt.
 *
 * @param workspacePath - Absolute path to the clone's workspace directory
 * @param deps - Injectable dependencies for testing
 * @returns A dispose function to clean up the watcher, or undefined if setup failed
 */
export function setupRevisionFeedbackWatcher(
  workspacePath: string,
  deps: RevisionFeedbackWatcherDeps = defaultDeps,
): { dispose: () => void } | undefined {
  const lumiDir = path.join(workspacePath, LUMI_DIR);

  // Ensure .lumi/ directory exists before watching
  try {
    if (!deps.existsSync(lumiDir)) {
      deps.mkdirSync(lumiDir, { recursive: true });
    }
  } catch {
    // Non-fatal: directory may already exist or be unwritable
  }

  try {
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const watcher = deps.watch(lumiDir, (_event, filename) => {
      if (filename !== FEEDBACK_FILENAME) return;

      // Only trigger when the file exists (creation/modification, not deletion)
      const feedbackPath = path.join(lumiDir, FEEDBACK_FILENAME);
      if (!deps.existsSync(feedbackPath)) return;

      // Debounce to avoid duplicate popups from rapid fs events
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(async () => {
        const action = await deps.showRevisionPopup();
        if (action === 'Copy Prompt') {
          await deps.copyToClipboard(REVISION_PROMPT);
          deps.showConfirmation('✅ Revision prompt copied to clipboard!');
        }
      }, DEBOUNCE_MS);
    });

    return {
      dispose: () => {
        if (debounceTimer) clearTimeout(debounceTimer);
        watcher.close();
      },
    };
  } catch {
    // Non-fatal: .lumi directory may not exist or watcher may fail
    return undefined;
  }
}

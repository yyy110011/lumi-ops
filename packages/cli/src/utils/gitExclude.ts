import * as path from 'path';
import * as fs from 'fs-extra';

const LUMI_OPS_MARKER = '# Lumi-Ops (auto-managed)';
const EXCLUDE_ENTRIES = [
  '.lumi/',
  '.agents/rules/lumi-ops-*.md',
];

/**
 * Ensures `.git/info/exclude` contains Lumi-Ops entries so generated
 * artifacts don't show up in `git status`. Handles both normal repos
 * and worktrees (where `.git` is a file pointing to the real git dir).
 */
export async function ensureGitExclude(rootDir: string): Promise<void> {
  const gitPath = path.join(rootDir, '.git');

  let actualExcludePath: string;
  try {
    const stat = await fs.stat(gitPath);
    if (stat.isFile()) {
      // Worktree: .git is a file containing "gitdir: <path>"
      const content = await fs.readFile(gitPath, 'utf-8');
      const match = content.match(/^gitdir:\s*(.+)$/m);
      if (!match) return;
      const gitDir = path.resolve(rootDir, match[1].trim());
      // For worktrees, use the common dir's info/exclude
      const commonDir = path.resolve(gitDir, '..', '..');
      actualExcludePath = path.join(commonDir, 'info', 'exclude');
    } else {
      actualExcludePath = path.join(gitPath, 'info', 'exclude');
    }
  } catch { /* not a git repo or can't read */ return; }

  let existing = '';
  try {
    existing = await fs.readFile(actualExcludePath, 'utf-8');
  } catch { /* file doesn't exist yet */ }

  const existingLines = existing.split('\n').map(line => line.trim());
  const missingEntries = EXCLUDE_ENTRIES.filter(entry => !existingLines.includes(entry));

  if (missingEntries.length === 0) return;

  const block = `\n${LUMI_OPS_MARKER}\n${missingEntries.join('\n')}\n`;

  await fs.ensureDir(path.dirname(actualExcludePath));
  await fs.appendFile(actualExcludePath, block);
}

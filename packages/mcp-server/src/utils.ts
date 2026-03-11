/**
 * Pure utility functions extracted from index.ts for testability.
 * These are re-exported by index.ts — consumers should not import this file directly.
 */

// ---------------------------------------------------------------------------
// parseDiffStat
// ---------------------------------------------------------------------------

/** Parse `git diff --numstat` output into structured data. */
export function parseDiffStat(raw: string): {
  filesChanged: number;
  insertions: number;
  deletions: number;
  files: { path: string; insertions: number; deletions: number }[];
} {
  const lines = raw.trim().split('\n').filter(Boolean);
  const files: { path: string; insertions: number; deletions: number }[] = [];
  let totalInsertions = 0;
  let totalDeletions = 0;

  for (const line of lines) {
    // numstat format: "insertions\tdeletions\tfilepath"
    // Binary files show as: "-\t-\tpath"
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    const [ins, del, ...pathParts] = parts;
    const filePath = pathParts.join('\t'); // handle paths with tabs (rare but safe)
    if (ins === '-' || del === '-') {
      // Binary file — count it but skip numeric totals
      files.push({ path: filePath, insertions: 0, deletions: 0 });
      continue;
    }
    const insertions = parseInt(ins, 10) || 0;
    const deletions = parseInt(del, 10) || 0;
    files.push({ path: filePath, insertions, deletions });
    totalInsertions += insertions;
    totalDeletions += deletions;
  }

  return { filesChanged: files.length, insertions: totalInsertions, deletions: totalDeletions, files };
}

// ---------------------------------------------------------------------------
// toKebabCase
// ---------------------------------------------------------------------------

/** Sanitize a name into kebab-case for prompt filenames. */
export function toKebabCase(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .toLowerCase();
}

// ---------------------------------------------------------------------------
// silenceStdout
// ---------------------------------------------------------------------------

/**
 * Redirect console.log to stderr while executing fn.
 * CLI functions use console.log with chalk/emoji which corrupts MCP stdio JSON.
 */
export async function silenceStdout<T>(fn: () => Promise<T>): Promise<T> {
  const origLog = console.log;
  console.log = console.error; // redirect to stderr
  try {
    return await fn();
  } finally {
    console.log = origLog;
  }
}

// ---------------------------------------------------------------------------
// resolveMainRepoRoot
// ---------------------------------------------------------------------------

import { execSync } from 'child_process';

/**
 * Resolve the **main** repository root from any path — including worktree paths.
 *
 * `git rev-parse --show-toplevel` returns the worktree's own directory when run
 * inside a worktree, which breaks metadata path resolution (see issue #31).
 *
 * Instead we use `--git-common-dir` which always points to the shared `.git`
 * directory of the main repo, then resolve its parent.
 */
export function resolveMainRepoRoot(cwd: string): string {
  // --git-common-dir returns the path to the shared .git dir.
  // In a worktree it's something like `/repo/.git` (absolute with --path-format).
  // In the main repo it's just `.git` or the absolute path.
  const commonDir = execSync('git rev-parse --path-format=absolute --git-common-dir', {
    cwd,
    encoding: 'utf-8',
  }).trim();

  // The common dir is the .git folder of the main repo.
  // Strip the trailing `/.git` (or `/.git/` if present) to get the repo root.
  if (commonDir.endsWith('/.git') || commonDir.endsWith('/.git/')) {
    return commonDir.replace(/\/\.git\/?$/, '');
  }

  // Edge case: bare repos or unusual layouts — fall back to --show-toplevel
  return execSync('git rev-parse --show-toplevel', {
    cwd,
    encoding: 'utf-8',
  }).trim();
}

// ---------------------------------------------------------------------------
// extractRootFromRootsResponse
// ---------------------------------------------------------------------------

import { fileURLToPath } from 'url';

/**
 * Extract a filesystem path from an MCP roots/list response.
 * Uses the first root's URI, converting file:// URIs to local paths.
 * Returns null if no valid root found.
 */
export function extractRootFromRootsResponse(roots: { uri: string; name?: string }[]): string | null {
  if (!roots || roots.length === 0) return null;
  const uri = roots[0].uri;
  if (!uri.startsWith('file://')) return null;
  try {
    return fileURLToPath(uri);
  } catch {
    return null;
  }
}

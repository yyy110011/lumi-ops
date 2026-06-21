/**
 * Shared mutable state and common helpers used across all MCP tool modules.
 * This is the single source of truth for rootDir and related utilities.
 */

import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
import {
  getLumiOpsHome,
  readMetadata as cliReadMetadata,
  writeMetadata as cliWriteMetadata,
  migrateMetadataToLumiDir,
} from '@lumi-ops/cli';
import type { ReviewStatus } from '@lumi-ops/cli';
import { resolveMainRepoRoot } from './utils.js';

// ---------------------------------------------------------------------------
// Shared State Singleton
// ---------------------------------------------------------------------------

export const serverState = {
  rootDir: '',
  rootDetectionMethod: 'cwd' as 'roots_protocol' | 'env_var' | 'cwd',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Auto-detect git repo root from cwd. Falls back to cwd if not inside a git repo. */
export function detectRootDirFromCwd(): string {
  try {
    return resolveMainRepoRoot(process.cwd());
  } catch {
    return process.cwd();
  }
}

/**
 * Resolve the effective repository root for a tool call.
 * Always resolves the provided path to the main repo root (handling worktree paths).
 */
export function resolveEffectiveRoot(repo: string): string {
  try {
    return resolveMainRepoRoot(repo);
  } catch {
    throw new Error(`Could not resolve repo root from path: '${repo}'. Ensure the path is inside a valid git repository.`);
  }
}

/**
 * Validate that a root directory points to a valid git repository.
 * Returns an MCP error response if invalid, or null if valid.
 * @param rootDir - Optional override; defaults to serverState.rootDir.
 */
export function ensureRootDir(rootDir?: string): { content: { type: 'text'; text: string }[]; isError: true } | null {
  const effectiveDir = rootDir || serverState.rootDir;
  try {
    execSync('git rev-parse --show-toplevel', { cwd: effectiveDir, stdio: 'ignore' });
    return null;
  } catch {
    return {
      content: [
        {
          type: 'text' as const,
          text: `No valid git repository at '${effectiveDir}'. Call 'set_project_root' with your project path to connect.`,
        },
      ],
      isError: true,
    };
  }
}

/**
 * Idempotent: move this repo's metadata out of the legacy `.worktrees/`
 * container into `<root>/.lumi/` before any read/write. The MCP server has no
 * activation hook of its own (unlike the extension), so this chokepoint is how
 * agents that drive the server standalone get migrated. Cheap no-op after the
 * first move. Best-effort — never block a metadata access on it.
 */
async function ensureMetadataMigrated(root: string): Promise<void> {
  if (!root) return;
  try {
    await migrateMetadataToLumiDir(root);
  } catch {
    /* best-effort */
  }
}

/** Read metadata for the current repo (delegates to CLI).
 * @param rootDir - Optional override; defaults to serverState.rootDir.
 */
export async function readMetadata(rootDir?: string) {
  const root = rootDir || serverState.rootDir;
  await ensureMetadataMigrated(root);
  return cliReadMetadata(root);
}

/** Write metadata for the current repo (delegates to CLI).
 * @param metadata - The metadata record to write.
 * @param rootDir - Optional override; defaults to serverState.rootDir.
 */
export async function writeMetadata(
  metadata: Record<string, { baseBranch?: string; description?: string; reviewStatus?: ReviewStatus; sourcePrompt?: string }>,
  rootDir?: string,
) {
  const root = rootDir || serverState.rootDir;
  await ensureMetadataMigrated(root);
  return cliWriteMetadata(root, metadata);
}

/** List .md files in a directory, excluding subdirectories like _missions/. */
export async function listPromptFiles(dir: string): Promise<string[]> {
  try {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && e.name.endsWith('.md'))
      .map((e) => e.name);
  } catch {
    return [];
  }
}

/** Resolve the prompt directory for a given scope. */
export function promptDir(scope: 'global' | 'project'): string {
  if (scope === 'global') {
    return path.join(getLumiOpsHome(), '.prompts');
  }
  return path.join(serverState.rootDir, '.prompts');
}

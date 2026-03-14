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
 * Validate that serverState.rootDir points to a valid git repository.
 * Returns an MCP error response if invalid, or null if valid.
 */
export function ensureRootDir(): { content: { type: 'text'; text: string }[]; isError: true } | null {
  try {
    execSync('git rev-parse --show-toplevel', { cwd: serverState.rootDir, stdio: 'ignore' });
    return null;
  } catch {
    return {
      content: [
        {
          type: 'text' as const,
          text: `No valid git repository at '${serverState.rootDir}'. Call 'set_project_root' with your project path to connect.`,
        },
      ],
      isError: true,
    };
  }
}

/** Read metadata for the current repo (delegates to CLI). */
export async function readMetadata() {
  return cliReadMetadata(serverState.rootDir);
}

/** Write metadata for the current repo (delegates to CLI). */
export async function writeMetadata(
  metadata: Record<string, { baseBranch?: string; description?: string; reviewStatus?: ReviewStatus; sourcePrompt?: string }>,
) {
  return cliWriteMetadata(serverState.rootDir, metadata);
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

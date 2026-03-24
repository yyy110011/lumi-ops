/**
 * Agent status file management.
 * Tracks background agent lifecycle via `.lumi/agent-status.json`.
 */

import * as path from 'path';
import * as fs from 'fs-extra';
import type { AgentStatus } from '../drivers/types';
import { hasSession } from './tmux';

/** Filename for agent status (inside .lumi/). */
export const AGENT_STATUS_FILE = 'agent-status.json';

/** Filename for agent log output (inside .lumi/). */
export const AGENT_LOG_FILE = 'agent.log';

/**
 * Write agent status to `.lumi/agent-status.json`.
 */
export async function writeAgentStatus(worktreePath: string, status: AgentStatus): Promise<void> {
  const lumiDir = path.join(worktreePath, '.lumi');
  await fs.ensureDir(lumiDir);
  const statusPath = path.join(lumiDir, AGENT_STATUS_FILE);
  await fs.writeJSON(statusPath, status, { spaces: 2 });
}

/**
 * Read agent status from `.lumi/agent-status.json`.
 * Returns null if the file doesn't exist.
 */
export async function readAgentStatus(worktreePath: string): Promise<AgentStatus | null> {
  const statusPath = path.join(worktreePath, '.lumi', AGENT_STATUS_FILE);
  try {
    return await fs.readJSON(statusPath) as AgentStatus;
  } catch {
    return null;
  }
}

/**
 * Read agent status and validate against tmux session liveness.
 * If the status file says `running` but the tmux session is dead,
 * updates the status to `completed` or `failed` based on exit code.
 */
export async function resolveAgentStatus(worktreePath: string): Promise<AgentStatus | null> {
  const status = await readAgentStatus(worktreePath);
  if (!status) return null;

  if (status.status === 'running') {
    const alive = hasSession(status.tmuxSession);
    if (!alive) {
      // Session ended — check exit code file
      const exitCodePath = path.join(worktreePath, '.lumi', 'agent-exit-code');
      let exitCode = 1; // default to failed if no exit code file
      try {
        const raw = await fs.readFile(exitCodePath, 'utf-8');
        exitCode = parseInt(raw.trim(), 10);
      } catch {
        // No exit code file — assume failed
      }
      status.status = exitCode === 0 ? 'completed' : 'failed';
      // Persist the resolved status
      await writeAgentStatus(worktreePath, status);
    }
  }

  return status;
}

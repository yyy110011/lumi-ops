/**
 * tmux session management utilities.
 * Used by the launch command to create/manage background agent sessions.
 */

import { execSync, execFileSync } from 'child_process';

/**
 * Convert a branch name to a tmux-safe session name.
 * tmux session names cannot contain dots or colons.
 * Format: `lumi-{sanitized}`
 */
export function sanitizeSessionName(branch: string): string {
  const sanitized = branch.replace(/[^a-zA-Z0-9_-]/g, '-');
  return `lumi-${sanitized}`;
}

/**
 * Check if tmux is installed on the system.
 */
export function isTmuxInstalled(): boolean {
  try {
    execFileSync('which', ['tmux'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a binary is available on PATH.
 */
export function isBinaryInstalled(binary: string): boolean {
  try {
    execFileSync('which', [binary], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a new detached tmux session running the given command.
 */
export function createSession(sessionName: string, command: string): void {
  execSync(`tmux new-session -d -s ${escapeArg(sessionName)} ${escapeArg(command)}`, {
    stdio: 'ignore',
  });
}

/**
 * Check if a tmux session exists (is alive).
 */
export function hasSession(sessionName: string): boolean {
  try {
    execFileSync('tmux', ['has-session', '-t', sessionName], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Attach to an existing tmux session.
 * This replaces the current process (blocking call).
 */
export function attachSession(sessionName: string): void {
  execSync(`tmux attach-session -t ${escapeArg(sessionName)}`, {
    stdio: 'inherit',
  });
}

/**
 * Kill a tmux session.
 */
export function killSession(sessionName: string): void {
  try {
    execFileSync('tmux', ['kill-session', '-t', sessionName], { stdio: 'ignore' });
  } catch {
    // Session may already be dead — that's fine
  }
}

/** Shell-escape an argument for use in execSync. */
function escapeArg(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

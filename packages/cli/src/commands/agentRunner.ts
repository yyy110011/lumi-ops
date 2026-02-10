import { execSync } from 'child_process';
import * as fs from 'fs-extra';
import * as path from 'path';
import chalk from 'chalk';

export interface StartAgentOptions {
  /** Absolute path to the worktree */
  worktreePath: string;
  /** Branch name (used for session naming) */
  branchName: string;
  /** Driver command, e.g. "gemini -y" */
  driver: string;
  /** Delay in ms before sending prompt (default: 15000) */
  promptDelay?: number;
}

/**
 * Start a background agent in an existing worktree.
 * Creates a tmux session, pipes output to agent.log, and sends the MISSION.md prompt.
 */
export async function startAgentInWorktree(options: StartAgentOptions): Promise<string> {
  const { worktreePath, branchName, driver, promptDelay = 15000 } = options;
  const sessionName = `lumi-${branchName}`;
  const logFile = path.join(worktreePath, 'agent.log');
  const statusFile = path.join(worktreePath, '.lumi-status.json');

  // Validate worktree exists
  if (!await fs.pathExists(worktreePath)) {
    throw new Error(`Worktree does not exist: ${worktreePath}`);
  }

  // Validate MISSION.md exists
  const missionFile = path.join(worktreePath, 'MISSION.md');
  if (!await fs.pathExists(missionFile)) {
    throw new Error(`MISSION.md not found in ${worktreePath}. Cannot start agent without a mission.`);
  }

  // Check if tmux is installed
  try {
    execSync('which tmux', { stdio: 'ignore' });
  } catch {
    throw new Error('tmux is not installed. Please install tmux first.');
  }

  // Check for existing session
  try {
    execSync(`tmux has-session -t "${sessionName}" 2>/dev/null`, { stdio: 'ignore' });
    throw new Error(`tmux session "${sessionName}" already exists. Kill it first or attach with: tmux attach -t ${sessionName}`);
  } catch (err: any) {
    // "already exists" error is thrown by us, re-throw it
    if (err.message.includes('already exists')) throw err;
    // Otherwise session doesn't exist, which is what we want
  }

  // Build prompt and escape for shell
  const prompt = `Please read @MISSION.md and start working on the objective described in it.`;
  const driverEscaped = driver.replace(/'/g, "'\\''");
  const promptEscaped = prompt.replace(/'/g, "'\\''");

  // 1. Create tmux session with user's login shell (loads ~/.zshrc, env, credentials)
  execSync(`tmux new-session -d -s "${sessionName}" -c "${worktreePath}"`, { stdio: 'ignore' });

  // 2. Keep session alive after driver exits
  execSync(`tmux set-option -t "${sessionName}" remain-on-exit on`, { stdio: 'ignore' });

  // 3. Pipe terminal output to agent.log for monitoring
  execSync(`tmux pipe-pane -t "${sessionName}" -o "cat >> '${logFile}'"`, { stdio: 'ignore' });

  // 4. Send the driver command (shell is ready, env is loaded)
  execSync(`tmux send-keys -t "${sessionName}" -l '${driverEscaped}'`, { stdio: 'ignore' });
  execSync(`tmux send-keys -t "${sessionName}" Enter`, { stdio: 'ignore' });

  // 5. Send the prompt after delay (let driver initialize + auth)
  setTimeout(() => {
    try {
      execSync(`tmux send-keys -t "${sessionName}" -l '${promptEscaped}'`, { stdio: 'ignore' });
      execSync(`sleep 1`);
      execSync(`tmux send-keys -t "${sessionName}" Enter`, { stdio: 'ignore' });
    } catch (e) {
      // Session may have died during init
    }
  }, promptDelay);

  // Write status file
  const status = {
    status: 'coding',
    message: 'Agent started',
    session: sessionName,
    startedAt: new Date().toISOString(),
    driver
  };
  await fs.writeFile(statusFile, JSON.stringify(status, null, 2));

  return sessionName;
}

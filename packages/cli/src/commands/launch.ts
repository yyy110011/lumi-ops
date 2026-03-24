/**
 * `lumi-ops launch <branch>` — Start a background AI agent on an existing clone.
 *
 * Flow:
 * 1. Resolve worktree path from branch name
 * 2. Pre-check: tmux installed, driver binary installed
 * 3. Build command via driver (or use raw --cmd)
 * 4. Generate .lumi/lumi-runner.sh (wraps command + exit code capture)
 * 5. Create tmux session
 * 6. Write agent-status.json
 */

import * as path from 'path';
import * as fs from 'fs-extra';
import chalk from 'chalk';
import { getClonesDir } from '../constants';
import { getDriver } from '../drivers';
import type { DriverName, AgentStatus } from '../drivers/types';
import {
  sanitizeSessionName,
  isTmuxInstalled,
  isBinaryInstalled,
  createSession,
  hasSession,
  killSession,
} from '../utils/tmux';
import { writeAgentStatus, AGENT_LOG_FILE } from '../utils/agent-status';

export interface LaunchCommandOptions {
  root: string;
  driver?: DriverName;
  cmd?: string;
  noPermissions?: boolean;
  maxTurns?: number;
  maxBudget?: number;
  model?: string;
  attach?: boolean;
}

export async function launch(branchName: string, options: LaunchCommandOptions): Promise<void> {
  const rootDir = path.resolve(options.root);

  // 1. Resolve worktree path
  const clonesDir = getClonesDir(rootDir);
  const worktreePath = path.join(clonesDir, branchName);

  if (!(await fs.pathExists(worktreePath))) {
    throw new Error(
      `Clone "${branchName}" not found at ${worktreePath}. Did you run \`lumi-ops spawn ${branchName}\` first?`
    );
  }

  // 2. Pre-checks
  if (!isTmuxInstalled()) {
    throw new Error(
      'tmux is not installed. Install it with:\n  macOS: brew install tmux\n  Linux: sudo apt install tmux'
    );
  }

  // Build the command to run
  let command: string;

  if (options.cmd) {
    // Raw command mode — no driver needed
    command = options.cmd;
  } else if (options.driver) {
    const driver = getDriver(options.driver);

    // Check driver binary exists
    if (!isBinaryInstalled(driver.binary)) {
      throw new Error(
        `${driver.name} CLI ("${driver.binary}") is not installed or not on PATH.\n` +
        `Install it and run \`${driver.binary} auth\` to authenticate before launching an agent.`
      );
    }

    // Build command
    command = driver.buildCommand({
      worktreePath,
      mission: '.lumi/MISSION.md',
      noPermissions: options.noPermissions || false,
      maxTurns: options.maxTurns,
      maxBudget: options.maxBudget,
      model: options.model,
    });
  } else {
    throw new Error('Either --driver or --cmd must be specified.');
  }

  // 3. Generate runner script
  const lumiDir = path.join(worktreePath, '.lumi');
  await fs.ensureDir(lumiDir);

  const logFile = path.join(lumiDir, AGENT_LOG_FILE);
  const exitCodeFile = path.join(lumiDir, 'agent-exit-code');
  const runnerPath = path.join(lumiDir, 'lumi-runner.sh');

  const runnerScript = `#!/bin/bash
cd "${worktreePath}"
(${command}) >> "${logFile}" 2>&1
echo $? > "${exitCodeFile}"
`;

  await fs.writeFile(runnerPath, runnerScript, { mode: 0o755 });

  // 4. Create tmux session
  const sessionName = sanitizeSessionName(branchName);

  // Kill existing session if any
  if (hasSession(sessionName)) {
    console.log(chalk.gray(`⟲ Killing existing session: ${sessionName}`));
    killSession(sessionName);
  }

  // Clear previous log and exit code
  try { await fs.remove(logFile); } catch { /* ignore */ }
  try { await fs.remove(exitCodeFile); } catch { /* ignore */ }

  console.log(chalk.blue(`🤖 Launching agent on ${branchName}...`));
  createSession(sessionName, `bash ${runnerPath}`);

  // 5. Write agent status
  const status: AgentStatus = {
    driver: options.driver || 'custom',
    tmuxSession: sessionName,
    startedAt: new Date().toISOString(),
    status: 'running',
    logFile: `.lumi/${AGENT_LOG_FILE}`,
  };
  await writeAgentStatus(worktreePath, status);

  console.log(chalk.green(`✨ Agent running in tmux session: ${sessionName}`));
  console.log(chalk.gray(`   Log: ${logFile}`));
  console.log(chalk.gray(`   Attach: lumi-ops attach ${branchName}`));

  // 6. Optionally attach
  if (options.attach) {
    const { attachSession } = await import('../utils/tmux');
    attachSession(sessionName);
  }
}

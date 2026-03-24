/**
 * `lumi-ops logs <branch>` — Tail the agent log file.
 */

import * as path from 'path';
import { execSync } from 'child_process';
import * as fs from 'fs-extra';
import chalk from 'chalk';
import { getClonesDir } from '../constants';
import { readAgentStatus, AGENT_LOG_FILE } from '../utils/agent-status';

export async function logs(branchName: string, options: { root: string }): Promise<void> {
  const rootDir = path.resolve(options.root);
  const worktreePath = path.join(getClonesDir(rootDir), branchName);

  // Try to get log file from agent status, fall back to default path
  const status = await readAgentStatus(worktreePath);
  const logFile = status
    ? path.join(worktreePath, status.logFile)
    : path.join(worktreePath, '.lumi', AGENT_LOG_FILE);

  if (!(await fs.pathExists(logFile))) {
    throw new Error(`No log file found at ${logFile}. Has an agent been launched on this clone?`);
  }

  console.log(chalk.blue(`📋 Tailing log: ${logFile}`));
  console.log(chalk.gray('Press Ctrl+C to stop.\n'));

  // tail -f with inherited stdio for live streaming
  execSync(`tail -f ${logFile}`, { stdio: 'inherit' });
}

/**
 * `lumi-ops attach <branch>` — Attach to a running agent's tmux session.
 */

import * as path from 'path';
import chalk from 'chalk';
import { getClonesDir } from '../constants';
import { resolveAgentStatus } from '../utils/agent-status';
import { hasSession, attachSession } from '../utils/tmux';

export async function attach(branchName: string, options: { root: string }): Promise<void> {
  const rootDir = path.resolve(options.root);
  const worktreePath = path.join(getClonesDir(rootDir), branchName);

  const status = await resolveAgentStatus(worktreePath);

  if (!status) {
    throw new Error(
      `No agent status found for "${branchName}". Launch an agent first with \`lumi-ops launch ${branchName} --driver <name>\`.`
    );
  }

  if (!hasSession(status.tmuxSession)) {
    console.log(chalk.yellow(`Agent session "${status.tmuxSession}" is no longer running (status: ${status.status}).`));
    throw new Error('No active tmux session to attach to.');
  }

  console.log(chalk.blue(`📎 Attaching to session: ${status.tmuxSession}...`));
  attachSession(status.tmuxSession);
}

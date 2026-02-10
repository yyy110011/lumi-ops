import * as path from 'path';
import * as fs from 'fs-extra';
import chalk from 'chalk';
import { startAgentInWorktree } from './agentRunner';

export interface StartAgentCommandOptions {
  root: string;
  driver: string;
}

/**
 * Start a background agent on an existing shadow clone worktree.
 */
export async function startAgent(branchName: string, options: StartAgentCommandOptions) {
  const rootPath = path.resolve(options.root);
  const targetPath = path.join(rootPath, '.shadow-clones', branchName);

  // Validate worktree exists
  if (!await fs.pathExists(targetPath)) {
    console.error(chalk.red(`Error: Shadow clone "${branchName}" not found at ${targetPath}`));
    process.exit(1);
  }

  // Validate MISSION.md exists
  const missionFile = path.join(targetPath, 'MISSION.md');
  if (!await fs.pathExists(missionFile)) {
    console.error(chalk.red(`Error: MISSION.md not found in ${targetPath}`));
    process.exit(1);
  }

  try {
    const sessionName = await startAgentInWorktree({
      worktreePath: targetPath,
      branchName,
      driver: options.driver
    });

    console.log(chalk.green(`\n✨ Background agent started in tmux session: ${sessionName}`));
    console.log(chalk.gray(`   Attach with: tmux attach -t ${sessionName}`));
  } catch (error: any) {
    console.error(chalk.red(`\n❌ Failed to start agent: ${error.message}`));
    process.exit(1);
  }
}

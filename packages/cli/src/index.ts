#!/usr/bin/env node
import { Command } from 'commander';
import { spawn } from './commands/spawn';
import { kill } from './commands/kill';
import { list } from './commands/list';
import { gc } from './commands/gc';
import { startAgent } from './commands/startAgent';
import * as path from 'path';

// Export for library usage
export * from './commands/spawn';
export * from './commands/kill';
export * from './commands/list';
export * from './commands/merge';
export * from './commands/gc';
export * from './commands/startAgent';
export * from './commands/agentRunner';
export * from './utils/git';




const program = new Command();

program
  .name('lumi-ops')
  .description('Shadow Clone Protocol - Git Worktree Automation')
  .version('0.1.0');

program
  .command('spawn')
  .description('Create a new shadow clone (worktree) for a feature branch')
  .argument('<branchName>', 'Name of the feature branch')
  .option('-r, --root <path>', 'Root directory of the project', process.cwd())
  .option('-d, --description <desc>', 'Task description for .cursorrules')
  .option('--driver <cmd>', 'Driver command for agent execution (required for background mode)')
  .option('--mode <mode>', 'Execution mode: background | interactive', 'interactive')
  .action(spawn);

program
  .command('kill')
  .description('Remove a shadow clone and its associated branch')
  .argument('<branchName>', 'Name of the feature branch')
  .option('-r, --root <path>', 'Root directory of the project', process.cwd())
  .action(kill);

program
  .command('list')
  .description('List all active shadow clones and worktrees')
  .option('-r, --root <path>', 'Root directory of the project', process.cwd())
  .option('--json', 'Output results as JSON')
  .action(list);

program
  .command('gc')
  .description('Garbage collect orphaned worktrees and tmux sessions')
  .option('-r, --root <path>', 'Root directory of the project', process.cwd())
  .option('--dry-run', 'Show what would be cleaned without actually cleaning')
  .option('-v, --verbose', 'Show detailed output')
  .action(async (options) => { await gc(options); });

program
  .command('start-agent')
  .description('Start a background agent on an existing shadow clone')
  .argument('<branchName>', 'Name of the feature branch')
  .option('-r, --root <path>', 'Root directory of the project', process.cwd())
  .option('--driver <cmd>', 'Driver command for agent execution', 'gemini -y')
  .action(startAgent);

program.parse();

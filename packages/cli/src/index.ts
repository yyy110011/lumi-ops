#!/usr/bin/env node
import { Command } from 'commander';
import { spawn } from './commands/spawn';
import { kill } from './commands/kill';
import { list } from './commands/list';
import { launch } from './commands/launch';
import { attach } from './commands/attach';
import { logs } from './commands/logs';
import { migrateLegacyClones } from './commands/migration';
import * as path from 'path';

// Re-export library API (backwards compatible for existing consumers)
export * from './lib';


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
  .command('migrate')
  .description('Migrate worktrees from legacy .shadow-clones/ to external storage')
  .option('-r, --root <path>', 'Root directory of the project', process.cwd())
  .option('--dry-run', 'Preview changes without actually migrating')
  .action(async (options) => {
    const rootDir = path.resolve(options.root);
    await migrateLegacyClones(rootDir, { dryRun: options.dryRun });
  });

program
  .command('launch')
  .description('Launch a background AI agent on an existing shadow clone')
  .argument('<branchName>', 'Name of the clone branch')
  .option('-r, --root <path>', 'Root directory of the project', process.cwd())
  .option('-d, --driver <name>', 'Agent driver: claude, gemini')
  .option('--cmd <command>', 'Raw command to run in tmux (no driver needed)')
  .option('--no-permissions', 'Skip permission prompts (driver-specific)')
  .option('--max-turns <n>', 'Max LLM turns (claude only)', parseInt)
  .option('--max-budget <usd>', 'Max spend in USD (claude only)', parseFloat)
  .option('--model <name>', 'Override model selection')
  .option('--attach', 'Immediately attach to tmux session after launch')
  .action(launch);

program
  .command('attach')
  .description('Attach to a running agent\'s tmux session')
  .argument('<branchName>', 'Name of the clone branch')
  .option('-r, --root <path>', 'Root directory of the project', process.cwd())
  .action(attach);

program
  .command('logs')
  .description('Tail the agent log file for a shadow clone')
  .argument('<branchName>', 'Name of the clone branch')
  .option('-r, --root <path>', 'Root directory of the project', process.cwd())
  .action(logs);

program.parse();


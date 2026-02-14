#!/usr/bin/env node
import { Command } from 'commander';
import { spawn } from './commands/spawn';
import { kill } from './commands/kill';
import { list } from './commands/list';
import { migrateLegacyClones } from './commands/migration';
import * as path from 'path';

// Export for library usage
export * from './commands/spawn';
export * from './commands/kill';
export * from './commands/list';
export * from './commands/merge';
export * from './commands/migration';
export * from './utils/git';
export * from './constants';




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

program.parse();

import * as path from 'path';
import * as fs from 'fs-extra';
import { execSync } from 'child_process';
import { GitUtils } from '../utils/git';
import chalk from 'chalk';

export interface GCOptions {
  root: string;
  dryRun?: boolean;
  verbose?: boolean;
}

export interface GCResult {
  orphanedFolders: string[];
  orphanedSessions: string[];
  cleaned: boolean;
}

export async function gc(options: GCOptions): Promise<GCResult> {
  const rootDir = path.resolve(options.root);
  const shadowDir = path.join(rootDir, '.shadow-clones');
  const git = new GitUtils(rootDir);
  
  const result: GCResult = {
    orphanedFolders: [],
    orphanedSessions: [],
    cleaned: false
  };
  
  console.log(chalk.blue('🧹 Running garbage collection...'));
  
  // 1. Get list of valid worktrees from Git
  const validWorktrees = new Set<string>();
  try {
    const worktreesRaw = await git.listWorktrees();
    for (const entry of worktreesRaw) {
      const lines = entry.split('\n');
      const worktreePath = lines.find((l: string) => l.startsWith('worktree'))?.split(' ')[1];
      if (worktreePath) {
        validWorktrees.add(worktreePath);
      }
    }
  } catch (e) {
    console.error(chalk.red('Failed to list worktrees'));
    return result;
  }
  
  if (options.verbose) {
    console.log(chalk.gray(`Found ${validWorktrees.size} valid worktrees`));
  }
  
  // 2. Scan .shadow-clones for orphaned folders
  if (await fs.pathExists(shadowDir)) {
    const folders = await fs.readdir(shadowDir);
    
    for (const folder of folders) {
      const folderPath = path.join(shadowDir, folder);
      const stat = await fs.stat(folderPath);
      
      if (!stat.isDirectory()) continue;
      
      // Check if this folder is a valid worktree
      if (!validWorktrees.has(folderPath)) {
        result.orphanedFolders.push(folder);
        console.log(chalk.yellow(`  📁 Orphaned folder: ${folder}`));
        
        if (!options.dryRun) {
          try {
            await fs.remove(folderPath);
            console.log(chalk.green(`     ✓ Deleted`));
          } catch (e) {
            console.log(chalk.red(`     ✗ Failed to delete: ${e}`));
          }
        }
      }
    }
  }
  
  // 3. Scan tmux sessions for orphaned lumi-* sessions
  try {
    const tmuxOutput = execSync('tmux list-sessions -F "#{session_name}"', { 
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    const sessions = tmuxOutput.trim().split('\n').filter(s => s.startsWith('lumi-'));
    
    for (const session of sessions) {
      const branch = session.replace('lumi-', '');
      const expectedPath = path.join(shadowDir, branch);
      
      // Check if worktree exists for this session
      if (!validWorktrees.has(expectedPath)) {
        result.orphanedSessions.push(session);
        console.log(chalk.yellow(`  🖥️  Orphaned session: ${session}`));
        
        if (!options.dryRun) {
          try {
            execSync(`tmux kill-session -t "${session}"`, { stdio: 'ignore' });
            console.log(chalk.green(`     ✓ Killed`));
          } catch (e) {
            console.log(chalk.red(`     ✗ Failed to kill: ${e}`));
          }
        }
      }
    }
  } catch (e) {
    // tmux not running or no sessions - that's fine
    if (options.verbose) {
      console.log(chalk.gray('  No tmux sessions found'));
    }
  }
  
  // 4. Summary
  const totalOrphans = result.orphanedFolders.length + result.orphanedSessions.length;
  
  if (totalOrphans === 0) {
    console.log(chalk.green('\n✨ No garbage found. System is clean!'));
  } else if (options.dryRun) {
    console.log(chalk.yellow(`\n⚠️  Found ${totalOrphans} orphaned items (dry run, nothing deleted)`));
    console.log(chalk.gray('   Run without --dry-run to clean up'));
  } else {
    console.log(chalk.green(`\n✨ Cleaned up ${totalOrphans} orphaned items`));
    result.cleaned = true;
  }
  
  return result;
}

/**
 * Quick GC check - returns true if cleanup was needed
 */
export async function quickGC(rootDir: string): Promise<boolean> {
  const result = await gc({ root: rootDir, dryRun: false, verbose: false });
  return result.cleaned;
}

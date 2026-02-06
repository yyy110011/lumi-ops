# Phase 6: Garbage Collection (Hygiene)

## 🎯 Goal
Prevent disk bloat from abandoned worktrees and orphaned tmux sessions. Implement a `lumi-ops gc` command for manual and automatic cleanup.

---

## 📂 Files to Create/Modify

| File | Action |
|------|--------|
| `packages/cli/src/commands/gc.ts` | **NEW** - Garbage collection command |
| `packages/cli/src/commands/spawn.ts` | **MODIFY** - Add pre-spawn GC check |
| `packages/cli/src/index.ts` | **MODIFY** - Register gc command |
| `packages/mcp-server/src/index.ts` | **MODIFY** - Add gc tool (optional) |

---

## 📋 Step-by-Step Implementation

### Step 1: Create gc.ts Command

Create `packages/cli/src/commands/gc.ts`:

```typescript
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
```

### Step 2: Register GC Command in CLI

Update `packages/cli/src/index.ts`:

```typescript
import { gc } from './commands/gc';

// Add export
export * from './commands/gc';

// Add command
program
  .command('gc')
  .description('Garbage collect orphaned worktrees and tmux sessions')
  .option('-r, --root <path>', 'Root directory of the project', process.cwd())
  .option('--dry-run', 'Show what would be cleaned without actually cleaning')
  .option('-v, --verbose', 'Show detailed output')
  .action(gc);
```

### Step 3: Add Pre-Spawn GC Check

Update `packages/cli/src/commands/spawn.ts`:

```typescript
import { quickGC } from './gc';

export async function spawn(branchName: string, options: SpawnOptions) {
  const rootDir = path.resolve(options.root);
  
  // Quick GC before spawning (silent cleanup)
  try {
    await quickGC(rootDir);
  } catch (e) {
    // Ignore GC errors, don't block spawn
  }
  
  // ... rest of existing spawn logic ...
}
```

### Step 4: Add GC Tool to MCP Server (Optional)

Update `packages/mcp-server/src/index.ts`:

```typescript
// Tool: garbage_collect
server.tool(
  'garbage_collect',
  'Clean up orphaned worktrees and tmux sessions',
  {
    root: z.string().optional().describe('Root directory of the git repository'),
    dryRun: z.boolean().optional().describe('Preview cleanup without deleting'),
  },
  async ({ root, dryRun }) => {
    const workingDir = root || process.cwd();
    
    try {
      const args = dryRun ? '--dry-run' : '';
      const output = execSync(`lumi-ops gc --root "${workingDir}" ${args}`, { 
        encoding: 'utf-8',
        cwd: workingDir 
      });
      
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            output: output.trim()
          }, null, 2),
        }],
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text', text: `Error running GC: ${message}` }],
        isError: true,
      };
    }
  }
);
```

### Step 5: Add VS Code Command (Optional)

In `extension.ts`:

```typescript
import { gc } from '@lumi-ops/cli';

context.subscriptions.push(
  vscode.commands.registerCommand('lumi-ops.gc', async () => {
    if (!rootPath) {
      vscode.window.showErrorMessage('No workspace folder open');
      return;
    }
    
    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: 'Running garbage collection...',
      cancellable: false
    }, async () => {
      try {
        const result = await gc({ root: rootPath, verbose: true });
        
        const total = result.orphanedFolders.length + result.orphanedSessions.length;
        if (total > 0) {
          vscode.window.showInformationMessage(
            `🧹 Cleaned up ${total} orphaned items`
          );
        } else {
          vscode.window.showInformationMessage('✨ No garbage found');
        }
        
        shadowTreeProvider.refresh();
      } catch (e) {
        vscode.window.showErrorMessage(`GC failed: ${e}`);
      }
    });
  })
);
```

---

## 🧪 How to Test

1. **Create orphaned folder:**
   ```bash
   mkdir -p .shadow-clones/orphan-test
   lumi-ops gc --dry-run  # Should detect orphan
   lumi-ops gc            # Should delete
   ```

2. **Create orphaned session:**
   ```bash
   tmux new-session -d -s "lumi-orphan-test" "sleep 3600"
   lumi-ops gc --dry-run  # Should detect orphan session
   lumi-ops gc            # Should kill session
   ```

3. **Test pre-spawn GC:**
   ```bash
   mkdir -p .shadow-clones/old-orphan
   lumi-ops spawn new-feature --mode interactive
   ls .shadow-clones/  # old-orphan should be gone
   ```

---

## ✅ Verification Checklist

- [ ] `lumi-ops gc` command registered and works
- [ ] `--dry-run` flag shows what would be cleaned without cleaning
- [ ] `--verbose` flag shows detailed output
- [ ] Orphaned folders (no matching git worktree) are detected and cleaned
- [ ] Orphaned tmux sessions (lumi-*) are detected and killed
- [ ] Pre-spawn GC runs silently before each spawn
- [ ] GC doesn't affect valid worktrees or sessions
- [ ] VS Code command triggers GC from sidebar (optional)
- [ ] MCP tool `garbage_collect` works (optional)

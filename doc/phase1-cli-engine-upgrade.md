# Phase 1: CLI Engine Upgrade

## 🎯 Goal
Upgrade the `spawn` command to support **drivers** and **modes**, transforming `lumi-ops` from a static worktree generator into a Background Agent Orchestrator.

---

## 📂 Files to Modify

| File | Action |
|------|--------|
| `packages/cli/src/commands/spawn.ts` | **MODIFY** - Add driver/mode support |
| `packages/cli/src/index.ts` | **MODIFY** - Update CLI argument parsing |

---

## 📋 Technical Requirements

### 1. New CLI Flags

Add the following flags to the `spawn` command:

```
--driver <cmd>    The command to execute (e.g., "gemini run", "cursor --background")
--mode <mode>     Execution mode: "background" | "interactive" (default: "interactive")
```

### 2. Mode Implementation Logic

#### Background Mode (`--mode background`)

When `mode === 'background'`:

1. **Require** `--driver` flag (error if not provided)
2. Execute via `tmux`:
   ```bash
   tmux new-session -d -s "lumi-{branchName}" "cd {worktreePath} && {driver}"
   ```
3. Write session info to `.lumi-status.json` in the worktree root:
   ```json
   {
     "status": "coding",
     "message": "Agent started",
     "session": "lumi-{branchName}",
     "startedAt": "ISO-8601 timestamp",
     "driver": "{driver command}"
   }
   ```
4. Log success message with session name

#### Interactive Mode (`--mode interactive`)

When `mode === 'interactive'` (default):

1. Execute VS Code CLI:
   ```bash
   code {worktreePath}
   ```
2. This is the existing behavior (open in new window)

### 3. Code Changes

Update `spawn.ts` with the following structure:

```typescript
import { execSync, spawn as spawnProcess } from 'child_process';

interface SpawnOptions {
  root: string;
  description?: string;
  driver?: string;           // NEW
  mode?: 'background' | 'interactive';  // NEW
}

export async function spawn(branchName: string, options: SpawnOptions) {
  // ... existing worktree creation logic ...

  // After worktree is ready, handle mode
  const mode = options.mode || 'interactive';
  
  if (mode === 'background') {
    if (!options.driver) {
      console.error(chalk.red('Error: --driver is required for background mode'));
      process.exit(1);
    }
    
    const sessionName = `lumi-${branchName}`;
    const tmuxCmd = `tmux new-session -d -s "${sessionName}" "cd ${targetPath} && ${options.driver}"`;
    
    try {
      execSync(tmuxCmd);
      
      // Write status file
      const statusFile = path.join(targetPath, '.lumi-status.json');
      const status = {
        status: 'coding',
        message: 'Agent started',
        session: sessionName,
        startedAt: new Date().toISOString(),
        driver: options.driver
      };
      await fs.writeFile(statusFile, JSON.stringify(status, null, 2));
      
      console.log(chalk.green(`✨ Background agent started in tmux session: ${sessionName}`));
      console.log(chalk.gray(`   Attach with: tmux attach -t ${sessionName}`));
    } catch (error: any) {
      console.error(chalk.red(`Failed to start tmux session: ${error.message}`));
      process.exit(1);
    }
  } else {
    // Interactive mode - open VS Code
    try {
      execSync(`code "${targetPath}"`);
      console.log(chalk.green(`✨ Opened VS Code at: ${targetPath}`));
    } catch (error: any) {
      console.error(chalk.yellow(`Could not open VS Code: ${error.message}`));
      console.log(chalk.gray(`   Open manually: code "${targetPath}"`));
    }
  }
}
```

### 4. Update CLI Entry Point

In `packages/cli/src/index.ts`, update the Commander.js setup:

```typescript
program
  .command('spawn <branch>')
  .description('Spawn a new shadow clone worktree')
  .option('-r, --root <path>', 'Root directory', process.cwd())
  .option('-d, --description <desc>', 'Task description for .cursorrules')
  .option('--driver <cmd>', 'Driver command for agent execution')
  .option('--mode <mode>', 'Execution mode: background | interactive', 'interactive')
  .action(async (branch, options) => {
    await spawn(branch, options);
  });
```

### 5. Error Handling

- Verify `tmux` is installed before background mode execution
- Handle tmux session name conflicts (session already exists)
- Gracefully handle VS Code CLI not being in PATH

---

## ✅ Verification Checklist

- [ ] `lumi-ops spawn feature-x` → Opens VS Code (existing behavior)
- [ ] `lumi-ops spawn feature-x --mode interactive` → Opens VS Code
- [ ] `lumi-ops spawn feature-x --mode background` → Error (missing driver)
- [ ] `lumi-ops spawn feature-x --mode background --driver "echo hello"` → Creates tmux session
- [ ] `.lumi-status.json` is created in worktree root after background spawn
- [ ] `tmux ls` shows the `lumi-feature-x` session

import * as path from 'path';
import * as fs from 'fs-extra';
import { execSync } from 'child_process';
import { GitUtils } from '../utils/git';
import chalk from 'chalk';

export interface SpawnOptions {
  root: string;
  description?: string;
  driver?: string;
  mode?: 'background' | 'interactive';
}

export async function spawn(branchName: string, options: SpawnOptions) {
  const rootDir = path.resolve(options.root);
  const git = new GitUtils(rootDir);
  const shadowDir = path.join(rootDir, '.shadow-clones');
  const targetPath = path.join(shadowDir, branchName);
  const mode = options.mode || 'interactive';

  try {
    if (!(await git.isGitRepo())) {
      console.error(chalk.red('Error: Not a git repository.'));
      process.exit(1);
    }

    console.log(chalk.blue(`🚀 Spawning shadow clone for branch: ${branchName}...`));

    // 1. Ensure .shadow-clones exists
    await fs.ensureDir(shadowDir);

    // 2. Add .shadow-clones to .gitignore (if not already present)
    const gitignorePath = path.join(rootDir, '.gitignore');
    const shadowClonesEntry = '.shadow-clones';
    
    try {
      let gitignoreContent = '';
      if (await fs.pathExists(gitignorePath)) {
        gitignoreContent = await fs.readFile(gitignorePath, 'utf-8');
      }
      
      // Check if .shadow-clones is already in .gitignore
      const lines = gitignoreContent.split('\n').map(l => l.trim());
      if (!lines.includes(shadowClonesEntry)) {
        // Append to .gitignore
        const newLine = gitignoreContent.endsWith('\n') || gitignoreContent === '' ? '' : '\n';
        await fs.appendFile(gitignorePath, `${newLine}${shadowClonesEntry}\n`);
        console.log(chalk.gray('✓ Added .shadow-clones to .gitignore.'));
      }
    } catch (e) {
      // Silently ignore gitignore errors
    }

    // 3. Add worktree
    await git.addWorktree(branchName, targetPath, 'main');

    // 4. Copy .env from root to worktree (if exists)
    const rootEnv = path.join(rootDir, '.env');
    const targetEnv = path.join(targetPath, '.env');
    if (await fs.pathExists(rootEnv)) {
      await fs.copy(rootEnv, targetEnv);
      console.log(chalk.gray('✓ Copied .env to shadow clone.'));
    }

    // 5. Create .cursorrules (AI Agent Context)
    const contextFile = path.join(targetPath, '.cursorrules');

    const description = options.description || 'No specific objective provided.';
    
    const contextContent = `# 🤖 Agent Mission: ${branchName}

## 🎯 Objective
${description}

## 📂 Environment
- You are working in an isolated Git Worktree.
- Path: \`${targetPath}\`

## ⚡ Instructions
1. Analyze the objective.
2. Implement the changes in this directory.
3. Run tests before committing.
`;
    await fs.writeFile(contextFile, contextContent);
    console.log(chalk.gray('✓ Generated .cursorrules.'));

    console.log(chalk.green(`\n✨ Shadow clone ready at: ${targetPath}`));

    // 6. Handle execution mode
    if (mode === 'background') {
      if (!options.driver) {
        console.error(chalk.red('Error: --driver is required for background mode'));
        process.exit(1);
      }

      // Check if tmux is installed
      try {
        execSync('which tmux', { stdio: 'ignore' });
      } catch {
        console.error(chalk.red('Error: tmux is not installed. Please install tmux first.'));
        process.exit(1);
      }

      const sessionName = `lumi-${branchName}`;

      // Check for existing session
      try {
        execSync(`tmux has-session -t "${sessionName}" 2>/dev/null`, { stdio: 'ignore' });
        console.error(chalk.red(`Error: tmux session "${sessionName}" already exists.`));
        console.log(chalk.gray(`   Attach with: tmux attach -t ${sessionName}`));
        console.log(chalk.gray(`   Or kill it:  tmux kill-session -t ${sessionName}`));
        process.exit(1);
      } catch {
        // Session doesn't exist, which is what we want
      }

      const tmuxCmd = `tmux new-session -d -s "${sessionName}" "cd '${targetPath}' && ${options.driver}"`;

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

        console.log(chalk.green(`\n✨ Background agent started in tmux session: ${sessionName}`));
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
  } catch (error: any) {
    console.error(chalk.red(`\n❌ Failed to spawn shadow clone: ${error.message}`));
    process.exit(1);
  }
}

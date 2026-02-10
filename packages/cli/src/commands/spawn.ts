import * as path from 'path';
import * as fs from 'fs-extra';
import { execSync, spawn as spawnProcess } from 'child_process';
import { GitUtils } from '../utils/git';
import chalk from 'chalk';
import { quickGC } from './gc';
import { startAgentInWorktree } from './agentRunner';

export interface SpawnOptions {
  root: string;
  description?: string;
  driver?: string;
  mode?: 'background' | 'interactive';
}

export async function spawn(branchName: string, options: SpawnOptions) {
  const rootDir = path.resolve(options.root);
  
  // Quick GC before spawning (silent cleanup)
  try {
    await quickGC(rootDir);
  } catch (e) {
    // Ignore GC errors, don't block spawn
  }
  
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
      const alreadyIgnored = lines.includes(shadowClonesEntry) || lines.includes(`${shadowClonesEntry}/`);
      if (!alreadyIgnored) {
        // Append to .gitignore
        const newLine = gitignoreContent.endsWith('\n') || gitignoreContent === '' ? '' : '\n';
        await fs.appendFile(gitignorePath, `${newLine}${shadowClonesEntry}\n`);
        console.log(chalk.gray('✓ Added .shadow-clones to .gitignore.'));
      }
    } catch (e) {
      // Silently ignore gitignore errors
    }

    // 3. Add worktree (branch from current branch, not hardcoded 'main')
    const currentBranch = await git.getCurrentBranch();
    await git.addWorktree(branchName, targetPath, currentBranch);

    // 4. Copy .env from root to worktree (if exists)
    const rootEnv = path.join(rootDir, '.env');
    const targetEnv = path.join(targetPath, '.env');
    if (await fs.pathExists(rootEnv)) {
      await fs.copy(rootEnv, targetEnv);
      console.log(chalk.gray('✓ Copied .env to shadow clone.'));
    }

    // 5. Create MISSION.md (AI Agent Context - tool-agnostic)
    const contextFile = path.join(targetPath, 'MISSION.md');

    const description = options.description || 'No specific objective provided.';
    
    const contextContent = `# 🤖 Agent Mission: ${branchName}

## 🎯 Objective
${description}

## 📂 Environment
- You are working in an isolated Git Worktree.
- Path: \`${targetPath}\`

## ⚠️ Important Rules
- This worktree directory IS your workspace. Run all commands directly from here. Do NOT use the scratch directory.

## ⚡ Instructions
1. Analyze the objective.
2. Implement the changes in this directory.
3. Run tests before committing.
4. When finished, provide a **commit message** following Conventional Commits format:
   - Example: \`feat: add OAuth login with Google provider\`
   - Example: \`fix: resolve race condition in data fetching\`
   - Include a brief summary of all changes made.
5. **IMPORTANT**: After committing, update the status file to signal completion:
   \`\`\`bash
   echo '{"status":"done","message":"Task completed","session":"lumi-${branchName}"}' > .lumi-status.json
   \`\`\`
`;
    await fs.writeFile(contextFile, contextContent);
    console.log(chalk.gray('✓ Generated MISSION.md.'));

    console.log(chalk.green(`\n✨ Shadow clone ready at: ${targetPath}`));

    // 6. Handle execution mode
    if (mode === 'background') {
      if (!options.driver) {
        console.error(chalk.red('Error: --driver is required for background mode'));
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
        console.error(chalk.red(`Failed to start agent: ${error.message}`));
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

import * as path from 'path';
import * as fs from 'fs-extra';
import { GitUtils } from '../utils/git';
import chalk from 'chalk';

export async function spawn(branchName: string, options: { root: string; description?: string }) {
  const rootDir = path.resolve(options.root);
  const git = new GitUtils(rootDir);
  const shadowDir = path.join(rootDir, '.shadow-clones');
  const targetPath = path.join(shadowDir, branchName);

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
  } catch (error: any) {
    console.error(chalk.red(`\n❌ Failed to spawn shadow clone: ${error.message}`));
    process.exit(1);
  }
}

import * as path from 'path';
import * as fs from 'fs-extra';
import { GitUtils } from '../utils/git';
import { SHADOW_CLONES_DIR } from '../constants';
import chalk from 'chalk';

export async function spawn(branchName: string, options: { root: string; description?: string; baseBranch?: string }) {
  const rootDir = path.resolve(options.root);
  const git = new GitUtils(rootDir);
  const shadowDir = path.join(rootDir, SHADOW_CLONES_DIR);
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
    const shadowClonesEntry = SHADOW_CLONES_DIR;
    
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
        console.log(chalk.gray(`✓ Added ${SHADOW_CLONES_DIR} to .gitignore.`));
      }
    } catch (e) {
      // Silently ignore gitignore errors
    }

    // 3. Add worktree — if branch exists, attach to it; otherwise create new from base branch
    const currentBranch = await git.getCurrentBranch();
    const resolvedBase = options.baseBranch || currentBranch;
    const exists = await git.branchExists(branchName);

    if (exists) {
      console.log(chalk.gray(`✓ Branch "${branchName}" exists — attaching worktree to existing branch.`));
      await git.addWorktreeExisting(targetPath, branchName);
    } else {
      await git.addWorktree(branchName, targetPath, resolvedBase);
    }

    // 3b. Persist base branch metadata (centralized)
    const metadataPath = path.join(shadowDir, '.lumi-metadata.json');
    let metadata: Record<string, { baseBranch: string }> = {};
    try { metadata = await fs.readJSON(metadataPath); } catch {}
    metadata[branchName] = { baseBranch: resolvedBase };
    await fs.writeJSON(metadataPath, metadata, { spaces: 2 });
    console.log(chalk.gray(`✓ Recorded base branch: ${resolvedBase}`));

    // 4. Copy .env from root to worktree (if exists)
    const rootEnv = path.join(rootDir, '.env');
    const targetEnv = path.join(targetPath, '.env');
    if (await fs.pathExists(rootEnv)) {
      await fs.copy(rootEnv, targetEnv);
      console.log(chalk.gray('✓ Copied .env to shadow clone.'));
    }

    // 5. Create MISSION.md (AI Agent Context - only when description is provided)
    if (options.description) {
      const contextFile = path.join(targetPath, 'MISSION.md');
      const contextContent = `# 🤖 Agent Mission: ${branchName}

## 🎯 Objective
${options.description}

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
`;
      await fs.writeFile(contextFile, contextContent);
      console.log(chalk.gray('✓ Generated MISSION.md.'));
    }

    console.log(chalk.green(`\n✨ Shadow clone ready at: ${targetPath}`));
  } catch (error: any) {
    console.error(chalk.red(`\n❌ Failed to spawn shadow clone: ${error.message}`));
    process.exit(1);
  }
}

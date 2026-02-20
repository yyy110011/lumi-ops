import * as path from 'path';
import * as fs from 'fs-extra';
import { GitUtils } from '../utils/git';
import { getClonesDir, getRepoStorageDir, METADATA_FILE } from '../constants';
import chalk from 'chalk';

export async function spawn(branchName: string, options: { root: string; description?: string; baseBranch?: string; templates?: { name: string; content: string }[] }) {
  const rootDir = path.resolve(options.root);
  const git = new GitUtils(rootDir);
  try {
    if (!(await git.isGitRepo())) {
      console.error(chalk.red('Error: Not a git repository.'));
      process.exit(1);
    }

    // 0. Ensure Repo Storage ID is initialized safely
    const { initRepoStorageDir } = await import('../constants');
    await initRepoStorageDir(rootDir);

    const clonesDir = getClonesDir(rootDir);
    const targetPath = path.join(clonesDir, branchName);

    console.log(chalk.blue(`🚀 Spawning shadow clone for branch: ${branchName}...`));

    // 1. Ensure clones directory exists
    await fs.ensureDir(clonesDir);

    // 2. Add worktree — if branch exists, attach to it; otherwise create new from base branch
    const currentBranch = await git.getCurrentBranch();
    const resolvedBase = options.baseBranch || currentBranch;
    const exists = await git.branchExists(branchName);

    if (exists) {
      console.log(chalk.gray(`✓ Branch "${branchName}" exists — attaching worktree to existing branch.`));
      await git.addWorktreeExisting(targetPath, branchName);
    } else {
      await git.addWorktree(branchName, targetPath, resolvedBase);
    }

    // 3. Persist base branch metadata (centralized)
    const repoStorageDir = getRepoStorageDir(rootDir);
    const metadataPath = path.join(repoStorageDir, METADATA_FILE);
    let metadata: Record<string, { baseBranch?: string }> = {};
    try { metadata = await fs.readJSON(metadataPath); } catch {}
    if (exists) {
      // Existing branch — base is unknown, don't record
      metadata[branchName] = {};
      console.log(chalk.gray(`✓ Base branch: unknown (existing branch)`));
    } else {
      metadata[branchName] = { baseBranch: resolvedBase };
      console.log(chalk.gray(`✓ Recorded base branch: ${resolvedBase}`));
    }
    await fs.writeJSON(metadataPath, metadata, { spaces: 2 });

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
      const templates = options.templates || [];

      // Build objective section — numbered sub-sections when templates are attached
      let objectiveSection: string;
      if (templates.length > 0) {
        let counter = 1;
        const parts: string[] = [];
        parts.push(`### ${counter}. Task Description\n${options.description}`);
        counter++;
        for (const t of templates) {
          parts.push(`### ${counter}. ${t.name}\n${t.content}`);
          counter++;
        }
        objectiveSection = parts.join('\n\n');
      } else {
        objectiveSection = options.description;
      }

      const contextContent = `# 🤖 Agent Mission: ${branchName}

## 🎯 Objective
${objectiveSection}

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

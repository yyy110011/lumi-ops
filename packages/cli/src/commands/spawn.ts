import * as path from 'path';
import * as fs from 'fs-extra';
import { GitUtils } from '../utils/git';
import { getClonesDir, getRepoStorageDir, METADATA_FILE } from '../constants';
import { registerRepo } from '../registry';
import chalk from 'chalk';
import { DEFAULT_MISSION_TEMPLATE } from '../missionDefaults';

export async function spawn(branchName: string, options: { root: string; description?: string; baseBranch?: string; templates?: { name: string; content: string }[]; missionTemplate?: { task?: string; rules: string; instructions: string }; copyFolders?: string[]; onProgress?: (message: string) => void }) {
  const rootDir = path.resolve(options.root);
  const git = new GitUtils(rootDir);
  try {
    if (!(await git.isGitRepo())) {
      throw new Error('Not a git repository.');
    }

    if (!(await git.hasCommits())) {
      throw new Error('Repository has no commits. Please make an initial commit before creating a Shadow Clone.');
    }

    // 0. Resolve clones directory

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

    // 4b. Copy configured folders/files from root to worktree
    if (options.copyFolders && options.copyFolders.length > 0) {
      for (const item of options.copyFolders) {
        const source = path.join(rootDir, item);
        const dest = path.join(targetPath, item);
        if (await fs.pathExists(source)) {
          options.onProgress?.(`Copying ${item}...`);
          await fs.copy(source, dest);
          console.log(chalk.gray(`✓ Copied ${item} to shadow clone.`));
        }
      }
    }

    // 5. Create MISSION.md (AI Agent Context - only when description is provided)
    if (options.description) {
      const contextFile = path.join(targetPath, 'MISSION.md');
      const templates = options.templates || [];
      const mission = options.missionTemplate;

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

      // Use custom mission template or fallback to default
      const rules = mission?.rules ?? DEFAULT_MISSION_TEMPLATE.rules;
      const instructions = mission?.instructions ?? DEFAULT_MISSION_TEMPLATE.instructions;

      const contextContent = `# 🤖 Agent Mission: ${branchName}

## Task
${objectiveSection}

## Environment
- You are working in an isolated Git Worktree.
- Path: \`${targetPath}\`

## Rules
${rules}

## Instructions
${instructions}
`;
      await fs.writeFile(contextFile, contextContent);
      console.log(chalk.gray('✓ Generated MISSION.md.'));
    }

    // 6. Register repo in global registry for Worktree Manager
    registerRepo(path.basename(rootDir), rootDir);

    console.log(chalk.green(`\n✨ Shadow clone ready at: ${targetPath}`));
  } catch (error: any) {
    throw error;
  }
}

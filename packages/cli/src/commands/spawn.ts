import * as path from 'path';
import * as fs from 'fs-extra';
import { GitUtils } from '../utils/git';
import { getClonesDir, getRepoStorageDir, METADATA_FILE } from '../constants';
import type { CloneType } from '../constants';
import { registerRepo } from '../registry';
import chalk from 'chalk';
import { DEFAULT_MISSION_TEMPLATE } from '../missionDefaults';
import { CLONE_AGENT_RULE_CONTENT, ROOT_AGENT_RULE_CONTENT } from '../agentRules';

export async function spawn(branchName: string, options: { root: string; description?: string; baseBranch?: string; parentBranch?: string; cloneType?: CloneType; templates?: { name: string; content: string }[]; missionTemplate?: { task?: string; rules: string; instructions: string }; copyFolders?: string[]; onProgress?: (message: string) => void }) {
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
    const resolvedBase = options.baseBranch || options.parentBranch || currentBranch;
    const exists = await git.branchExists(branchName);

    if (exists) {
      console.log(chalk.gray(`✓ Branch "${branchName}" exists — attaching worktree to existing branch.`));
      await git.addWorktreeExisting(targetPath, branchName);
    } else {
      await git.addWorktree(branchName, targetPath, resolvedBase);
    }

    // 3. Persist parent branch metadata (centralized)
    const repoStorageDir = getRepoStorageDir(rootDir);
    const metadataPath = path.join(repoStorageDir, METADATA_FILE);
    let metadata: Record<string, { baseBranch?: string; parentBranch?: string; cloneType?: CloneType; description?: string }> = {};
    try { metadata = await fs.readJSON(metadataPath); } catch {}
    if (exists) {
      // Existing branch — base is unknown, don't record
      metadata[branchName] = { cloneType: options.cloneType || 'task' };
      console.log(chalk.gray(`✓ Base branch: unknown (existing branch)`));
    } else {
      // Auto-detect parentBranch: only set if baseBranch matches an existing clone
      const isSubClone = options.parentBranch || Object.keys(metadata).some(k => k === resolvedBase);
      metadata[branchName] = {
        baseBranch: resolvedBase,
        ...(isSubClone ? { parentBranch: options.parentBranch || resolvedBase } : {}),
        cloneType: options.cloneType || 'task',
      };
      console.log(chalk.gray(`✓ Recorded base branch: ${resolvedBase}`));
    }
    if (options.description) {
      metadata[branchName].description = options.description;
    }
    await fs.writeJSON(metadataPath, metadata, { spaces: 2 });

    // 4. Copy .env from root to worktree (if exists)
    const rootEnv = path.join(rootDir, '.env');
    const targetEnv = path.join(targetPath, '.env');
    if (await fs.pathExists(rootEnv)) {
      await fs.copy(rootEnv, targetEnv);
      console.log(chalk.gray('✓ Copied .env to shadow clone.'));
    }

    // 4b. Read copyOnSpawn from .vscode/settings.json
    let settingsCopyFolders: string[] = [];
    let cloneAgentRulesEnabled = false;
    try {
      const settingsPath = path.join(rootDir, '.vscode', 'settings.json');
      const settings = await fs.readJSON(settingsPath);
      const copyOnSpawn = settings['lumi-ops.copyOnSpawn'];
      if (typeof copyOnSpawn === 'string') {
        settingsCopyFolders = copyOnSpawn.split('\n').map(s => s.trim()).filter(Boolean);
      }
      if (settings['lumi-ops.cloneAgentRules'] === true) {
        cloneAgentRulesEnabled = true;
      }
    } catch { /* no settings file */ }

    // Merge: caller-provided + settings + always include .vscode
    const allCopyFolders = [...new Set([
      ...(options.copyFolders || []),
      ...settingsCopyFolders,
      '.vscode',
    ])];

    // Copy merged folders/files from root to worktree
    for (const item of allCopyFolders) {
      const source = path.join(rootDir, item);
      const dest = path.join(targetPath, item);
      if (await fs.pathExists(source)) {
        options.onProgress?.(`Copying ${item}...`);
        await fs.copy(source, dest);
        console.log(chalk.gray(`✓ Copied ${item} to shadow clone.`));
      }
    }

    // 4c. Write agent rule file based on clone type
    if (cloneAgentRulesEnabled) {
      const rulesDir = path.join(targetPath, '.agents', 'rules');
      await fs.ensureDir(rulesDir);

      const isIntegration = (options.cloneType || 'task') === 'integration';

      if (isIntegration) {
        await fs.writeFile(path.join(rulesDir, 'lumi-ops-root-agent.md'), ROOT_AGENT_RULE_CONTENT);
        try { await fs.unlink(path.join(rulesDir, 'lumi-ops-clone-agent.md')); } catch {}
      } else {
        await fs.writeFile(path.join(rulesDir, 'lumi-ops-clone-agent.md'), CLONE_AGENT_RULE_CONTENT);
        try { await fs.unlink(path.join(rulesDir, 'lumi-ops-root-agent.md')); } catch {}
      }
    }

    // 5. Create MISSION.md (AI Agent Context - only when description is provided)
    if (options.description) {
      const lumiDir = path.join(targetPath, '.lumi');
      await fs.ensureDir(lumiDir);
      const contextFile = path.join(lumiDir, 'MISSION.md');
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
- Read and follow all rules in \`.agents/rules/\` before starting work.
- If \`.lumi/REVIEW_FEEDBACK.md\` exists, you are in a revision cycle — read it first.
- When finished:
  1. Write \`.lumi/MISSION_COMPLETE.md\` summarizing your changes.
  2. Commit only your code changes.
  3. If MCP is available, call \`set_clone_status\` with status \`needsReview\`.

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

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export function registerPrompts(server: McpServer): void {
  // ---------------------------------------------------------------------------
  // MCP Prompt 1-2: Review & Conflict Resolution
  // ---------------------------------------------------------------------------

  server.prompt(
    'review-and-merge',
    'Step-by-step guide to review a shadow clone\'s work, then approve+merge or request revisions. Use this when a clone has status needsReview.',
    { branch: z.string().describe('Branch name of the clone to review') },
    async ({ branch }) => {
      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: `You are reviewing a shadow clone's work. Follow these steps:

## Step 1: Get Review Summary
Call \`review_clone\` with branch "${branch}" to get:
- MISSION_COMPLETE.md report (what the agent claims to have done)
- Diff statistics (files changed, insertions, deletions)
- Commit history

## Step 2: Inspect Changes
Use \`get_clone_file_diff\` for any files that need closer inspection.
Focus on: correctness, code quality, test coverage, and adherence to the original mission.

## Step 3: Make a Decision
**If approved:**
1. \`set_clone_status\` → "done"
2. \`merge_clone\` with source="${branch}" into target branch
3. If merge succeeds: \`kill_clone\` to clean up
4. If merge conflicts: follow the resolve-conflict workflow

**If changes needed:**
1. \`request_revision\` with specific, actionable feedback
2. The clone agent will address the feedback on its next run`,
            },
          },
        ],
      };
    },
  );

  server.prompt(
    'resolve-conflict',
    'Step-by-step guide to resolve merge conflicts after merge_clone returns a conflict status. Use this when merge_clone reports conflicted files.',
    {
      source: z.string().describe('Source branch (being merged)'),
      target: z.string().describe('Target branch (merge destination)'),
    },
    async ({ source, target }) => {
      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: `You are resolving merge conflicts between branches. Follow these steps:

## Context
- Source branch (being merged): "${source}"
- Target branch (merge destination): "${target}"

## Step 1: Understand the Conflict
Review the conflict response from \`merge_clone\`. It includes:
- List of conflicted files
- Diff statistics showing what each branch changed
- Paths to the source clone's MISSION.md and MISSION_COMPLETE.md

## Step 2: Inspect Both Sides
Use \`get_clone_file_diff\` to understand what the source branch ("${source}") changed.
Use \`read_clone_file\` to read the current state of conflicted files in the source clone.

## Step 3: Resolve Conflicts
For each conflicted file:
1. Understand the intent of both changes
2. Manually edit the target branch to incorporate both sets of changes
3. Prefer keeping both changes when possible; only discard if truly incompatible

## Step 4: Retry the Merge
After resolving conflicts in the target branch, retry \`merge_clone\` with source="${source}" and target="${target}".
If new conflicts arise, repeat this process.`,
            },
          },
        ],
      };
    },
  );

  // ---------------------------------------------------------------------------
  // MCP Prompt 3-4: Spawn & Strategy
  // ---------------------------------------------------------------------------

  server.prompt(
    'spawn-with-context',
    'Guide an agent through spawning a shadow clone for a given task. Checks for reusable prompts, picks a branch name, spawns the clone, and optionally saves the prompt for reuse.',
    { task: z.string().describe('Task description or issue to work on') },
    async ({ task }) => {
      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: [
                `You need to spawn a shadow clone to work on the following task:`,
                ``,
                `"${task}"`,
                ``,
                `## Step 1: Check for Existing Prompts`,
                `Call \`list_prompts\` to see if there's already a prompt that matches this task.`,
                ``,
                `## Step 2: Choose a Branch Name`,
                `Pick a descriptive branch name in kebab-case format:`,
                `- Features: feat/short-description`,
                `- Fixes: fix/short-description`,
                `- Refactors: refactor/short-description`,
                ``,
                `## Step 3: Spawn the Clone`,
                `Call \`spawn_clone\` with:`,
                `- branch: your chosen branch name`,
                `- description: a clear, actionable task description for the agent`,
                `- Optionally: prompt + promptScope if reusing an existing prompt`,
                ``,
                `## Step 4: Save as Reusable Prompt (Optional)`,
                `If this task pattern is likely to recur, use \`save_prompt\` to save it for future use.`,
                `Set \`generated: true\` if it's auto-generated and should be cleaned up with the clone.`,
              ].join('\n'),
            },
          },
        ],
      };
    },
  );

  server.prompt(
    'multi-clone-strategy',
    'Guide a root agent through planning and executing a multi-clone parallel development strategy. Breaks down a high-level goal into independent tasks and spawns clones for each.',
    { goal: z.string().describe('High-level goal requiring parallel development') },
    async ({ goal }) => {
      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: [
                `You are the root agent planning a multi-clone parallel development strategy for:`,
                ``,
                `"${goal}"`,
                ``,
                `## Step 1: Break Down the Goal`,
                `Analyze the goal and decompose it into independent, parallelizable tasks.`,
                `For each task, determine:`,
                `- Clear scope and deliverables`,
                `- File dependencies (which files will be modified)`,
                `- A descriptive branch name (feat/, fix/, refactor/)`,
                ``,
                `## Step 2: Check for Existing Work`,
                `Call \`list_clones\` to check if any existing clones overlap with your planned tasks.`,
                `Adjust your plan to avoid duplicate effort.`,
                ``,
                `## Step 3: Spawn Clones`,
                `For each task, call \`spawn_clone\` with a clear, non-overlapping task description.`,
                `Important: Clones that modify the same files will cause merge conflicts — plan to merge them sequentially.`,
                ``,
                `## Step 4: Monitor Progress`,
                `Use \`list_clones\` to check overall status, and \`review_clone\` to inspect completed work.`,
                `When a clone finishes (hasReport: true), review it and decide whether to merge or request revision.`,
              ].join('\n'),
            },
          },
        ],
      };
    },
  );
}

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
Verification means **proving the code works**, not confirming it exists — check that tests were actually run and passed.

## Step 3: Make a Decision

**If approved:**
1. \`set_clone_status\` → "done"
2. \`merge_clone\` with source="${branch}" into target branch
3. If merge succeeds: \`kill_clone\` to clean up
4. If merge conflicts: follow the resolve-conflict workflow

**If changes needed:**
1. \`request_revision\` with **specific, synthesized feedback**
2. Reference what the clone actually did (file paths, line numbers), not your conversation with the user
3. The clone agent will address the feedback on its next run

## Writing Good Revision Feedback
The clone cannot see your conversation. Write feedback that proves you understood the code:
- ❌ "Fix the issues found in the review"
- ✅ "The null check you added at src/auth/validate.ts:42 should return 401, not 403. Also update the test assertion at tests/auth.test.ts:58."`,
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
                `## Step 3: Write the Description`,
                `The clone agent starts with ZERO context — it cannot see your conversation.`,
                `Brief it like a smart colleague who just walked into the room:`,
                ``,
                `**Include:**`,
                `- **Goal:** what to accomplish and why`,
                `- **Context:** what you already know or have ruled out`,
                `- **Location:** file paths, line numbers, function names (if known)`,
                `- **Scope:** what's in and what's out`,
                `- **Done condition:** what "finished" looks like`,
                `- Whether you expect code changes or research only`,
                ``,
                `**Avoid:**`,
                `- "Fix the bug we discussed" — the clone hasn't seen your discussion`,
                `- "Based on the analysis, implement it" — synthesize the analysis into specifics`,
                ``,
                `## Step 4: Spawn the Clone`,
                `Call \`spawn_clone\` with:`,
                `- branch: your chosen branch name`,
                `- description: the self-contained task description from Step 3`,
                `- Optionally: prompt + promptScope if reusing an existing prompt`,
                ``,
                `## Step 5: Save as Reusable Prompt (Optional)`,
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
                `Use \`list_clones\` to check overall status. Use \`describe_clone\` to get full details on a specific clone.`,
                `When a clone finishes (hasReport: true), review it using \`review_clone\` and decide whether to merge or request revision.`,
              ].join('\n'),
            },
          },
        ],
      };
    },
  );
  // ---------------------------------------------------------------------------
  // MCP Prompt 5: Evaluate Integration Branch
  // ---------------------------------------------------------------------------

  server.prompt(
    'evaluate-integration',
    'Evaluate an integration branch — review all sub-clones and merge completed work',
    {
      branch: z.string().describe('Integration branch name'),
      repo: z.string().describe('Repository path'),
    },
    async ({ branch, repo }) => {
      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: [
                `You are evaluating an **integration branch** and its sub-clones. Follow these steps:`,
                ``,
                `## Context`,
                `- Integration branch: "${branch}"`,
                `- Repository: "${repo}"`,
                ``,
                `## Step 1: List Sub-Clones`,
                `Call \`list_clones\` with repo="${repo}". Filter results to find clones whose \`parentBranch\` is "${branch}".`,
                `These are the sub-clones spawned from this integration branch.`,
                ``,
                `## Step 2: Review Each Sub-Clone`,
                `For each sub-clone, check its status:`,
                `- **needsReview**: Run \`review_clone\` to inspect the work. Use \`get_clone_file_diff\` for detailed file changes.`,
                `- **inProgress**: The agent is still working. Report it as pending.`,
                `- **todo**: Not started yet. Report it as pending.`,
                `- **done**: Already reviewed and approved. Ready for merge if not already merged.`,
                `- **needsRevision**: Waiting for the agent to address feedback.`,
                ``,
                `## Step 3: Approve or Request Revision`,
                `For clones with **needsReview**:`,
                `- If the work is satisfactory: \`set_clone_status\` → "done"`,
                `- If changes needed: \`request_revision\` with specific, actionable feedback`,
                ``,
                `## Step 4: Merge Completed Work`,
                `For clones with status **done** that haven't been merged yet:`,
                `1. \`merge_clone\` with source=<sub-clone branch> and target="${branch}"`,
                `2. If merge succeeds: \`kill_clone\` to clean up`,
                `3. If merge conflicts: follow the resolve-conflict workflow`,
                ``,
                `## Step 5: Report Integration Status`,
                `Summarize the overall status:`,
                `- How many sub-clones are complete and merged`,
                `- How many are still in progress or need revision`,
                `- Any blockers or conflicts encountered`,
                `- Whether the integration branch is ready for promotion to its parent branch`,
              ].join('\n'),
            },
          },
        ],
      };
    },
  );
}

/**
 * Default mission template — the single source of truth for MISSION.md content
 * when no custom template is configured.
 */
export const DEFAULT_MISSION_TEMPLATE = {
  name: 'default' as const,
  task: '',
  rules: '- This worktree directory IS your workspace. Run all commands directly from here. Do NOT use the scratch directory.',
  instructions: `1. Analyze the objective.
2. Implement the changes in this directory.
3. Run tests before committing.
4. When finished, provide a **commit message** following Conventional Commits format:
   - Example: \`feat: add OAuth login with Google provider\`
   - Example: \`fix: resolve race condition in data fetching\`
   - Include a brief summary of all changes made.
5. Before your final commit, create a \`MISSION_COMPLETE.md\` file in the worktree root with the following structure:

\`\`\`markdown
## Summary
Brief description of what was accomplished (3-5 sentences).

## Key Decisions
List the important design decisions made and why.

## ⚠️ Needs Attention
Areas that need careful review, things you're unsure about, or potential issues.

## Changes
| File | What | Why |
|------|------|-----|

## Verification Evidence
Paste actual build/test output proving the changes work.

## Open Questions
Anything that needs the user's input or decision.
\`\`\`

6. If a \`REVIEW_FEEDBACK.md\` file exists in the worktree root, you are in **revision mode**. Read \`MISSION.md\` → \`MISSION_COMPLETE.md\` → \`REVIEW_FEEDBACK.md\`, then address the feedback. Update \`MISSION_COMPLETE.md\` when done.`,
};

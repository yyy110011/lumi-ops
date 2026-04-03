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
3. **Verify your changes actually work:**
   - Run the project's test suite (check package.json scripts, Makefile, or other common build/test commands)
   - If tests fail, investigate and fix — don't dismiss failures as "unrelated"
   - Prove the code produces correct output, don't just confirm it exists
4. **Self-review your diff** before committing:
   - Any duplicated logic that could use existing project utilities?
   - Any unnecessary comments explaining *what* instead of *why*?
   - Any check-then-act patterns that should be try-catch instead?
5. When finished, provide a **commit message** following Conventional Commits format:
   - Example: \`feat: add OAuth login with Google provider\`
   - Example: \`fix: resolve race condition in data fetching\`
   - Include a brief summary of all changes made.
6. Before your final commit, create \`.lumi/MISSION_COMPLETE.md\` with the following structure:

\`\`\`markdown
---
status: completed
tests_passed: true
---

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
Summarize what you ran and the result:
- Test command and pass/fail summary
- Any other verification performed

Do NOT write "Tests pass" without having actually run them.

## Open Questions
Anything that needs the user's input or decision.
\`\`\`

7. If \`.lumi/REVIEW_FEEDBACK.md\` exists, you are in **revision mode**. Read \`.lumi/MISSION.md\` → \`.lumi/MISSION_COMPLETE.md\` → \`.lumi/REVIEW_FEEDBACK.md\`, then address the feedback. Update \`.lumi/MISSION_COMPLETE.md\` when done.`,
};

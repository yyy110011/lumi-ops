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
   - Include a brief summary of all changes made.`,
};

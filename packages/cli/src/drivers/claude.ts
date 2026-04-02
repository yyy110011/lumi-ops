import type { DriverSpec, LaunchOptions } from './types';

/**
 * Claude Code driver.
 * Builds a `claude -p` command for headless execution.
 */
export const claudeDriver: DriverSpec = {
  name: 'claude',
  binary: 'claude',
  capabilities: { budgetControl: true, turnLimit: true },

  buildCommand(opts: LaunchOptions): string {
    const parts: string[] = ['claude', '-p'];
    parts.push(`"Read ${opts.mission} and execute the mission described in it."`);

    // --dangerously-skip-permissions is required for headless mode — without it, permission prompts block execution
    parts.push('--dangerously-skip-permissions');

    if (opts.maxTurns !== undefined) {
      parts.push(`--max-turns ${opts.maxTurns}`);
    }
    if (opts.maxBudget !== undefined) {
      parts.push(`--max-budget-usd ${opts.maxBudget}`);
    }
    if (opts.model) {
      parts.push(`--model ${opts.model}`);
    }

    return parts.join(' ');
  },
};

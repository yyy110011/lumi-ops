import type { DriverSpec, LaunchOptions } from './types';

/**
 * Gemini CLI driver.
 * Builds a `gemini -p` command for headless execution.
 */
export const geminiDriver: DriverSpec = {
  name: 'gemini',
  binary: 'gemini',
  capabilities: { budgetControl: false, turnLimit: false },

  buildCommand(opts: LaunchOptions): string {
    const parts: string[] = ['gemini', '-p'];
    parts.push(`"Read ${opts.mission} and execute the mission described in it."`);

    if (opts.noPermissions) {
      parts.push('--sandbox=none');
    }
    if (opts.model) {
      parts.push(`--model ${opts.model}`);
    }

    return parts.join(' ');
  },
};

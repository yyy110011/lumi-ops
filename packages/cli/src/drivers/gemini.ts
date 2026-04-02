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

    // --yolo is required for headless mode — without it, write tools are silently denied
    parts.push('--yolo');

    if (opts.model) {
      parts.push(`--model ${opts.model}`);
    }

    return parts.join(' ');
  },
};

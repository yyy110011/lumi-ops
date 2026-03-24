/**
 * Driver abstraction for background AI agent execution.
 * Drivers know how to build the CLI command string for their respective agent tool.
 */

/** Supported AI agent driver names. */
export type DriverName = 'claude' | 'gemini';

/** Options passed to a driver's buildCommand(). */
export interface LaunchOptions {
  /** Absolute path to the worktree directory. */
  worktreePath: string;
  /** Relative path to MISSION.md within the worktree. */
  mission: string;
  /** Disable permission prompts (driver-specific). */
  noPermissions: boolean;
  /** Max LLM turns (claude only). */
  maxTurns?: number;
  /** Max spend in USD (claude only). */
  maxBudget?: number;
  /** Override model selection. */
  model?: string;
}

/** Driver contract — each agent CLI implements this. */
export interface DriverSpec {
  /** Human-readable driver name. */
  name: string;

  /** Binary name to check with `which`. */
  binary: string;

  /** Build the shell command to execute in tmux. */
  buildCommand(opts: LaunchOptions): string;

  /** Capability declarations. */
  capabilities: {
    budgetControl: boolean;
    turnLimit: boolean;
  };
}

/** Status values for a running/completed agent. */
export type AgentStatusValue = 'running' | 'completed' | 'failed';

/** Persisted agent status in `.lumi/agent-status.json`. */
export interface AgentStatus {
  driver: DriverName | 'custom';
  tmuxSession: string;
  startedAt: string;
  status: AgentStatusValue;
  logFile: string;
}

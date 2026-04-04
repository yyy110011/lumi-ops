// Library exports — safe to import without side effects.
// CLI entry point (index.ts) imports from here and adds program.parse().

export * from './commands/spawn';
export * from './commands/kill';
export * from './commands/list';
export * from './commands/merge';
export * from './commands/migration';
export * from './commands/metadata';
export * from './commands/status';
export * from './commands/revision';
export * from './utils/git';
export * from './constants';
export * from './registry';
export * from './missionDefaults';
export * from './agentRules';

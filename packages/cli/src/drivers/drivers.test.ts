import { describe, it, expect } from 'vitest';
import { claudeDriver } from './claude';
import { geminiDriver } from './gemini';
import { getDriver } from './index';

describe('claudeDriver', () => {
  it('builds basic command', () => {
    const cmd = claudeDriver.buildCommand({
      worktreePath: '/tmp/wt',
      mission: '.lumi/MISSION.md',
      noPermissions: false,
    });
    expect(cmd).toBe('claude -p "Read .lumi/MISSION.md and execute the mission described in it." --dangerously-skip-permissions');
  });

  it('always includes --dangerously-skip-permissions for headless execution', () => {
    const cmd = claudeDriver.buildCommand({
      worktreePath: '/tmp/wt',
      mission: '.lumi/MISSION.md',
      noPermissions: false,
    });
    expect(cmd).toContain('--dangerously-skip-permissions');
  });

  it('includes --max-turns and --max-budget-usd', () => {
    const cmd = claudeDriver.buildCommand({
      worktreePath: '/tmp/wt',
      mission: '.lumi/MISSION.md',
      noPermissions: false,
      maxTurns: 100,
      maxBudget: 5.0,
    });
    expect(cmd).toContain('--max-turns 100');
    expect(cmd).toContain('--max-budget-usd 5');
  });

  it('includes --model override', () => {
    const cmd = claudeDriver.buildCommand({
      worktreePath: '/tmp/wt',
      mission: '.lumi/MISSION.md',
      noPermissions: false,
      model: 'claude-sonnet-4-20250514',
    });
    expect(cmd).toContain('--model claude-sonnet-4-20250514');
  });

  it('has correct capabilities', () => {
    expect(claudeDriver.capabilities.budgetControl).toBe(true);
    expect(claudeDriver.capabilities.turnLimit).toBe(true);
  });

  it('has correct binary', () => {
    expect(claudeDriver.binary).toBe('claude');
  });
});

describe('geminiDriver', () => {
  it('builds basic command', () => {
    const cmd = geminiDriver.buildCommand({
      worktreePath: '/tmp/wt',
      mission: '.lumi/MISSION.md',
      noPermissions: false,
    });
    expect(cmd).toBe('gemini -p "Read .lumi/MISSION.md and execute the mission described in it." --yolo');
  });

  it('always includes --yolo for headless execution', () => {
    const cmd = geminiDriver.buildCommand({
      worktreePath: '/tmp/wt',
      mission: '.lumi/MISSION.md',
      noPermissions: false,
    });
    expect(cmd).toContain('--yolo');
  });

  it('includes --model override', () => {
    const cmd = geminiDriver.buildCommand({
      worktreePath: '/tmp/wt',
      mission: '.lumi/MISSION.md',
      noPermissions: false,
      model: 'gemini-2.5-pro',
    });
    expect(cmd).toContain('--model gemini-2.5-pro');
  });

  it('does not support budgetControl or turnLimit', () => {
    expect(geminiDriver.capabilities.budgetControl).toBe(false);
    expect(geminiDriver.capabilities.turnLimit).toBe(false);
  });

  it('has correct binary', () => {
    expect(geminiDriver.binary).toBe('gemini');
  });
});

describe('getDriver', () => {
  it('returns claude driver', () => {
    expect(getDriver('claude')).toBe(claudeDriver);
  });

  it('returns gemini driver', () => {
    expect(getDriver('gemini')).toBe(geminiDriver);
  });

  it('throws for unknown driver', () => {
    expect(() => getDriver('unknown' as any)).toThrow('Unknown driver: "unknown"');
  });
});

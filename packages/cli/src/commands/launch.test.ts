import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as path from 'path';

// --- Hoisted mocks ---
const fsMocks = vi.hoisted(() => ({
  pathExists: vi.fn(),
  ensureDir: vi.fn(),
  writeFile: vi.fn(),
  remove: vi.fn(),
  writeJSON: vi.fn(),
  readJSON: vi.fn(),
  readFile: vi.fn(),
}));

const tmuxMocks = vi.hoisted(() => ({
  sanitizeSessionName: vi.fn(),
  isTmuxInstalled: vi.fn(),
  isBinaryInstalled: vi.fn(),
  createSession: vi.fn(),
  hasSession: vi.fn(),
  killSession: vi.fn(),
  attachSession: vi.fn(),
}));

const getClonesDir = vi.hoisted(() => vi.fn((root: string) => `${root}.worktrees`));

vi.mock('fs-extra', () => fsMocks);
vi.mock('../utils/tmux', () => tmuxMocks);
vi.mock('../constants', () => ({
  getClonesDir: getClonesDir,
}));
vi.mock('../drivers', () => ({
  getDriver: vi.fn(() => ({
    name: 'claude',
    binary: 'claude',
    buildCommand: vi.fn(() => 'claude -p "Read .lumi/MISSION.md and execute the mission described in it."'),
    capabilities: { budgetControl: true, turnLimit: true },
  })),
}));
vi.mock('../utils/agent-status', () => ({
  writeAgentStatus: vi.fn(),
  AGENT_LOG_FILE: 'agent.log',
}));

import { launch } from './launch';

describe('launch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-apply defaults after clearAllMocks
    fsMocks.pathExists.mockResolvedValue(true);
    tmuxMocks.isTmuxInstalled.mockReturnValue(true);
    tmuxMocks.isBinaryInstalled.mockReturnValue(true);
    tmuxMocks.hasSession.mockReturnValue(false);
    tmuxMocks.sanitizeSessionName.mockImplementation((b: string) => `lumi-${b}`);
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });


  it('throws when clone does not exist', async () => {
    fsMocks.pathExists.mockResolvedValue(false);
    await expect(
      launch('feat/nonexistent', { root: '/repo', driver: 'claude' })
    ).rejects.toThrow('not found');
  });

  it('throws when tmux is not installed', async () => {
    tmuxMocks.isTmuxInstalled.mockReturnValue(false);
    await expect(
      launch('feat/test', { root: '/repo', driver: 'claude' })
    ).rejects.toThrow('tmux is not installed');
  });

  it('throws when driver binary is not installed', async () => {
    tmuxMocks.isBinaryInstalled.mockReturnValue(false);
    await expect(
      launch('feat/test', { root: '/repo', driver: 'claude' })
    ).rejects.toThrow('not installed or not on PATH');
  });

  it('throws when neither driver nor cmd is specified', async () => {
    await expect(
      launch('feat/test', { root: '/repo' })
    ).rejects.toThrow('--driver or --cmd');
  });

  it('creates runner script and tmux session', async () => {
    await launch('feat/test', { root: '/repo', driver: 'claude' });

    // Should create runner script
    expect(fsMocks.writeFile).toHaveBeenCalledWith(
      expect.stringContaining('lumi-runner.sh'),
      expect.stringContaining('#!/bin/bash'),
      expect.objectContaining({ mode: 0o755 })
    );

    // Should create tmux session
    expect(tmuxMocks.createSession).toHaveBeenCalled();
  });

  it('kills existing session before creating new one', async () => {
    tmuxMocks.hasSession.mockReturnValue(true);
    await launch('feat/test', { root: '/repo', driver: 'claude' });

    expect(tmuxMocks.killSession).toHaveBeenCalled();
    expect(tmuxMocks.createSession).toHaveBeenCalled();
  });

  it('writes agent status after launch', async () => {
    const { writeAgentStatus } = await import('../utils/agent-status');
    await launch('feat/test', { root: '/repo', driver: 'claude' });

    expect(writeAgentStatus).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        driver: 'claude',
        status: 'running',
      })
    );
  });

  it('accepts raw --cmd without driver', async () => {
    await launch('feat/test', { root: '/repo', cmd: 'npm test' });

    expect(fsMocks.writeFile).toHaveBeenCalledWith(
      expect.stringContaining('lumi-runner.sh'),
      expect.stringContaining('npm test'),
      expect.any(Object)
    );
  });
});

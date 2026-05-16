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
  pipePaneToLog: vi.fn(),
}));

const getClonesDir = vi.hoisted(() => vi.fn((root: string) => `${root}.worktrees`));
const getRepoStorageDir = vi.hoisted(() => vi.fn((root: string) => `${root}.worktrees`));

vi.mock('fs-extra', () => fsMocks);
vi.mock('../utils/tmux', () => tmuxMocks);
vi.mock('../constants', () => ({
  getClonesDir: getClonesDir,
  getRepoStorageDir: getRepoStorageDir,
  METADATA_FILE: '.lumi-metadata.json',
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
  AGENT_STATUS_FILE: 'agent-status.json',
}));

import { launch } from './launch';

describe('launch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-apply defaults after clearAllMocks
    fsMocks.pathExists.mockResolvedValue(true);
    fsMocks.readJSON.mockRejectedValue(new Error('no file')); // metadata read fails by default
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

  it('creates runner script without stdout redirect and calls pipePaneToLog', async () => {
    await launch('feat/test', { root: '/repo', driver: 'claude' });

    // Should create runner script
    const writeCall = fsMocks.writeFile.mock.calls.find(
      (call: any[]) => typeof call[0] === 'string' && call[0].includes('lumi-runner.sh')
    );
    expect(writeCall).toBeDefined();

    const scriptContent = writeCall![1] as string;

    // Should contain shebang
    expect(scriptContent).toContain('#!/bin/bash');

    // Should NOT contain stdout redirect (>> "...log" 2>&1)
    expect(scriptContent).not.toMatch(/>> ".*agent\.log" 2>&1/);

    // Should contain the command directly (no subshell redirect)
    expect(scriptContent).toContain('claude -p');

    // Should capture exit code
    expect(scriptContent).toContain('EXIT_CODE=$?');

    // Should contain auto-status logic for needsReview
    expect(scriptContent).toContain('MISSION_COMPLETE.md');
    expect(scriptContent).toContain('needsReview');

    // Should contain agent-status.json update
    expect(scriptContent).toContain('agent-status.json');
    expect(scriptContent).toContain('completed');
    expect(scriptContent).toContain('failed');

    // Should create tmux session
    expect(tmuxMocks.createSession).toHaveBeenCalled();

    // Should call pipePaneToLog after createSession
    expect(tmuxMocks.pipePaneToLog).toHaveBeenCalledWith(
      'lumi-feat/test',
      expect.stringContaining('agent.log')
    );
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

  it('sets reviewStatus to inProgress before tmux start', async () => {
    fsMocks.readJSON.mockResolvedValue({
      'feat/test': { reviewStatus: 'todo', baseBranch: 'main' },
    });

    await launch('feat/test', { root: '/repo', driver: 'claude' });

    expect(fsMocks.writeJSON).toHaveBeenCalledWith(
      expect.stringContaining('.lumi-metadata.json'),
      expect.objectContaining({
        'feat/test': expect.objectContaining({ reviewStatus: 'inProgress' }),
      }),
      { spaces: 2 }
    );

    // writeJSON should be called before createSession
    const writeJSONOrder = fsMocks.writeJSON.mock.invocationCallOrder[0];
    const createSessionOrder = tmuxMocks.createSession.mock.invocationCallOrder[0];
    expect(writeJSONOrder).toBeLessThan(createSessionOrder);
  });

  it('does not override non-todo status when setting inProgress', async () => {
    fsMocks.readJSON.mockResolvedValue({
      'feat/test': { reviewStatus: 'needsReview', baseBranch: 'main' },
    });

    await launch('feat/test', { root: '/repo', driver: 'claude' });

    // Should NOT have called writeJSON for metadata (only writeFile for runner script)
    const writeJSONCalls = fsMocks.writeJSON.mock.calls.filter(
      (call: any[]) => typeof call[0] === 'string' && call[0].includes('.lumi-metadata.json')
    );
    expect(writeJSONCalls).toHaveLength(0);
  });

  it('transitions needsRevision to inProgress on re-launch', async () => {
    fsMocks.readJSON.mockResolvedValue({
      'feat/test': { reviewStatus: 'needsRevision', baseBranch: 'main' },
    });

    await launch('feat/test', { root: '/repo', driver: 'claude' });

    expect(fsMocks.writeJSON).toHaveBeenCalledWith(
      expect.stringContaining('.lumi-metadata.json'),
      expect.objectContaining({
        'feat/test': expect.objectContaining({ reviewStatus: 'inProgress' }),
      }),
      { spaces: 2 }
    );
  });
});

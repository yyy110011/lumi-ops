import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as path from 'path';

const fsMocks = vi.hoisted(() => ({
  ensureDir: vi.fn(),
  writeJSON: vi.fn(),
  readJSON: vi.fn(),
  readFile: vi.fn(),
  pathExists: vi.fn(),
}));

const tmuxMocks = vi.hoisted(() => ({
  hasSession: vi.fn(),
}));

vi.mock('fs-extra', () => fsMocks);
vi.mock('../utils/tmux', () => tmuxMocks);

import { writeAgentStatus, readAgentStatus, resolveAgentStatus, AGENT_STATUS_FILE, AGENT_LOG_FILE } from './agent-status';
import type { AgentStatus } from '../drivers/types';

describe('agent-status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockStatus: AgentStatus = {
    driver: 'claude',
    tmuxSession: 'lumi-feat-test',
    startedAt: '2026-01-01T00:00:00Z',
    status: 'running',
    logFile: '.lumi/agent.log',
  };

  describe('writeAgentStatus', () => {
    it('writes status file to .lumi directory', async () => {
      await writeAgentStatus('/tmp/wt', mockStatus);
      expect(fsMocks.ensureDir).toHaveBeenCalledWith(path.join('/tmp/wt', '.lumi'));
      expect(fsMocks.writeJSON).toHaveBeenCalledWith(
        path.join('/tmp/wt', '.lumi', AGENT_STATUS_FILE),
        mockStatus,
        { spaces: 2 }
      );
    });
  });

  describe('readAgentStatus', () => {
    it('returns status when file exists', async () => {
      fsMocks.readJSON.mockResolvedValue(mockStatus);
      const result = await readAgentStatus('/tmp/wt');
      expect(result).toEqual(mockStatus);
    });

    it('returns null when file does not exist', async () => {
      fsMocks.readJSON.mockRejectedValue(new Error('ENOENT'));
      const result = await readAgentStatus('/tmp/wt');
      expect(result).toBeNull();
    });
  });

  describe('resolveAgentStatus', () => {
    it('returns null when no status file', async () => {
      fsMocks.readJSON.mockRejectedValue(new Error('ENOENT'));
      const result = await resolveAgentStatus('/tmp/wt');
      expect(result).toBeNull();
    });

    it('returns running status when session is alive', async () => {
      fsMocks.readJSON.mockResolvedValue({ ...mockStatus });
      tmuxMocks.hasSession.mockReturnValue(true);
      const result = await resolveAgentStatus('/tmp/wt');
      expect(result!.status).toBe('running');
    });

    it('resolves to completed when session died with exit code 0', async () => {
      fsMocks.readJSON.mockResolvedValue({ ...mockStatus });
      tmuxMocks.hasSession.mockReturnValue(false);
      fsMocks.readFile.mockResolvedValue('0\n');
      const result = await resolveAgentStatus('/tmp/wt');
      expect(result!.status).toBe('completed');
      // Should persist the resolved status
      expect(fsMocks.writeJSON).toHaveBeenCalled();
    });

    it('resolves to failed when session died with non-zero exit code', async () => {
      fsMocks.readJSON.mockResolvedValue({ ...mockStatus });
      tmuxMocks.hasSession.mockReturnValue(false);
      fsMocks.readFile.mockResolvedValue('1\n');
      const result = await resolveAgentStatus('/tmp/wt');
      expect(result!.status).toBe('failed');
    });

    it('resolves to failed when no exit code file exists', async () => {
      fsMocks.readJSON.mockResolvedValue({ ...mockStatus });
      tmuxMocks.hasSession.mockReturnValue(false);
      fsMocks.readFile.mockRejectedValue(new Error('ENOENT'));
      const result = await resolveAgentStatus('/tmp/wt');
      expect(result!.status).toBe('failed');
    });

    it('does not re-resolve completed status', async () => {
      const completed = { ...mockStatus, status: 'completed' as const };
      fsMocks.readJSON.mockResolvedValue(completed);
      const result = await resolveAgentStatus('/tmp/wt');
      expect(result!.status).toBe('completed');
      expect(tmuxMocks.hasSession).not.toHaveBeenCalled();
    });
  });

  describe('constants', () => {
    it('exports correct file names', () => {
      expect(AGENT_STATUS_FILE).toBe('agent-status.json');
      expect(AGENT_LOG_FILE).toBe('agent.log');
    });
  });
});

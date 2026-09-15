import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mock vscode module ---
let configChangeCallback: ((e: any) => void) | undefined;

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: vi.fn().mockReturnValue({
      get: vi.fn().mockReturnValue(false),
    }),
    onDidChangeConfiguration: vi.fn((cb: (e: any) => void) => {
      configChangeCallback = cb;
      return { dispose: vi.fn() };
    }),
  },
}));

// --- Mock fs ---
const mockMkdir = vi.fn();
const mockWriteFile = vi.fn();
const mockUnlink = vi.fn();
const mockRename = vi.fn();

vi.mock('fs', () => ({
  promises: {
    mkdir: (...args: any[]) => mockMkdir(...args),
    writeFile: (...args: any[]) => mockWriteFile(...args),
    unlink: (...args: any[]) => mockUnlink(...args),
    rename: (...args: any[]) => mockRename(...args),
  },
}));

import * as vscode from 'vscode';
import * as path from 'path';
import { registerRootAgentMode } from './rootAgentMode';

function setup(options: {
  rootPath?: string | undefined;
  isCloneWorkspace?: boolean;
  enabled?: boolean;
} = {}) {
  const {
    rootPath = '/repo',
    isCloneWorkspace = false,
    enabled = false,
  } = options;

  vi.clearAllMocks();
  configChangeCallback = undefined;

  // Configure the mock return value for rootAgentMode
  (vscode.workspace.getConfiguration as ReturnType<typeof vi.fn>).mockReturnValue({
    get: vi.fn().mockReturnValue(enabled),
  });

  mockMkdir.mockResolvedValue(undefined);
  mockWriteFile.mockResolvedValue(undefined);
  mockUnlink.mockResolvedValue(undefined);
  mockRename.mockResolvedValue(undefined);

  const mockContext = { subscriptions: { push: vi.fn() } } as any;
  registerRootAgentMode(mockContext, rootPath, isCloneWorkspace);
  return { mockContext };
}

describe('registerRootAgentMode', () => {
  describe('initial sync', () => {
    it('creates rule file when enabled + root workspace', async () => {
      setup({ enabled: true, isCloneWorkspace: false });

      // Wait for async operations
      await vi.waitFor(() => {
        expect(mockMkdir).toHaveBeenCalledWith(
          expect.stringContaining('.agents/rules'),
          { recursive: true }
        );
        expect(mockWriteFile).toHaveBeenCalledWith(
          expect.stringContaining('lumi-ops-root-agent.md'),
          expect.stringContaining('Root Agent Mode')
        );
      });
    });

    it('writes correct rule content', async () => {
      setup({ enabled: true, isCloneWorkspace: false });

      await vi.waitFor(() => {
        expect(mockWriteFile).toHaveBeenCalled();
      });

      const content = mockWriteFile.mock.calls[0][1];
      expect(content).toContain('Root Agent Mode');
      expect(content).toContain('DO NOT implement code directly');
      expect(content).toContain('Coordinator Protocol');
    });

    it('deletes rule file when disabled + root workspace', async () => {
      setup({ enabled: false, isCloneWorkspace: false });

      await vi.waitFor(() => {
        expect(mockUnlink).toHaveBeenCalledWith(
          expect.stringContaining('lumi-ops-root-agent.md')
        );
      });
    });

    it('does NOT touch file system when enabled + clone workspace', async () => {
      setup({ enabled: true, isCloneWorkspace: true });

      // Give async ops time to complete (they shouldn't)
      await new Promise(r => setTimeout(r, 50));

      expect(mockMkdir).not.toHaveBeenCalled();
      expect(mockWriteFile).not.toHaveBeenCalled();
      expect(mockUnlink).not.toHaveBeenCalled();
    });

    it('does NOT touch file system when disabled + clone workspace', async () => {
      setup({ enabled: false, isCloneWorkspace: true });

      await new Promise(r => setTimeout(r, 50));

      expect(mockMkdir).not.toHaveBeenCalled();
      expect(mockWriteFile).not.toHaveBeenCalled();
      expect(mockUnlink).not.toHaveBeenCalled();
    });

    it('returns early when rootPath is undefined', async () => {
      // Ensure any prior async ops complete before clearing
      await new Promise(r => setTimeout(r, 50));
      vi.clearAllMocks();
      configChangeCallback = undefined;

      (vscode.workspace.getConfiguration as ReturnType<typeof vi.fn>).mockReturnValue({
        get: vi.fn().mockReturnValue(true),
      });
      mockMkdir.mockResolvedValue(undefined);
      mockWriteFile.mockResolvedValue(undefined);
      mockUnlink.mockResolvedValue(undefined);

      const mockContext = { subscriptions: { push: vi.fn() } } as any;
      registerRootAgentMode(mockContext, undefined, false);

      await new Promise(r => setTimeout(r, 50));

      expect(mockMkdir).not.toHaveBeenCalled();
      expect(mockWriteFile).not.toHaveBeenCalled();
      expect(mockUnlink).not.toHaveBeenCalled();
    });

    it('handles unlink error gracefully (file does not exist)', async () => {
      mockUnlink.mockRejectedValue(new Error('ENOENT'));
      setup({ enabled: false, isCloneWorkspace: false });

      // Should not throw
      await new Promise(r => setTimeout(r, 50));
    });
  });

  describe('atomic rule file write', () => {
    const finalPath = path.join('/repo', '.agents', 'rules', 'lumi-ops-root-agent.md');

    it('writes to a temp file in the same directory, then renames it over the rule file', async () => {
      setup({ enabled: true, isCloneWorkspace: false });

      await vi.waitFor(() => {
        expect(mockRename).toHaveBeenCalledTimes(1);
      });

      const [tmpPath, target] = mockRename.mock.calls[0];
      expect(target).toBe(finalPath);
      expect(tmpPath).not.toBe(finalPath);
      expect(path.dirname(tmpPath)).toBe(path.dirname(finalPath));
      expect(mockWriteFile).toHaveBeenCalledWith(tmpPath, expect.stringContaining('Root Agent Mode'));
      // The rule file itself is never opened for a truncating write, so a concurrent
      // reader sees either the previous or the new content — never an empty file.
      for (const [writtenPath] of mockWriteFile.mock.calls) {
        expect(writtenPath).not.toBe(finalPath);
      }
    });

    it('falls back to an in-place write and removes the temp file when rename fails', async () => {
      setup({ enabled: true, isCloneWorkspace: false });
      mockRename.mockRejectedValue(new Error('EPERM'));

      await vi.waitFor(() => {
        expect(mockWriteFile).toHaveBeenCalledWith(finalPath, expect.stringContaining('Root Agent Mode'));
      });

      const [tmpPath] = mockRename.mock.calls[0];
      expect(mockUnlink).toHaveBeenCalledWith(tmpPath);
    });
  });

  describe('configuration change listener', () => {
    it('registers onDidChangeConfiguration listener', () => {
      setup();
      expect(vscode.workspace.onDidChangeConfiguration).toHaveBeenCalled();
    });

    it('pushes disposable to context subscriptions', () => {
      const { mockContext } = setup();
      expect(mockContext.subscriptions.push).toHaveBeenCalled();
    });

    it('re-syncs when lumi-ops.rootAgentMode changes', async () => {
      setup({ enabled: false, isCloneWorkspace: false });

      // Clear mocks from initial sync
      vi.clearAllMocks();

      // Now simulate enabling the setting
      (vscode.workspace.getConfiguration as ReturnType<typeof vi.fn>).mockReturnValue({
        get: vi.fn().mockReturnValue(true),
      });
      mockMkdir.mockResolvedValue(undefined);
      mockWriteFile.mockResolvedValue(undefined);

      // Fire the config change event
      configChangeCallback?.({
        affectsConfiguration: (key: string) => key === 'lumi-ops.rootAgentMode',
      });

      await vi.waitFor(() => {
        expect(mockWriteFile).toHaveBeenCalledWith(
          expect.stringContaining('lumi-ops-root-agent.md'),
          expect.stringContaining('Root Agent Mode')
        );
      });
    });

    it('does NOT re-sync for unrelated config changes', async () => {
      setup({ enabled: false, isCloneWorkspace: false });
      vi.clearAllMocks();

      configChangeCallback?.({
        affectsConfiguration: (key: string) => key === 'some.other.setting',
      });

      await new Promise(r => setTimeout(r, 50));
      expect(mockWriteFile).not.toHaveBeenCalled();
      expect(mockUnlink).not.toHaveBeenCalled();
    });
  });

  describe('file path construction', () => {
    it('uses correct path: <rootPath>/.agents/rules/lumi-ops-root-agent.md', async () => {
      setup({ rootPath: '/my/project', enabled: true, isCloneWorkspace: false });

      await vi.waitFor(() => {
        expect(mockMkdir).toHaveBeenCalledWith(
          '/my/project/.agents/rules',
          { recursive: true }
        );
        // The content lands at the rule path via the atomic rename
        expect(mockRename).toHaveBeenCalledWith(
          expect.any(String),
          '/my/project/.agents/rules/lumi-ops-root-agent.md'
        );
      });
    });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mock vscode module ---
const mockShowWarningMessage = vi.fn();
const mockShowInformationMessage = vi.fn();
const mockShowErrorMessage = vi.fn();
const mockWithProgress = vi.fn();
const mockRegisterCommand = vi.fn();

vi.mock('vscode', () => ({
  commands: { registerCommand: (...args: any[]) => { mockRegisterCommand(...args); return { dispose: vi.fn() }; } },
  window: {
    showWarningMessage: (...args: any[]) => mockShowWarningMessage(...args),
    showInformationMessage: (...args: any[]) => mockShowInformationMessage(...args),
    showErrorMessage: (...args: any[]) => mockShowErrorMessage(...args),
    withProgress: (...args: any[]) => mockWithProgress(...args),
  },
  ProgressLocation: { Notification: 15 },
}));

// --- Mock @lumi-ops/cli ---
const mockRebase = vi.fn();
const mockGitUtils = vi.fn();

vi.mock('@lumi-ops/cli', () => ({
  GitUtils: vi.fn().mockImplementation((...args: any[]) => {
    mockGitUtils(...args);
    return { rebase: mockRebase };
  }),
  getRepoStorageDir: vi.fn((root: string) => `${root}.worktrees`),
  METADATA_FILE: '.lumi-metadata.json',
}));

// --- Mock fs ---
const mockReadFileSync = vi.fn();
const mockWriteFileSync = vi.fn();

vi.mock('fs', () => ({
  readFileSync: (...args: any[]) => mockReadFileSync(...args),
  writeFileSync: (...args: any[]) => mockWriteFileSync(...args),
}));

import { registerRebaseCommands } from './rebase';

function setup() {
  vi.clearAllMocks();
  const mockStatusBusFire = vi.fn();
  const mockContext = { subscriptions: [] } as any;
  const mockDeps = {
    rootPath: '/repo',
    shadowTreeProvider: { refresh: vi.fn() },
    creatorProvider: { resetForm: vi.fn() },
    promptLibraryProvider: {},
    promptLibraryViewProvider: {},
    missionTemplateProvider: {},
    statusBus: { fire: mockStatusBusFire },
  } as any;

  registerRebaseCommands(mockContext, mockDeps);

  return { mockStatusBusFire };
}

function getHandler(commandId: string): (...args: any[]) => Promise<void> {
  const call = mockRegisterCommand.mock.calls.find(
    (c: any[]) => c[0] === commandId
  );
  return call![1];
}

function makeShadowItem(overrides: Record<string, any> = {}) {
  return {
    clone: {
      branch: 'feat/test',
      dirName: 'feat/test',
      path: '/repo.worktrees/feat/test',
      ...overrides,
    },
  };
}

describe('registerRebaseCommands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers rebase and abortRebase commands', () => {
    setup();
    const registeredCommands = mockRegisterCommand.mock.calls.map((c: any[]) => c[0]);
    expect(registeredCommands).toContain('lumi-ops.rebase');
    expect(registeredCommands).toContain('lumi-ops.abortRebase');
  });

  describe('rebase command', () => {
    it('returns early when rootPath is undefined', async () => {
      vi.clearAllMocks();
      const mockContext = { subscriptions: [] } as any;
      const mockDeps = { rootPath: undefined, statusBus: { fire: vi.fn() } } as any;
      registerRebaseCommands(mockContext, mockDeps);
      const handler = getHandler('lumi-ops.rebase');

      await handler(makeShadowItem());
      expect(mockRebase).not.toHaveBeenCalled();
    });

    it('returns early when item is undefined', async () => {
      setup();
      const handler = getHandler('lumi-ops.rebase');
      await handler(undefined);
      expect(mockRebase).not.toHaveBeenCalled();
    });

    it('shows error when metadata file cannot be read', async () => {
      setup();
      mockReadFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
      const handler = getHandler('lumi-ops.rebase');

      await handler(makeShadowItem());

      expect(mockShowErrorMessage).toHaveBeenCalledWith('Could not read clone metadata.');
      expect(mockRebase).not.toHaveBeenCalled();
    });

    it('shows warning when no baseBranch in metadata', async () => {
      setup();
      mockReadFileSync.mockReturnValue(JSON.stringify({
        'feat/test': { /* no baseBranch */ },
      }));
      const handler = getHandler('lumi-ops.rebase');

      await handler(makeShadowItem());

      expect(mockShowWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('No base branch recorded')
      );
      expect(mockRebase).not.toHaveBeenCalled();
    });

    it('calls git.rebase with baseBranch on success', async () => {
      const { mockStatusBusFire } = setup();
      mockReadFileSync.mockReturnValue(JSON.stringify({
        'feat/test': { baseBranch: 'main', needsRebase: true },
      }));
      mockRebase.mockResolvedValue(undefined);
      mockWithProgress.mockImplementation(async (_opts: any, cb: Function) => cb());

      const handler = getHandler('lumi-ops.rebase');
      await handler(makeShadowItem());

      expect(mockRebase).toHaveBeenCalledWith('main');
    });

    it('updates metadata to needsRebase=false on success', async () => {
      const { mockStatusBusFire } = setup();
      const metadata = { 'feat/test': { baseBranch: 'main', needsRebase: true } };
      mockReadFileSync.mockReturnValue(JSON.stringify(metadata));
      mockRebase.mockResolvedValue(undefined);
      mockWithProgress.mockImplementation(async (_opts: any, cb: Function) => cb());

      const handler = getHandler('lumi-ops.rebase');
      await handler(makeShadowItem());

      expect(mockWriteFileSync).toHaveBeenCalledWith(
        expect.stringContaining('.lumi-metadata.json'),
        expect.stringContaining('"needsRebase": false')
      );
    });

    it('fires statusBus with * on success', async () => {
      const { mockStatusBusFire } = setup();
      mockReadFileSync.mockReturnValue(JSON.stringify({
        'feat/test': { baseBranch: 'main', needsRebase: true },
      }));
      mockRebase.mockResolvedValue(undefined);
      mockWithProgress.mockImplementation(async (_opts: any, cb: Function) => cb());

      const handler = getHandler('lumi-ops.rebase');
      await handler(makeShadowItem());

      expect(mockStatusBusFire).toHaveBeenCalledWith('*');
    });

    it('shows success message on successful rebase', async () => {
      setup();
      mockReadFileSync.mockReturnValue(JSON.stringify({
        'feat/test': { baseBranch: 'main', needsRebase: true },
      }));
      mockRebase.mockResolvedValue(undefined);
      mockWithProgress.mockImplementation(async (_opts: any, cb: Function) => cb());

      const handler = getHandler('lumi-ops.rebase');
      await handler(makeShadowItem());

      expect(mockShowInformationMessage).toHaveBeenCalledWith(
        expect.stringContaining('Rebased')
      );
    });

    it('shows warning with conflict instructions on rebase failure', async () => {
      const { mockStatusBusFire } = setup();
      mockReadFileSync.mockReturnValue(JSON.stringify({
        'feat/test': { baseBranch: 'main', needsRebase: true },
      }));
      mockRebase.mockRejectedValue(new Error('rebase conflict'));
      mockWithProgress.mockImplementation(async (_opts: any, cb: Function) => cb());

      const handler = getHandler('lumi-ops.rebase');
      await handler(makeShadowItem());

      expect(mockShowWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('conflicts')
      );
      // StatusBus should still be fired to refresh sidebar
      expect(mockStatusBusFire).toHaveBeenCalledWith('*');
    });

    it('uses clone path (not root path) for GitUtils', async () => {
      setup();
      mockReadFileSync.mockReturnValue(JSON.stringify({
        'feat/test': { baseBranch: 'main' },
      }));
      mockRebase.mockResolvedValue(undefined);
      mockWithProgress.mockImplementation(async (_opts: any, cb: Function) => cb());

      const handler = getHandler('lumi-ops.rebase');
      await handler(makeShadowItem({ path: '/repo.worktrees/feat/test' }));

      expect(mockGitUtils).toHaveBeenCalledWith('/repo.worktrees/feat/test');
    });
  });

  describe('abortRebase command', () => {
    it('calls git.rebase with --abort', async () => {
      const { mockStatusBusFire } = setup();
      mockRebase.mockResolvedValue(undefined);

      const handler = getHandler('lumi-ops.abortRebase');
      await handler(makeShadowItem());

      expect(mockRebase).toHaveBeenCalledWith('--abort');
    });

    it('fires statusBus after abort', async () => {
      const { mockStatusBusFire } = setup();
      mockRebase.mockResolvedValue(undefined);

      const handler = getHandler('lumi-ops.abortRebase');
      await handler(makeShadowItem());

      expect(mockStatusBusFire).toHaveBeenCalledWith('*');
    });

    it('shows success message after abort', async () => {
      setup();
      mockRebase.mockResolvedValue(undefined);

      const handler = getHandler('lumi-ops.abortRebase');
      await handler(makeShadowItem());

      expect(mockShowInformationMessage).toHaveBeenCalledWith(
        expect.stringContaining('Rebase aborted')
      );
    });

    it('shows error message when abort fails', async () => {
      setup();
      mockRebase.mockRejectedValue(new Error('not in a rebase'));

      const handler = getHandler('lumi-ops.abortRebase');
      await handler(makeShadowItem());

      expect(mockShowErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('not in a rebase')
      );
    });

    it('returns early when item is undefined', async () => {
      setup();
      const handler = getHandler('lumi-ops.abortRebase');
      await handler(undefined);
      expect(mockRebase).not.toHaveBeenCalled();
    });
  });
});

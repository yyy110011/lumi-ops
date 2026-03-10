import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mock vscode module ---
const mockShowQuickPick = vi.fn();
const mockShowInputBox = vi.fn();
const mockShowWarningMessage = vi.fn();
const mockShowInformationMessage = vi.fn();
const mockShowErrorMessage = vi.fn();
const mockWithProgress = vi.fn();
const mockRegisterCommand = vi.fn();

vi.mock('vscode', () => ({
  commands: { registerCommand: (...args: any[]) => { mockRegisterCommand(...args); return { dispose: vi.fn() }; } },
  window: {
    showQuickPick: (...args: any[]) => mockShowQuickPick(...args),
    showInputBox: (...args: any[]) => mockShowInputBox(...args),
    showWarningMessage: (...args: any[]) => mockShowWarningMessage(...args),
    showInformationMessage: (...args: any[]) => mockShowInformationMessage(...args),
    showErrorMessage: (...args: any[]) => mockShowErrorMessage(...args),
    withProgress: (...args: any[]) => mockWithProgress(...args),
  },
  ProgressLocation: { Notification: 15 },
  QuickPickItemKind: { Separator: -1 },
}));

// --- Mock @lumi-ops/cli ---
const mockKill = vi.fn();
const mockMerge = vi.fn();
const mockGetCurrentBranch = vi.fn();
const mockListWorktrees = vi.fn();
const mockListBranches = vi.fn();
const mockAddWorktreeExisting = vi.fn();
const mockRemoveWorktree = vi.fn();

vi.mock('@lumi-ops/cli', () => ({
  kill: (...args: any[]) => mockKill(...args),
  merge: (...args: any[]) => mockMerge(...args),
  GitUtils: vi.fn().mockImplementation(() => ({
    getCurrentBranch: mockGetCurrentBranch,
    listWorktrees: mockListWorktrees,
    listBranches: mockListBranches,
    addWorktreeExisting: mockAddWorktreeExisting,
    removeWorktree: mockRemoveWorktree,
  })),
  getClonesDir: vi.fn((root: string) => `${root}.worktrees`),
  getRepoStorageDir: vi.fn((root: string) => `${root}.worktrees`),
  METADATA_FILE: '.lumi-metadata.json',
}));

// --- Mock fs ---
const mockReadFileSync = vi.fn();
vi.mock('fs', () => ({
  readFileSync: (...args: any[]) => mockReadFileSync(...args),
  default: { readFileSync: (...args: any[]) => mockReadFileSync(...args) },
}));

import { registerMergeCommands } from './merge';

// Helper to register and extract the command handler
function getCommandHandler(): (...args: any[]) => Promise<void> {
  const mockContext = { subscriptions: [] } as any;
  const mockDeps = {
    rootPath: '/repo',
    shadowTreeProvider: { refresh: vi.fn() },
    creatorProvider: { resetForm: vi.fn() },
    promptLibraryProvider: {},
    promptLibraryViewProvider: {},
    missionTemplateProvider: {},
    statusBus: { fire: vi.fn() },
  } as any;

  registerMergeCommands(mockContext, mockDeps);

  // Find the 'lumi-ops.merge' handler
  const call = mockRegisterCommand.mock.calls.find(
    (c: any[]) => c[0] === 'lumi-ops.merge'
  );
  return call![1];
}

describe('registerMergeCommands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCurrentBranch.mockResolvedValue('main');
    mockListWorktrees.mockResolvedValue([]);
    mockListBranches.mockResolvedValue(['main', 'develop', 'feat/other']);
    mockReadFileSync.mockReturnValue(JSON.stringify({
      'feat/test': { baseBranch: 'main' },
    }));
  });

  it('registers lumi-ops.merge command', () => {
    const mockContext = { subscriptions: [] } as any;
    const mockDeps = { rootPath: '/repo', shadowTreeProvider: { refresh: vi.fn() } } as any;
    const disposables = registerMergeCommands(mockContext, mockDeps);
    expect(disposables).toHaveLength(1);
    expect(mockRegisterCommand).toHaveBeenCalledWith('lumi-ops.merge', expect.any(Function));
  });

  it('returns early when item is undefined', async () => {
    const handler = getCommandHandler();
    await handler(undefined);
    expect(mockShowQuickPick).not.toHaveBeenCalled();
  });

  it('returns early when rootPath is undefined', async () => {
    const mockContext = { subscriptions: [] } as any;
    const mockDeps = { rootPath: undefined, shadowTreeProvider: { refresh: vi.fn() } } as any;
    registerMergeCommands(mockContext, mockDeps);
    const call = mockRegisterCommand.mock.calls.find((c: any[]) => c[0] === 'lumi-ops.merge');
    await call![1]({ clone: { currentBranch: 'feat/test', dirName: 'feat/test' } });
    expect(mockShowQuickPick).not.toHaveBeenCalled();
  });

  describe('QuickPick item construction', () => {
    it('pins baseBranch as recommended at top', async () => {
      const handler = getCommandHandler();
      mockShowQuickPick.mockResolvedValue(null); // user cancels

      await handler({ clone: { currentBranch: 'feat/test', dirName: 'feat/test' } });

      const items = mockShowQuickPick.mock.calls[0][0];
      expect(items[0].label).toBe('main');
      expect(items[0].description).toContain('recommended');
      expect(items[0].targetBranch).toBe('main');
    });

    it('pins currentBranch with ← current label when different from base', async () => {
      mockGetCurrentBranch.mockResolvedValue('develop');
      const handler = getCommandHandler();
      mockShowQuickPick.mockResolvedValue(null);

      await handler({ clone: { currentBranch: 'feat/test', dirName: 'feat/test' } });

      const items = mockShowQuickPick.mock.calls[0][0];
      // baseBranch 'main' is first, currentBranch 'develop' is second
      expect(items[0].label).toBe('main');
      expect(items[1].label).toBe('develop');
      expect(items[1].description).toBe('← current');
    });

    it('does NOT pin currentBranch when it equals baseBranch', async () => {
      // currentBranch = 'main', baseBranch = 'main' → only one pinned item
      mockGetCurrentBranch.mockResolvedValue('main');
      const handler = getCommandHandler();
      mockShowQuickPick.mockResolvedValue(null);

      await handler({ clone: { currentBranch: 'feat/test', dirName: 'feat/test' } });

      const items = mockShowQuickPick.mock.calls[0][0];
      const pinnedLabels = items
        .filter((i: any) => i.description?.includes('recommended') || i.description?.includes('current'))
        .map((i: any) => i.label);
      expect(pinnedLabels).toEqual(['main']); // only one pinned
    });

    it('excludes source branch from QuickPick items', async () => {
      const handler = getCommandHandler();
      mockShowQuickPick.mockResolvedValue(null);

      await handler({ clone: { currentBranch: 'feat/test', dirName: 'feat/test' } });

      const items = mockShowQuickPick.mock.calls[0][0];
      const labels = items.map((i: any) => i.label).filter(Boolean);
      expect(labels).not.toContain('feat/test');
    });

    it('shows worktree warning for branches in other worktrees', async () => {
      mockListWorktrees.mockResolvedValue([
        'worktree /repo.worktrees/develop\nbranch refs/heads/develop',
      ]);
      mockGetCurrentBranch.mockResolvedValue('main');
      const handler = getCommandHandler();
      mockShowQuickPick.mockResolvedValue(null);

      await handler({ clone: { currentBranch: 'feat/test', dirName: 'feat/test' } });

      const items = mockShowQuickPick.mock.calls[0][0];
      const developItem = items.find((i: any) => i.label === 'develop');
      expect(developItem?.description).toContain('⚠️ worktree');
    });

    it('does NOT show worktree warning for currentBranch', async () => {
      // currentBranch is always in a worktree (the root), but we don't warn about it
      mockListWorktrees.mockResolvedValue([
        'worktree /repo\nbranch refs/heads/main',
      ]);
      mockGetCurrentBranch.mockResolvedValue('main');
      const handler = getCommandHandler();
      mockShowQuickPick.mockResolvedValue(null);

      await handler({ clone: { currentBranch: 'feat/test', dirName: 'feat/test' } });

      const items = mockShowQuickPick.mock.calls[0][0];
      const mainItem = items.find((i: any) => i.label === 'main');
      // Main is baseBranch+currentBranch → pinned as recommended, no worktree warning
      expect(mainItem?.description).not.toContain('⚠️ worktree');
    });

    it('adds separator between pinned and other branches', async () => {
      const handler = getCommandHandler();
      mockShowQuickPick.mockResolvedValue(null);

      await handler({ clone: { currentBranch: 'feat/test', dirName: 'feat/test' } });

      const items = mockShowQuickPick.mock.calls[0][0];
      const separators = items.filter((i: any) => i.kind === -1);
      expect(separators.length).toBe(1);
    });

    it('does NOT add separator when there are no other branches', async () => {
      mockListBranches.mockResolvedValue(['main', 'feat/test']); // only main remains after filtering source
      const handler = getCommandHandler();
      mockShowQuickPick.mockResolvedValue(null);

      await handler({ clone: { currentBranch: 'feat/test', dirName: 'feat/test' } });

      const items = mockShowQuickPick.mock.calls[0][0];
      const separators = items.filter((i: any) => i.kind === -1);
      expect(separators.length).toBe(0);
    });

    it('handles missing metadata gracefully (no baseBranch pinned)', async () => {
      mockReadFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
      const handler = getCommandHandler();
      mockShowQuickPick.mockResolvedValue(null);

      await handler({ clone: { currentBranch: 'feat/test', dirName: 'feat/test' } });

      const items = mockShowQuickPick.mock.calls[0][0];
      const recommended = items.filter((i: any) => i.description?.includes('recommended'));
      expect(recommended).toHaveLength(0);
    });
  });

  describe('commit message', () => {
    it('provides default commit message with branch name', async () => {
      const handler = getCommandHandler();
      mockShowQuickPick.mockResolvedValue({ label: 'main', targetBranch: 'main' });
      mockShowInputBox.mockResolvedValue(undefined); // user cancels

      await handler({ clone: { currentBranch: 'feat/test', dirName: 'feat/test' } });

      const inputBoxOpts = mockShowInputBox.mock.calls[0][0];
      expect(inputBoxOpts.value).toBe('feat: merged feat/test (shadow clone)');
      expect(inputBoxOpts.prompt).toContain('feat/test');
      expect(inputBoxOpts.prompt).toContain('main');
    });
  });

  describe('merge CWD resolution', () => {
    it('uses rootPath when target is current branch', async () => {
      mockGetCurrentBranch.mockResolvedValue('main');
      const handler = getCommandHandler();
      mockShowQuickPick.mockResolvedValue({ label: 'main', targetBranch: 'main' });
      mockShowInputBox.mockResolvedValue('test commit');
      mockWithProgress.mockImplementation(async (_opts: any, cb: Function) => cb());
      mockMerge.mockResolvedValue(undefined);
      mockShowInformationMessage.mockResolvedValue('No');

      await handler({ clone: { currentBranch: 'feat/test', dirName: 'feat/test' } });

      expect(mockMerge).toHaveBeenCalledWith('feat/test', expect.objectContaining({
        cwd: '/repo',
      }));
      expect(mockAddWorktreeExisting).not.toHaveBeenCalled();
    });

    it('uses existing worktree path when target is in a worktree', async () => {
      mockGetCurrentBranch.mockResolvedValue('main');
      mockListWorktrees.mockResolvedValue([
        'worktree /repo.worktrees/develop\nbranch refs/heads/develop',
      ]);
      const handler = getCommandHandler();
      mockShowQuickPick.mockResolvedValue({ label: 'develop', targetBranch: 'develop' });
      mockShowInputBox.mockResolvedValue('test commit');
      // Worktree warning → user confirms
      mockShowWarningMessage.mockResolvedValue('Merge Anyway');
      mockWithProgress.mockImplementation(async (_opts: any, cb: Function) => cb());
      mockMerge.mockResolvedValue(undefined);
      mockShowInformationMessage.mockResolvedValue('No');

      await handler({ clone: { currentBranch: 'feat/test', dirName: 'feat/test' } });

      expect(mockMerge).toHaveBeenCalledWith('feat/test', expect.objectContaining({
        cwd: '/repo.worktrees/develop',
      }));
    });

    it('creates temp worktree when target is not in any worktree', async () => {
      mockGetCurrentBranch.mockResolvedValue('main');
      const handler = getCommandHandler();
      mockShowQuickPick.mockResolvedValue({ label: 'develop', targetBranch: 'develop' });
      mockShowInputBox.mockResolvedValue('test commit');
      mockAddWorktreeExisting.mockResolvedValue(undefined);
      mockWithProgress.mockImplementation(async (_opts: any, cb: Function) => cb());
      mockMerge.mockResolvedValue(undefined);
      mockRemoveWorktree.mockResolvedValue(undefined);
      mockShowInformationMessage.mockResolvedValue('No');

      await handler({ clone: { currentBranch: 'feat/test', dirName: 'feat/test' } });

      expect(mockAddWorktreeExisting).toHaveBeenCalledWith(
        '/repo.worktrees/develop',
        'develop'
      );
      expect(mockMerge).toHaveBeenCalledWith('feat/test', expect.objectContaining({
        cwd: '/repo.worktrees/develop',
      }));
      // Temp worktree cleaned up after merge
      expect(mockRemoveWorktree).toHaveBeenCalledWith('/repo.worktrees/develop');
    });
  });

  describe('conflict handling', () => {
    it('shows warning (not error) on CONFLICT', async () => {
      const handler = getCommandHandler();
      mockShowQuickPick.mockResolvedValue({ label: 'main', targetBranch: 'main' });
      mockShowInputBox.mockResolvedValue('test commit');
      mockWithProgress.mockImplementation(async (_opts: any, cb: Function) => cb());
      mockMerge.mockRejectedValue(new Error('CONFLICT'));

      await handler({ clone: { currentBranch: 'feat/test', dirName: 'feat/test' } });

      expect(mockShowWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('Merge conflict detected')
      );
      expect(mockShowErrorMessage).not.toHaveBeenCalled();
    });

    it('shows error message for non-CONFLICT errors', async () => {
      const handler = getCommandHandler();
      mockShowQuickPick.mockResolvedValue({ label: 'main', targetBranch: 'main' });
      mockShowInputBox.mockResolvedValue('test commit');
      mockWithProgress.mockImplementation(async (_opts: any, cb: Function) => cb());
      mockMerge.mockRejectedValue(new Error('Something went wrong'));

      await handler({ clone: { currentBranch: 'feat/test', dirName: 'feat/test' } });

      expect(mockShowErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('Something went wrong')
      );
    });
  });

  describe('post-merge cleanup', () => {
    it('kills clone when user selects "Yes, Delete It"', async () => {
      const mockContext = { subscriptions: [] } as any;
      const mockRefresh = vi.fn();
      const mockDeps = {
        rootPath: '/repo',
        shadowTreeProvider: { refresh: mockRefresh },
        creatorProvider: { resetForm: vi.fn() },
        promptLibraryProvider: {},
        promptLibraryViewProvider: {},
        missionTemplateProvider: {},
        statusBus: { fire: vi.fn() },
      } as any;

      registerMergeCommands(mockContext, mockDeps);
      const call = mockRegisterCommand.mock.calls.find((c: any[]) => c[0] === 'lumi-ops.merge');
      const handler = call![1];

      mockShowQuickPick.mockResolvedValue({ label: 'main', targetBranch: 'main' });
      mockShowInputBox.mockResolvedValue('test commit');
      mockWithProgress.mockImplementation(async (_opts: any, cb: Function) => cb());
      mockMerge.mockResolvedValue(undefined);
      mockKill.mockResolvedValue(undefined);
      mockShowInformationMessage.mockResolvedValue('Yes, Delete It');

      await handler({ clone: { currentBranch: 'feat/test', dirName: 'feat/test' } });

      expect(mockKill).toHaveBeenCalledWith('feat/test', { root: '/repo' });
      expect(mockRefresh).toHaveBeenCalled();
    });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mock vscode module ---
const mockShowInputBox = vi.fn();
const mockShowInformationMessage = vi.fn();
const mockShowErrorMessage = vi.fn();
const mockWithProgress = vi.fn();
const mockRegisterCommand = vi.fn();
const mockGetConfiguration = vi.fn();

vi.mock('vscode', () => ({
  commands: { registerCommand: (...args: any[]) => { mockRegisterCommand(...args); return { dispose: vi.fn() }; } },
  window: {
    showInputBox: (...args: any[]) => mockShowInputBox(...args),
    showInformationMessage: (...args: any[]) => mockShowInformationMessage(...args),
    showErrorMessage: (...args: any[]) => mockShowErrorMessage(...args),
    withProgress: (...args: any[]) => mockWithProgress(...args),
  },
  workspace: {
    getConfiguration: (...args: any[]) => mockGetConfiguration(...args),
  },
  ProgressLocation: { Notification: 15 },
}));

// --- Mock @lumi-ops/cli ---
const mockSpawn = vi.fn();
const mockBranchExists = vi.fn();
const mockListRemoteBranches = vi.fn();
const mockFetchBranch = vi.fn();

vi.mock('@lumi-ops/cli', () => ({
  spawn: (...args: any[]) => mockSpawn(...args),
  GitUtils: vi.fn().mockImplementation(() => ({
    branchExists: mockBranchExists,
    listRemoteBranches: mockListRemoteBranches,
    fetchBranch: mockFetchBranch,
  })),
}));

import { registerSpawnCommands } from './spawn';

function setup(rootPath: string | undefined = '/repo') {
  vi.clearAllMocks();
  const mockRefresh = vi.fn();
  const mockResetForm = vi.fn();
  const mockGetActiveTemplate = vi.fn();
  const mockContext = { subscriptions: [] } as any;
  const mockDeps = {
    rootPath,
    allRoots: rootPath ? [rootPath] : [],
    shadowTreeProvider: { refresh: mockRefresh },
    creatorProvider: { resetForm: mockResetForm },
    promptLibraryProvider: {},
    promptLibraryViewProvider: {},
    missionTemplateProvider: { getActiveTemplate: mockGetActiveTemplate },
    statusBus: { fire: vi.fn() },
  } as any;

  registerSpawnCommands(mockContext, mockDeps);

  return { mockRefresh, mockResetForm, mockGetActiveTemplate };
}

function getSpawnHandler(): (...args: any[]) => Promise<void> {
  const call = mockRegisterCommand.mock.calls.find(
    (c: any[]) => c[0] === 'lumi-ops.spawn'
  );
  return call![1];
}

describe('registerSpawnCommands', () => {
  beforeEach(() => {
    mockBranchExists.mockResolvedValue(true);
    mockListRemoteBranches.mockResolvedValue([]);
    mockGetConfiguration.mockReturnValue({ get: vi.fn().mockReturnValue('') });
  });

  it('registers both refresh and spawn commands', () => {
    setup();
    const registeredCommands = mockRegisterCommand.mock.calls.map((c: any[]) => c[0]);
    expect(registeredCommands).toContain('lumi-ops.refresh');
    expect(registeredCommands).toContain('lumi-ops.spawn');
  });

  it('shows error when no rootPath', async () => {
    vi.clearAllMocks();
    mockBranchExists.mockResolvedValue(true);
    mockListRemoteBranches.mockResolvedValue([]);
    mockGetConfiguration.mockReturnValue({ get: vi.fn().mockReturnValue('') });

    const mockContext = { subscriptions: [] } as any;
    const mockDeps = {
      rootPath: undefined,
      allRoots: [],
      shadowTreeProvider: { refresh: vi.fn() },
      creatorProvider: { resetForm: vi.fn() },
      promptLibraryProvider: {},
      promptLibraryViewProvider: {},
      missionTemplateProvider: { getActiveTemplate: vi.fn() },
      statusBus: { fire: vi.fn() },
    } as any;

    registerSpawnCommands(mockContext, mockDeps);
    const call = mockRegisterCommand.mock.calls.find((c: any[]) => c[0] === 'lumi-ops.spawn');
    const handler = call![1];

    await handler({ branch: 'feat/test', description: 'test' });

    expect(mockShowErrorMessage).toHaveBeenCalledWith('No workspace folder open.');
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('prompts for branch name when args not provided', async () => {
    setup();
    mockShowInputBox.mockResolvedValue(undefined); // user cancels
    const handler = getSpawnHandler();

    await handler();

    expect(mockShowInputBox).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.stringContaining('name for the new feature branch'),
    }));
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('prompts for description when args not provided but branchName given', async () => {
    setup();
    mockShowInputBox
      .mockResolvedValueOnce('feat/new') // branch
      .mockResolvedValueOnce('my task description'); // description
    const handler = getSpawnHandler();

    // Mock the withProgress to execute the callback
    mockWithProgress.mockImplementation(async (_opts: any, cb: Function) => {
      await cb({ report: vi.fn() });
    });
    const { mockGetActiveTemplate } = setup();
    mockGetActiveTemplate.mockResolvedValue({ name: 'default' });
    mockGetConfiguration.mockReturnValue({ get: vi.fn().mockReturnValue('') });
    mockBranchExists.mockResolvedValue(true);
    mockSpawn.mockResolvedValue(undefined);

    const handler2 = getSpawnHandler();
    mockShowInputBox
      .mockResolvedValueOnce('feat/new')
      .mockResolvedValueOnce('my description');
    mockWithProgress.mockImplementation(async (_opts: any, cb: Function) => {
      await cb({ report: vi.fn() });
    });

    await handler2();

    // Two inputBox calls: branch then description
    expect(mockShowInputBox).toHaveBeenCalledTimes(2);
  });

  describe('remote branch fetch', () => {
    it('fetches remote branch when local does not exist', async () => {
      const { mockGetActiveTemplate } = setup();
      mockGetActiveTemplate.mockResolvedValue({ name: 'default' });
      mockGetConfiguration.mockReturnValue({ get: vi.fn().mockReturnValue('') });
      mockBranchExists.mockResolvedValue(false);
      mockListRemoteBranches.mockResolvedValue(['origin/feat/test']);
      mockFetchBranch.mockResolvedValue(undefined);
      mockSpawn.mockResolvedValue(undefined);
      mockWithProgress.mockImplementation(async (_opts: any, cb: Function) => {
        await cb({ report: vi.fn() });
      });

      const handler = getSpawnHandler();
      await handler({ branch: 'feat/test', description: 'test' });

      expect(mockFetchBranch).toHaveBeenCalledWith('feat/test', 'origin');
    });

    it('extracts remote name correctly from remote branch ref', async () => {
      const { mockGetActiveTemplate } = setup();
      mockGetActiveTemplate.mockResolvedValue({ name: 'default' });
      mockGetConfiguration.mockReturnValue({ get: vi.fn().mockReturnValue('') });
      mockBranchExists.mockResolvedValue(false);
      mockListRemoteBranches.mockResolvedValue(['upstream/feat/test']);
      mockFetchBranch.mockResolvedValue(undefined);
      mockSpawn.mockResolvedValue(undefined);
      mockWithProgress.mockImplementation(async (_opts: any, cb: Function) => {
        await cb({ report: vi.fn() });
      });

      const handler = getSpawnHandler();
      await handler({ branch: 'feat/test', description: 'test' });

      expect(mockFetchBranch).toHaveBeenCalledWith('feat/test', 'upstream');
    });

    it('does NOT fetch when branch exists locally', async () => {
      const { mockGetActiveTemplate } = setup();
      mockGetActiveTemplate.mockResolvedValue({ name: 'default' });
      mockGetConfiguration.mockReturnValue({ get: vi.fn().mockReturnValue('') });
      mockBranchExists.mockResolvedValue(true);
      mockSpawn.mockResolvedValue(undefined);
      mockWithProgress.mockImplementation(async (_opts: any, cb: Function) => {
        await cb({ report: vi.fn() });
      });

      const handler = getSpawnHandler();
      await handler({ branch: 'feat/test', description: 'test' });

      expect(mockFetchBranch).not.toHaveBeenCalled();
    });

    it('fetches parentBranch from remote when it does not exist locally', async () => {
      const { mockGetActiveTemplate } = setup();
      mockGetActiveTemplate.mockResolvedValue({ name: 'default' });
      mockGetConfiguration.mockReturnValue({ get: vi.fn().mockReturnValue('') });
      mockBranchExists
        .mockResolvedValueOnce(true)  // branchName exists
        .mockResolvedValueOnce(false); // parentBranch doesn't exist
      mockListRemoteBranches.mockResolvedValue(['origin/develop']);
      mockFetchBranch.mockResolvedValue(undefined);
      mockSpawn.mockResolvedValue(undefined);
      mockWithProgress.mockImplementation(async (_opts: any, cb: Function) => {
        await cb({ report: vi.fn() });
      });

      const handler = getSpawnHandler();
      await handler({ branch: 'feat/test', description: 'test', parentBranch: 'develop' });

      expect(mockFetchBranch).toHaveBeenCalledWith('develop', 'origin');
    });
  });

  describe('copyOnSpawn config parsing', () => {
    it('splits newline-separated paths, trims, and filters empty', async () => {
      const { mockGetActiveTemplate } = setup();
      mockGetActiveTemplate.mockResolvedValue({ name: 'default' });
      mockGetConfiguration.mockReturnValue({
        get: vi.fn().mockReturnValue('.env\n  .vscode  \n\nnode_modules'),
      });
      mockBranchExists.mockResolvedValue(true);
      mockSpawn.mockResolvedValue(undefined);
      mockWithProgress.mockImplementation(async (_opts: any, cb: Function) => {
        await cb({ report: vi.fn() });
      });

      const handler = getSpawnHandler();
      await handler({ branch: 'feat/test', description: 'test' });

      expect(mockSpawn).toHaveBeenCalledWith('feat/test', expect.objectContaining({
        copyFolders: ['.env', '.vscode', 'node_modules'],
      }));
    });

    it('passes empty array when config is empty string', async () => {
      const { mockGetActiveTemplate } = setup();
      mockGetActiveTemplate.mockResolvedValue({ name: 'default' });
      mockGetConfiguration.mockReturnValue({ get: vi.fn().mockReturnValue('') });
      mockBranchExists.mockResolvedValue(true);
      mockSpawn.mockResolvedValue(undefined);
      mockWithProgress.mockImplementation(async (_opts: any, cb: Function) => {
        await cb({ report: vi.fn() });
      });

      const handler = getSpawnHandler();
      await handler({ branch: 'feat/test', description: 'test' });

      expect(mockSpawn).toHaveBeenCalledWith('feat/test', expect.objectContaining({
        copyFolders: [],
      }));
    });
  });

  describe('mission template', () => {
    it('passes undefined missionTemplate when active template is default', async () => {
      const { mockGetActiveTemplate } = setup();
      mockGetActiveTemplate.mockResolvedValue({ name: 'default' });
      mockGetConfiguration.mockReturnValue({ get: vi.fn().mockReturnValue('') });
      mockBranchExists.mockResolvedValue(true);
      mockSpawn.mockResolvedValue(undefined);
      mockWithProgress.mockImplementation(async (_opts: any, cb: Function) => {
        await cb({ report: vi.fn() });
      });

      const handler = getSpawnHandler();
      await handler({ branch: 'feat/test', description: 'test' });

      expect(mockSpawn).toHaveBeenCalledWith('feat/test', expect.objectContaining({
        missionTemplate: undefined,
      }));
    });

    it('passes missionTemplate when active template is non-default', async () => {
      const { mockGetActiveTemplate } = setup();
      mockGetActiveTemplate.mockResolvedValue({
        name: 'custom',
        task: '## Custom Task',
        rules: '## Custom Rules',
        instructions: '## Custom Instructions',
      });
      mockGetConfiguration.mockReturnValue({ get: vi.fn().mockReturnValue('') });
      mockBranchExists.mockResolvedValue(true);
      mockSpawn.mockResolvedValue(undefined);
      mockWithProgress.mockImplementation(async (_opts: any, cb: Function) => {
        await cb({ report: vi.fn() });
      });

      const handler = getSpawnHandler();
      await handler({ branch: 'feat/test', description: 'test' });

      expect(mockSpawn).toHaveBeenCalledWith('feat/test', expect.objectContaining({
        missionTemplate: {
          task: '## Custom Task',
          rules: '## Custom Rules',
          instructions: '## Custom Instructions',
        },
      }));
    });

    it('falls back to undefined when getActiveTemplate throws', async () => {
      const { mockGetActiveTemplate } = setup();
      mockGetActiveTemplate.mockRejectedValue(new Error('file not found'));
      mockGetConfiguration.mockReturnValue({ get: vi.fn().mockReturnValue('') });
      mockBranchExists.mockResolvedValue(true);
      mockSpawn.mockResolvedValue(undefined);
      mockWithProgress.mockImplementation(async (_opts: any, cb: Function) => {
        await cb({ report: vi.fn() });
      });

      const handler = getSpawnHandler();
      await handler({ branch: 'feat/test', description: 'test' });

      expect(mockSpawn).toHaveBeenCalledWith('feat/test', expect.objectContaining({
        missionTemplate: undefined,
      }));
    });
  });

  describe('error handling', () => {
    it('shows error message when spawn fails', async () => {
      const { mockGetActiveTemplate } = setup();
      mockGetActiveTemplate.mockResolvedValue({ name: 'default' });
      mockGetConfiguration.mockReturnValue({ get: vi.fn().mockReturnValue('') });
      mockBranchExists.mockResolvedValue(true);
      mockSpawn.mockRejectedValue(new Error('branch already exists'));
      mockWithProgress.mockImplementation(async (_opts: any, cb: Function) => {
        await cb({ report: vi.fn() });
      });

      const handler = getSpawnHandler();
      await handler({ branch: 'feat/test', description: 'test' });

      expect(mockShowErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('branch already exists')
      );
    });
  });

  describe('multi-root: repoRoot from webview', () => {
    it('uses repoRoot from args when provided', async () => {
      setup();
      mockGetConfiguration.mockReturnValue({ get: vi.fn().mockReturnValue('') });
      mockBranchExists.mockResolvedValue(true);
      mockSpawn.mockResolvedValue(undefined);
      mockWithProgress.mockImplementation(async (_opts: any, cb: Function) => {
        await cb({ report: vi.fn() });
      });

      const handler = getSpawnHandler();
      await handler({ branch: 'feat/test', description: 'test', repoRoot: '/other-repo' });

      // spawn should be called with the repoRoot, not the default rootPath
      expect(mockSpawn).toHaveBeenCalledWith(
        'feat/test',
        expect.objectContaining({ root: '/other-repo' }),
      );
    });

    it('falls back to rootPath when repoRoot is not provided', async () => {
      setup('/my-repo');
      mockGetConfiguration.mockReturnValue({ get: vi.fn().mockReturnValue('') });
      mockBranchExists.mockResolvedValue(true);
      mockSpawn.mockResolvedValue(undefined);
      mockWithProgress.mockImplementation(async (_opts: any, cb: Function) => {
        await cb({ report: vi.fn() });
      });

      const handler = getSpawnHandler();
      await handler({ branch: 'feat/test', description: 'test' });

      expect(mockSpawn).toHaveBeenCalledWith(
        'feat/test',
        expect.objectContaining({ root: '/my-repo' }),
      );
    });
  });
});

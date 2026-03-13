import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Mocks — use vi.hoisted to ensure variables are available when vi.mock factories run
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const gitUtils = {
    listWorktrees: vi.fn(),
    branchExists: vi.fn(),
    addWorktreeExisting: vi.fn(),
    mergeSquash: vi.fn(),
    commit: vi.fn(),
    removeWorktree: vi.fn(),
    pruneWorktrees: vi.fn(),
  };
  // Persistent storage for tool registrations — NOT cleared by vi.clearAllMocks
  const toolRegistry: Record<string, (...args: any[]) => Promise<any>> = {};
  const toolFn = vi.fn((...args: any[]) => {
    const name = args[0] as string;
    const handler = args[args.length - 1];
    toolRegistry[name] = handler;
  });
  const connectFn = vi.fn();
  // Low-level server mock (McpServer.server property)
  const lowLevelServer = {
    listRoots: vi.fn(),
    getClientCapabilities: vi.fn(),
    setNotificationHandler: vi.fn(),
  };
  return {
    execSync: vi.fn(),
    execFileSync: vi.fn(),
    spawn: vi.fn(),
    kill: vi.fn(),
    parseWorktrees: vi.fn(),
    gitUtils,
    GitUtilsConstructor: vi.fn(() => gitUtils),
    fsPromises: {
      readFile: vi.fn(),
      writeFile: vi.fn(),
      mkdir: vi.fn(),
      readdir: vi.fn(),
      unlink: vi.fn(),
    },
    readMetadata: vi.fn().mockResolvedValue({}),
    writeMetadata: vi.fn().mockResolvedValue(undefined),
    setCloneStatus: vi.fn().mockResolvedValue(undefined),
    requestRevision: vi.fn().mockResolvedValue({ feedbackPath: '/mock/path' }),
    tool: toolFn,
    connect: connectFn,
    lowLevelServer,
    serverInstance: { tool: toolFn, connect: connectFn, server: lowLevelServer },
    toolRegistry,
  };
});

// Provide __VERSION__ global before index.ts evaluates
vi.hoisted(() => {
  (globalThis as any).__VERSION__ = '0.0.0-test';
});

vi.mock('child_process', () => ({
  execSync: (...args: any[]) => mocks.execSync(...args),
  execFileSync: (...args: any[]) => mocks.execFileSync(...args),
}));

vi.mock('@lumi-ops/cli', () => ({
  spawn: (...args: any[]) => mocks.spawn(...args),
  kill: (...args: any[]) => mocks.kill(...args),
  parseWorktrees: (...args: any[]) => mocks.parseWorktrees(...args),
  GitUtils: mocks.GitUtilsConstructor,
  getClonesDir: (root: string) => path.join(root, '.worktrees'),
  getRepoStorageDir: (root: string) => path.join(root, '.lumi-storage'),
  getLumiOpsHome: () => '/home/user/.lumi-ops',
  METADATA_FILE: '.lumi-metadata.json',
  readMetadata: (...args: any[]) => mocks.readMetadata(...args),
  writeMetadata: (...args: any[]) => mocks.writeMetadata(...args),
  setCloneStatus: (...args: any[]) => mocks.setCloneStatus(...args),
  requestRevision: (...args: any[]) => mocks.requestRevision(...args),
}));

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: vi.fn(() => mocks.serverInstance),
}));
vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: vi.fn(),
}));
vi.mock('@modelcontextprotocol/sdk/types.js', () => ({
  RootsListChangedNotificationSchema: { method: 'notifications/roots/list_changed' },
}));

vi.mock('fs', () => ({
  promises: mocks.fsPromises,
  existsSync: vi.fn(() => false),
}));

// ---------------------------------------------------------------------------
// Import the module under test — triggers all server.tool() registrations
// ---------------------------------------------------------------------------

// Note: `import './index'` is a static ESM import hoisted before statements.
// detectRootDir runs at module load using the real cwd fallback since the
// execSync mock may not be configured yet at that point.
// We capture the actual rootDir to use in assertions.
import './index';

// The rootDir used by index.ts at module load time — since the mock might not
// intercept detectRootDir's execSync (static imports hoist), it falls back to
// process.cwd(). We use this for path assertions.
const ROOT_DIR = process.cwd();

// ---------------------------------------------------------------------------
// Helper to extract registered tool handlers (uses persistent registry)
// ---------------------------------------------------------------------------

type ToolHandler = (params: Record<string, any>) => Promise<any>;

function getToolHandler(toolName: string): ToolHandler {
  const handler = mocks.toolRegistry[toolName];
  if (!handler) {
    const registered = Object.keys(mocks.toolRegistry).join(', ');
    throw new Error(`Tool "${toolName}" not registered. Registered: ${registered}`);
  }
  return handler;
}

// ---------------------------------------------------------------------------
// spawn_clone tests
// ---------------------------------------------------------------------------

describe('spawn_clone tool', () => {
  let handler: ToolHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.spawn.mockResolvedValue(undefined);
    mocks.fsPromises.readFile.mockRejectedValue(new Error('ENOENT'));
    mocks.fsPromises.writeFile.mockResolvedValue(undefined);
    mocks.fsPromises.mkdir.mockResolvedValue(undefined);
    handler = getToolHandler('spawn_clone');
  });

  it('should pass description directly to CLI spawn when no prompt specified', async () => {
    const result = await handler({
      branch: 'feat/test',
      description: 'Build the widget',
    });

    expect(mocks.spawn).toHaveBeenCalledWith('feat/test', {
      root: ROOT_DIR,
      description: 'Build the widget',
      baseBranch: undefined,
    });
    expect(result.isError).toBeUndefined();
  });

  it('should load prompt file and use its content as description', async () => {
    mocks.fsPromises.readFile.mockImplementation(async (p: string) => {
      if (typeof p === 'string' && p.includes('my-prompt.md')) {
        return 'Prompt content from file';
      }
      throw new Error('ENOENT');
    });

    const result = await handler({
      branch: 'feat/from-prompt',
      prompt: 'my-prompt',
      promptScope: 'project',
    });

    expect(mocks.fsPromises.readFile).toHaveBeenCalledWith(
      path.join(ROOT_DIR, '.prompts', 'my-prompt.md'),
      'utf-8',
    );
    expect(mocks.spawn).toHaveBeenCalledWith('feat/from-prompt', {
      root: ROOT_DIR,
      description: 'Prompt content from file',
      baseBranch: undefined,
    });
    expect(result.isError).toBeUndefined();
  });

  it('should load prompt from global scope when promptScope is global', async () => {
    mocks.fsPromises.readFile.mockImplementation(async (p: string) => {
      if (typeof p === 'string' && p.includes('.lumi-ops/.prompts/global-prompt.md')) {
        return 'Global prompt content';
      }
      throw new Error('ENOENT');
    });

    await handler({
      branch: 'feat/global',
      prompt: 'global-prompt',
      promptScope: 'global',
    });

    expect(mocks.fsPromises.readFile).toHaveBeenCalledWith(
      path.join('/home/user/.lumi-ops', '.prompts', 'global-prompt.md'),
      'utf-8',
    );
  });

  it('should return error when prompt file not found', async () => {
    mocks.fsPromises.readFile.mockRejectedValue(new Error('ENOENT'));

    const result = await handler({
      branch: 'feat/missing',
      prompt: 'nonexistent',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not found');
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it('should track _generated/ prompt in metadata', async () => {
    mocks.fsPromises.readFile.mockImplementation(async (p: string) => {
      if (typeof p === 'string' && p.includes('_generated/auto-prompt.md')) {
        return 'Auto-generated prompt';
      }
      if (typeof p === 'string' && p.includes('.lumi-metadata.json')) {
        return '{}';
      }
      throw new Error('ENOENT');
    });
    // readMetadata returns empty metadata so spawn_clone can add sourcePrompt
    mocks.readMetadata.mockResolvedValue({});

    await handler({
      branch: 'feat/auto',
      prompt: '_generated/auto-prompt',
    });

    expect(mocks.writeMetadata).toHaveBeenCalledWith(
      ROOT_DIR,
      expect.objectContaining({
        'feat/auto': expect.objectContaining({
          sourcePrompt: '_generated/auto-prompt.md',
        }),
      }),
    );
  });

  it('should handle prompt name with .md extension', async () => {
    mocks.fsPromises.readFile.mockImplementation(async (p: string) => {
      if (typeof p === 'string' && p.includes('my-prompt.md')) {
        return 'Prompt with extension';
      }
      throw new Error('ENOENT');
    });

    await handler({
      branch: 'feat/ext',
      prompt: 'my-prompt.md',
    });

    expect(mocks.fsPromises.readFile).toHaveBeenCalledWith(
      path.join(ROOT_DIR, '.prompts', 'my-prompt.md'),
      'utf-8',
    );
  });
});

// ---------------------------------------------------------------------------
// merge_clone tests
// ---------------------------------------------------------------------------

describe('merge_clone tool', () => {
  let handler: ToolHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fsPromises.readFile.mockRejectedValue(new Error('ENOENT'));
    mocks.fsPromises.writeFile.mockResolvedValue(undefined);
    mocks.fsPromises.mkdir.mockResolvedValue(undefined);
    handler = getToolHandler('merge_clone');

    mocks.gitUtils.listWorktrees.mockResolvedValue([]);
    mocks.parseWorktrees.mockReturnValue([
      { currentBranch: 'main', branch: 'main', path: ROOT_DIR, dirName: '.' },
    ]);
    mocks.gitUtils.mergeSquash.mockResolvedValue(undefined);
    mocks.gitUtils.commit.mockResolvedValue(undefined);
    mocks.gitUtils.branchExists.mockResolvedValue(true);
    mocks.gitUtils.addWorktreeExisting.mockResolvedValue(undefined);
    mocks.gitUtils.removeWorktree.mockResolvedValue(undefined);
    mocks.gitUtils.pruneWorktrees.mockResolvedValue(undefined);
    // Default: all execSync calls return empty (for git reset, rm, etc.)
    mocks.execSync.mockReturnValue('');
  });

  it('should perform successful squash merge into existing worktree', async () => {
    mocks.parseWorktrees.mockReturnValue([
      { currentBranch: 'main', branch: 'main', path: ROOT_DIR, dirName: '.' },
      { currentBranch: 'develop', branch: 'develop', path: path.join(ROOT_DIR, '.worktrees/develop'), dirName: 'develop' },
    ]);

    const result = await handler({ source: 'feat/done', target: 'develop' });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.status).toBe('merged');
    expect(parsed.source).toBe('feat/done');
    expect(parsed.target).toBe('develop');
    expect(mocks.gitUtils.addWorktreeExisting).not.toHaveBeenCalled();
  });

  it('should create temp worktree when target has no existing worktree', async () => {
    mocks.parseWorktrees.mockReturnValue([
      { currentBranch: 'main', branch: 'main', path: ROOT_DIR, dirName: '.' },
    ]);
    mocks.gitUtils.branchExists.mockResolvedValue(true);

    const result = await handler({ source: 'feat/done', target: 'develop' });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.status).toBe('merged');
    expect(mocks.gitUtils.addWorktreeExisting).toHaveBeenCalled();
    expect(mocks.gitUtils.removeWorktree).toHaveBeenCalled();
    expect(mocks.gitUtils.pruneWorktrees).toHaveBeenCalled();
  });

  it('should return error when target branch does not exist', async () => {
    mocks.parseWorktrees.mockReturnValue([]);
    mocks.gitUtils.branchExists.mockResolvedValue(false);

    const result = await handler({ source: 'feat/done', target: 'nonexistent' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('does not exist');
  });

  it('should detect merge conflicts and return conflict status', async () => {
    // No worktree matches 'develop' — forces temp worktree creation
    mocks.parseWorktrees.mockReturnValue([
      { currentBranch: 'main', branch: 'main', path: ROOT_DIR, dirName: '.' },
    ]);
    mocks.gitUtils.branchExists.mockResolvedValue(true);
    mocks.gitUtils.mergeSquash.mockRejectedValue(new Error('CONFLICT'));

    mocks.execSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('git status --porcelain')) {
        return 'UU src/index.ts\nAA src/utils.ts\n';
      }
      if (typeof cmd === 'string' && cmd.includes('git diff --stat')) {
        return ' src/index.ts | 10 +++++++---\n';
      }
      return '';
    });

    const result = await handler({ source: 'feat/conflict', target: 'develop' });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.status).toBe('conflict');
    expect(parsed.conflictFiles).toContain('src/index.ts');
    expect(parsed.conflictFiles).toContain('src/utils.ts');
    // Temp worktree should be cleaned up after conflict
    expect(mocks.gitUtils.removeWorktree).toHaveBeenCalled();
  });

  it('should clean up temp worktree on non-conflict errors', async () => {
    mocks.parseWorktrees.mockReturnValue([]);
    mocks.gitUtils.branchExists.mockResolvedValue(true);
    mocks.gitUtils.mergeSquash.mockRejectedValue(new Error('unexpected git error'));

    const result = await handler({ source: 'feat/broken', target: 'main' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('unexpected git error');
    expect(mocks.gitUtils.removeWorktree).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// set_project_root tests
// ---------------------------------------------------------------------------

describe('set_project_root tool', () => {
  let handler: ToolHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = getToolHandler('set_project_root');
  });

  it('should resolve worktree path to main repo root', async () => {
    // resolveMainRepoRoot calls execSync with --git-common-dir first
    mocks.execSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('--git-common-dir')) {
        return '/home/user/my-repo/.git\n';
      }
      if (typeof cmd === 'string' && cmd.includes('--show-toplevel')) {
        // This would be wrong for a worktree — but resolveMainRepoRoot
        // should NOT reach this path when --git-common-dir returns /.git
        return '/home/user/my-repo.worktrees/feat/test\n';
      }
      return '';
    });

    const result = await handler({ path: '/home/user/my-repo.worktrees/feat/test' });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.status).toBe('ok');
    // Should resolve to the main repo root, NOT the worktree path
    expect(parsed.rootDir).toBe('/home/user/my-repo');
  });

  it('should return error for non-git directory', async () => {
    mocks.execSync.mockImplementation(() => {
      throw new Error('fatal: not a git repository');
    });

    const result = await handler({ path: '/tmp/not-a-repo' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not a valid git repository');
  });
});

// ---------------------------------------------------------------------------
// list_repos tests
// ---------------------------------------------------------------------------

describe('list_repos tool', () => {
  let handler: ToolHandler;
  // Use a known rootDir for list_repos tests by resetting via set_project_root.
  // The rootDir is module-level state that prior test suites may mutate.
  const KNOWN_ROOT = '/home/user/test-repo';

  beforeEach(async () => {
    vi.clearAllMocks();
    handler = getToolHandler('list_repos');

    // Reset rootDir to a known value via set_project_root
    mocks.execSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('--git-common-dir')) {
        return `${KNOWN_ROOT}/.git\n`;
      }
      return '';
    });
    await getToolHandler('set_project_root')({ path: KNOWN_ROOT });
  });

  it('should return empty repos when registry does not exist', async () => {
    mocks.fsPromises.readFile.mockRejectedValue(new Error('ENOENT'));

    const result = await handler({});

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.currentRepo).toBe(KNOWN_ROOT);
    expect(parsed.repos).toEqual([]);
    expect(result.isError).toBeUndefined();
  });

  it('should return registry contents with isCurrent flag', async () => {
    const registry = {
      'my-project': KNOWN_ROOT,
      'other-project': '/home/user/other-project',
    };
    mocks.fsPromises.readFile.mockImplementation(async (p: string) => {
      if (typeof p === 'string' && p.includes('.registry.json')) {
        return JSON.stringify(registry);
      }
      throw new Error('ENOENT');
    });

    const result = await handler({});

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.currentRepo).toBe(KNOWN_ROOT);
    expect(parsed.repos).toHaveLength(2);

    const current = parsed.repos.find((r: any) => r.name === 'my-project');
    expect(current).toBeDefined();
    expect(current.path).toBe(KNOWN_ROOT);
    expect(current.isCurrent).toBe(true);

    const other = parsed.repos.find((r: any) => r.name === 'other-project');
    expect(other).toBeDefined();
    expect(other.path).toBe('/home/user/other-project');
    expect(other.isCurrent).toBe(false);
  });

  it('should always include currentRepo in response', async () => {
    // Registry exists but does not contain the current rootDir
    const registry = {
      'unrelated-repo': '/home/user/unrelated',
    };
    mocks.fsPromises.readFile.mockImplementation(async (p: string) => {
      if (typeof p === 'string' && p.includes('.registry.json')) {
        return JSON.stringify(registry);
      }
      throw new Error('ENOENT');
    });

    const result = await handler({});

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.currentRepo).toBe(KNOWN_ROOT);
    expect(parsed.repos).toHaveLength(1);
    expect(parsed.repos[0].isCurrent).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// get_clone_log tests
// ---------------------------------------------------------------------------

describe('get_clone_log tool', () => {
  let handler: ToolHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = getToolHandler('get_clone_log');
    // ensureRootDir uses execSync to validate git repo
    mocks.execSync.mockReturnValue('');
    // Default: metadata returns baseBranch for look-up
    mocks.readMetadata.mockResolvedValue({
      'feat/test': { baseBranch: 'main' },
    });
  });

  it('should return empty commits array when branch has no commits ahead', async () => {
    // git log returns empty string (no commits)
    mocks.execFileSync.mockImplementation((_cmd: string, args: string[]) => {
      if (args.includes('log')) return '';
      if (args.includes('--count')) return '0\n';
      return '';
    });

    const result = await handler({ branch: 'feat/test', maxCount: 20 });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.branch).toBe('feat/test');
    expect(parsed.baseBranch).toBe('main');
    expect(parsed.commits).toEqual([]);
    expect(parsed.totalCommits).toBe(0);
    expect(result.isError).toBeUndefined();
  });

  it('should respect maxCount parameter', async () => {
    mocks.execFileSync.mockImplementation((_cmd: string, args: string[]) => {
      if (args.includes('log')) {
        // Verify maxCount is reflected in the args
        expect(args).toContain('-5');
        return [
          'abc1234\x00feat: add login\x002026-03-13 10:00:00 +0800\x00Alice',
          'def5678\x00fix: typo\x002026-03-13 09:00:00 +0800\x00Bob',
        ].join('\n');
      }
      if (args.includes('--count')) return '2\n';
      return '';
    });

    const result = await handler({ branch: 'feat/test', maxCount: 5 });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.commits).toHaveLength(2);
    expect(parsed.commits[0]).toEqual({
      hash: 'abc1234',
      message: 'feat: add login',
      date: '2026-03-13 10:00:00 +0800',
      author: 'Alice',
    });
    expect(parsed.commits[1]).toEqual({
      hash: 'def5678',
      message: 'fix: typo',
      date: '2026-03-13 09:00:00 +0800',
      author: 'Bob',
    });
    expect(parsed.totalCommits).toBe(2);
  });

  it('should return empty commits for non-existent branch (git commands fail)', async () => {
    // Both git log and rev-list throw for nonexistent branch
    mocks.execFileSync.mockImplementation(() => {
      throw new Error('fatal: bad revision');
    });

    const result = await handler({ branch: 'nonexistent/branch', maxCount: 20 });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.commits).toEqual([]);
    expect(parsed.totalCommits).toBe(0);
    expect(result.isError).toBeUndefined();
  });
});


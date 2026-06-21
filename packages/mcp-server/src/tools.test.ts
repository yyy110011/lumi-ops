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
  // Persistent storage for resource registrations
  const resourceRegistry: Record<string, { handler: (...args: any[]) => Promise<any>; listHandler?: () => Promise<any> }> = {};
  const resourceFn = vi.fn((...args: any[]) => {
    const name = args[0] as string;
    const handler = args[args.length - 1];
    // For ResourceTemplate-based resources, the 2nd arg is a ResourceTemplate with list
    const templateOrUri = args[1];
    const listHandler = templateOrUri?.list ? templateOrUri.list : undefined;
    resourceRegistry[name] = { handler, listHandler };
  });
  // Persistent storage for prompt registrations
  const promptRegistry: Record<string, (...args: any[]) => Promise<any>> = {};
  const promptFn = vi.fn((...args: any[]) => {
    const name = args[0] as string;
    const handler = args[args.length - 1];
    promptRegistry[name] = handler;
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
      stat: vi.fn(),
    },
    readMetadata: vi.fn().mockResolvedValue({}),
    writeMetadata: vi.fn().mockResolvedValue(undefined),
    migrateMetadataToLumiDir: vi.fn().mockResolvedValue(false),
    setCloneStatus: vi.fn().mockResolvedValue(undefined),
    requestRevision: vi.fn().mockResolvedValue({ feedbackPath: '/mock/path' }),
    tool: toolFn,
    connect: connectFn,
    lowLevelServer,
    toolRegistry,
    resource: resourceFn,
    prompt: promptFn,
    resourceRegistry,
    promptRegistry,
    serverInstance: { tool: toolFn, connect: connectFn, server: lowLevelServer, resource: resourceFn, prompt: promptFn },
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
  migrateMetadataToLumiDir: (...args: any[]) => mocks.migrateMetadataToLumiDir(...args),
  setCloneStatus: (...args: any[]) => mocks.setCloneStatus(...args),
  requestRevision: (...args: any[]) => mocks.requestRevision(...args),
}));

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: vi.fn(() => mocks.serverInstance),
  ResourceTemplate: class ResourceTemplate {
    list?: () => Promise<any>;
    constructor(public uriTemplate: string, opts?: { list?: () => Promise<any> }) {
      this.list = opts?.list;
    }
  },
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

function getResourceHandler(resourceName: string): { handler: ToolHandler; listHandler?: () => Promise<any> } {
  const entry = mocks.resourceRegistry[resourceName];
  if (!entry) {
    const registered = Object.keys(mocks.resourceRegistry).join(', ');
    throw new Error(`Resource "${resourceName}" not registered. Registered: ${registered}`);
  }
  return entry;
}

function getPromptHandler(promptName: string): ToolHandler {
  const handler = mocks.promptRegistry[promptName];
  if (!handler) {
    const registered = Object.keys(mocks.promptRegistry).join(', ');
    throw new Error(`Prompt "${promptName}" not registered. Registered: ${registered}`);
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
    // resolveEffectiveRoot now always calls resolveMainRepoRoot which uses execSync
    mocks.execSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('--git-common-dir')) {
        return `${ROOT_DIR}/.git\n`;
      }
      return '';
    });
    handler = getToolHandler('spawn_clone');
  });

  it('should pass description directly to CLI spawn when no prompt specified', async () => {
    const result = await handler({
      branch: 'feat/test',
      description: 'Build the widget',
      repo: ROOT_DIR,
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
      repo: ROOT_DIR,
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
      repo: ROOT_DIR,
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
      repo: ROOT_DIR,
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
      repo: ROOT_DIR,
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
      repo: ROOT_DIR,
    });

    expect(mocks.fsPromises.readFile).toHaveBeenCalledWith(
      path.join(ROOT_DIR, '.prompts', 'my-prompt.md'),
      'utf-8',
    );
  });
});

// ---------------------------------------------------------------------------
// repo parameter tests — spawn_clone
// ---------------------------------------------------------------------------

describe('spawn_clone with repo parameter', () => {
  let handler: ToolHandler;
  const ALT_REPO = '/home/user/other-repo';

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.spawn.mockResolvedValue(undefined);
    mocks.fsPromises.readFile.mockRejectedValue(new Error('ENOENT'));
    mocks.fsPromises.writeFile.mockResolvedValue(undefined);
    mocks.fsPromises.mkdir.mockResolvedValue(undefined);
    handler = getToolHandler('spawn_clone');
  });

  it('should use resolved repo root when repo param is provided', async () => {
    // resolveMainRepoRoot uses execSync to resolve the main repo root
    mocks.execSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('--git-common-dir')) {
        return `${ALT_REPO}/.git\n`;
      }
      return '';
    });

    const result = await handler({
      branch: 'feat/cross-repo',
      description: 'Cross-repo task',
      repo: `${ALT_REPO}.worktrees/feat/some-clone`,
    });

    expect(mocks.spawn).toHaveBeenCalledWith('feat/cross-repo', {
      root: ALT_REPO,
      description: 'Cross-repo task',
      baseBranch: undefined,
    });
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.path).toContain(ALT_REPO);
  });

  it('should resolve ROOT_DIR when repo param points to ROOT_DIR', async () => {
    // ensureRootDir calls execSync — just allow it
    mocks.execSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('--git-common-dir')) {
        return `${ROOT_DIR}/.git\n`;
      }
      return '';
    });

    const result = await handler({
      branch: 'feat/default-repo',
      description: 'Default repo task',
      repo: ROOT_DIR,
    });

    expect(mocks.spawn).toHaveBeenCalledWith('feat/default-repo', {
      root: ROOT_DIR,
      description: 'Default repo task',
      baseBranch: undefined,
    });
    expect(result.isError).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// repo parameter tests — list_clones
// ---------------------------------------------------------------------------

describe('list_clones with repo parameter', () => {
  let handler: ToolHandler;
  const ALT_REPO = '/home/user/other-repo';

  beforeEach(() => {
    vi.clearAllMocks();
    handler = getToolHandler('list_clones');
    mocks.gitUtils.listWorktrees.mockResolvedValue([]);
    mocks.parseWorktrees.mockReturnValue([]);
    mocks.readMetadata.mockResolvedValue({});
  });

  it('should use resolved repo root and show it in response', async () => {
    mocks.execSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('--git-common-dir')) {
        return `${ALT_REPO}/.git\n`;
      }
      return '';
    });

    const result = await handler({ repo: ALT_REPO });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.repository).toBe(ALT_REPO);
    expect(mocks.GitUtilsConstructor).toHaveBeenCalledWith(ALT_REPO);
  });
});

// ---------------------------------------------------------------------------
// repo parameter tests — kill_clone
// ---------------------------------------------------------------------------

describe('kill_clone with repo parameter', () => {
  let handler: ToolHandler;
  const ALT_REPO = '/home/user/other-repo';

  beforeEach(() => {
    vi.clearAllMocks();
    handler = getToolHandler('kill_clone');
    mocks.readMetadata.mockResolvedValue({});
    mocks.kill.mockResolvedValue(undefined);
  });

  it('should use resolved repo root for kill operations', async () => {
    mocks.execSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('--git-common-dir')) {
        return `${ALT_REPO}/.git\n`;
      }
      return '';
    });

    const result = await handler({
      branch: 'feat/cross-repo-kill',
      keepBranch: false,
      repo: `${ALT_REPO}.worktrees/feat/some-clone`,
    });

    expect(mocks.kill).toHaveBeenCalledWith('feat/cross-repo-kill', {
      root: ALT_REPO,
      keepBranch: false,
    });
    expect(result.isError).toBeUndefined();
  });

  it('should clean up generated prompt from effective root on kill', async () => {
    mocks.execSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('--git-common-dir')) {
        return `${ALT_REPO}/.git\n`;
      }
      return '';
    });
    mocks.readMetadata.mockResolvedValue({
      'feat/gen-kill': { sourcePrompt: '_generated/auto-task.md' },
    });
    mocks.fsPromises.unlink.mockResolvedValue(undefined);

    const result = await handler({
      branch: 'feat/gen-kill',
      keepBranch: false,
      repo: ALT_REPO,
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.promptCleaned).toBe(true);
    expect(mocks.fsPromises.unlink).toHaveBeenCalledWith(
      path.join(ALT_REPO, '.prompts', '_generated/auto-task.md'),
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

    const result = await handler({ source: 'feat/done', target: 'develop', repo: ROOT_DIR });

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

    const result = await handler({ source: 'feat/done', target: 'develop', repo: ROOT_DIR });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.status).toBe('merged');
    expect(mocks.gitUtils.addWorktreeExisting).toHaveBeenCalled();
    expect(mocks.gitUtils.removeWorktree).toHaveBeenCalled();
    expect(mocks.gitUtils.pruneWorktrees).toHaveBeenCalled();
  });

  it('should return error when target branch does not exist', async () => {
    mocks.parseWorktrees.mockReturnValue([]);
    mocks.gitUtils.branchExists.mockResolvedValue(false);

    const result = await handler({ source: 'feat/done', target: 'nonexistent', repo: ROOT_DIR });

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

    const result = await handler({ source: 'feat/conflict', target: 'develop', repo: ROOT_DIR });

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

    const result = await handler({ source: 'feat/broken', target: 'main', repo: ROOT_DIR });

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

    const result = await handler({ branch: 'feat/test', maxCount: 20, repo: ROOT_DIR });

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

    const result = await handler({ branch: 'feat/test', maxCount: 5, repo: ROOT_DIR });

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

    const result = await handler({ branch: 'nonexistent/branch', maxCount: 20, repo: ROOT_DIR });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.commits).toEqual([]);
    expect(parsed.totalCommits).toBe(0);
    expect(result.isError).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// read_clone_file tests
// ---------------------------------------------------------------------------

describe('read_clone_file tool', () => {
  let handler: ToolHandler;

  const CLONE_PATH = path.join(ROOT_DIR, '.worktrees', 'feat/my-clone');

  beforeEach(() => {
    vi.clearAllMocks();
    handler = getToolHandler('read_clone_file');
    // ensureRootDir calls execSync('git rev-parse --show-toplevel') — must succeed
    mocks.execSync.mockReturnValue('');
    mocks.gitUtils.listWorktrees.mockResolvedValue([]);
    mocks.parseWorktrees.mockReturnValue([
      { currentBranch: 'feat/my-clone', branch: 'feat/my-clone', path: CLONE_PATH, dirName: 'feat/my-clone' },
    ]);
  });

  it('should successfully read a text file from a clone', async () => {
    mocks.fsPromises.stat.mockResolvedValue({ size: 42 });
    mocks.fsPromises.readFile.mockResolvedValue(Buffer.from('hello world'));

    const result = await handler({ branch: 'feat/my-clone', filepath: 'src/index.ts', repo: ROOT_DIR });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.branch).toBe('feat/my-clone');
    expect(parsed.filepath).toBe('src/index.ts');
    expect(parsed.content).toBe('hello world');
    expect(parsed.size).toBe(42);
  });

  it('should return error for non-existent clone', async () => {
    mocks.parseWorktrees.mockReturnValue([]);

    const result = await handler({ branch: 'feat/nonexistent', filepath: 'README.md', repo: ROOT_DIR });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('no worktree found');
  });

  it('should return not-found for non-existent file', async () => {
    mocks.fsPromises.stat.mockRejectedValue(new Error('ENOENT'));

    const result = await handler({ branch: 'feat/my-clone', filepath: 'does-not-exist.txt', repo: ROOT_DIR });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.content).toBeNull();
    expect(parsed.note).toBe('File not found');
  });

  it('should block path traversal attempts', async () => {
    const result = await handler({ branch: 'feat/my-clone', filepath: '../../../etc/passwd', repo: ROOT_DIR });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Path traversal is not allowed');
    // readFile should never be called for traversal attempts
    expect(mocks.fsPromises.readFile).not.toHaveBeenCalled();
    expect(mocks.fsPromises.stat).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// v0.4.4 — Resource Tests
// ===========================================================================

// ---------------------------------------------------------------------------
// lumi://clones resource tests
// Clone: feat/res-clones-list
// ---------------------------------------------------------------------------

describe('lumi://clones resource', () => {
  let handler: (...args: any[]) => Promise<any>;
  // Import fs mock reference for existsSync control
  let existsSyncMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const entry = getResourceHandler('clone-list');
    handler = entry.handler;
    // Get the existsSync mock from the fs mock module
    const fsMod = await import('fs');
    existsSyncMock = fsMod.existsSync as ReturnType<typeof vi.fn>;
    // Reset rootDir to ROOT_DIR via set_project_root (rootDir is module-level state)
    mocks.execSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('--git-common-dir')) {
        return `${ROOT_DIR}/.git\n`;
      }
      return '';
    });
    await getToolHandler('set_project_root')({ path: ROOT_DIR });
  });

  it('should return enriched clone list with metadata and hasReport', async () => {
    const clonePath1 = path.join(ROOT_DIR, '.worktrees', 'feat/alpha');
    const clonePath2 = path.join(ROOT_DIR, '.worktrees', 'feat/beta');
    mocks.gitUtils.listWorktrees.mockResolvedValue([]);
    mocks.parseWorktrees.mockReturnValue([
      { currentBranch: 'feat/alpha', branch: 'feat/alpha', path: clonePath1, dirName: 'feat/alpha', baseBranch: 'main' },
      { currentBranch: 'feat/beta', branch: 'feat/beta', path: clonePath2, dirName: 'feat/beta', baseBranch: 'main' },
    ]);
    mocks.readMetadata.mockResolvedValue({
      'feat/alpha': { baseBranch: 'develop', description: 'Alpha task', reviewStatus: 'needsReview' },
    });
    existsSyncMock.mockImplementation((p: string) => {
      if (typeof p === 'string' && p.includes('feat/alpha') && p.includes('MISSION_COMPLETE.md')) return true;
      return false;
    });

    const result = await handler(new URL('lumi://clones'), {});

    const parsed = JSON.parse(result.contents[0].text);
    expect(parsed.repository).toBe(ROOT_DIR);
    expect(parsed.clones).toHaveLength(2);

    const alpha = parsed.clones.find((c: any) => c.dirName === 'feat/alpha');
    expect(alpha.hasReport).toBe(true);
    expect(alpha.baseBranch).toBe('develop');
    expect(alpha.title).toBe('Alpha task');
    expect(alpha.description).toBeUndefined();
    expect(alpha.reviewStatus).toBe('needsReview');

    const beta = parsed.clones.find((c: any) => c.dirName === 'feat/beta');
    expect(beta.hasReport).toBe(false);
    expect(beta.title).toBe('(no description)');
    expect(beta.description).toBeUndefined();
  });

  it('should handle empty clone list', async () => {
    mocks.gitUtils.listWorktrees.mockResolvedValue([]);
    mocks.parseWorktrees.mockReturnValue([]);
    mocks.readMetadata.mockResolvedValue({});

    const result = await handler(new URL('lumi://clones'), {});

    const parsed = JSON.parse(result.contents[0].text);
    expect(parsed.repository).toBe(ROOT_DIR);
    expect(parsed.clones).toEqual([]);
  });

  it('should handle git errors gracefully', async () => {
    mocks.gitUtils.listWorktrees.mockRejectedValue(new Error('git failed'));

    const result = await handler(new URL('lumi://clones'), {});

    const parsed = JSON.parse(result.contents[0].text);
    expect(parsed.error).toContain('Error listing clones');
    expect(parsed.error).toContain('git failed');
  });
});

// ---------------------------------------------------------------------------
// Per-clone file resource tests
// Clone: feat/res-clone-files
// ---------------------------------------------------------------------------

describe('per-clone file resources (clone-mission, clone-report, clone-feedback)', () => {
  const CLONE_PATH = path.join(ROOT_DIR, '.worktrees', 'feat/my-clone');

  // Resource name → .lumi/ filename mapping
  const resourceMap: Record<string, string> = {
    'clone-mission': 'MISSION.md',
    'clone-report': 'MISSION_COMPLETE.md',
    'clone-feedback': 'REVIEW_FEEDBACK.md',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // ensureRootDir uses execSync to validate git repo
    mocks.execSync.mockReturnValue('');
    mocks.gitUtils.listWorktrees.mockResolvedValue([]);
    mocks.parseWorktrees.mockReturnValue([
      { currentBranch: 'feat/my-clone', branch: 'feat/my-clone', path: CLONE_PATH, dirName: 'feat/my-clone', isShadow: true },
    ]);
  });

  for (const [resourceName, filename] of Object.entries(resourceMap)) {
    describe(resourceName, () => {
      it(`should read ${filename} from clone worktree successfully`, async () => {
        const { handler } = getResourceHandler(resourceName);
        const fileContent = `# ${filename} content`;
        mocks.fsPromises.readFile.mockResolvedValue(fileContent);

        const result = await handler(
          new URL(`lumi://clones/${encodeURIComponent('feat/my-clone')}/${resourceName.replace('clone-', '')}`),
          { branch: encodeURIComponent('feat/my-clone') },
        );

        expect(result.contents).toHaveLength(1);
        expect(result.contents[0].text).toBe(fileContent);
        expect(mocks.fsPromises.readFile).toHaveBeenCalledWith(
          path.join(CLONE_PATH, '.lumi', filename),
          'utf-8',
        );
      });

      it('should handle missing file gracefully', async () => {
        const { handler } = getResourceHandler(resourceName);
        mocks.fsPromises.readFile.mockRejectedValue(new Error('ENOENT'));

        const result = await handler(
          new URL(`lumi://clones/${encodeURIComponent('feat/my-clone')}/${resourceName.replace('clone-', '')}`),
          { branch: encodeURIComponent('feat/my-clone') },
        );

        expect(result.contents).toHaveLength(1);
        expect(result.contents[0].text).toContain('File not found');
      });

      it('should handle non-existent clone', async () => {
        const { handler } = getResourceHandler(resourceName);
        mocks.parseWorktrees.mockReturnValue([]);

        const result = await handler(
          new URL(`lumi://clones/${encodeURIComponent('feat/nonexistent')}/${resourceName.replace('clone-', '')}`),
          { branch: encodeURIComponent('feat/nonexistent') },
        );

        expect(result.contents).toHaveLength(1);
        expect(result.contents[0].text).toContain('no worktree found');
      });

      it('should list clones that have the file', async () => {
        const { listHandler } = getResourceHandler(resourceName);
        expect(listHandler).toBeDefined();

        // Import fs mock to control existsSync
        const fs = await import('fs');
        (fs.existsSync as ReturnType<typeof vi.fn>).mockImplementation((p: string) => {
          if (typeof p === 'string' && p.includes('.lumi') && p.includes(filename)) {
            return true;
          }
          return false;
        });

        const result = await listHandler!();

        expect(result.resources).toHaveLength(1);
        expect(result.resources[0].name).toContain('feat/my-clone');
        expect(result.resources[0].uri).toContain(encodeURIComponent('feat/my-clone'));
      });

      it('should return empty list when no clones have the file', async () => {
        const { listHandler } = getResourceHandler(resourceName);
        expect(listHandler).toBeDefined();

        const fs = await import('fs');
        (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);

        const result = await listHandler!();

        expect(result.resources).toHaveLength(0);
      });
    });
  }
});

// ---------------------------------------------------------------------------
// Prompt & Config resource tests
// Clone: feat/res-prompts-config
// ---------------------------------------------------------------------------

describe('config resource', () => {
  it('should return rootDir, detection method, and version', async () => {
    const { handler } = getResourceHandler('config');
    const uri = new URL('lumi://config');

    const result = await handler(uri, {});

    const parsed = JSON.parse(result.contents[0].text);
    expect(parsed.rootDir).toBeDefined();
    expect(parsed.rootDetectionMethod).toBeDefined();
    expect(parsed.version).toBe('0.0.0-test');
  });
});

describe('prompt-content resource', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should read prompt file content', async () => {
    mocks.fsPromises.readFile.mockImplementation(async (p: string) => {
      if (typeof p === 'string' && p.includes('.prompts') && p.endsWith('my-task.md')) {
        return 'Task prompt content here';
      }
      throw new Error('ENOENT');
    });

    const { handler } = getResourceHandler('prompt-content');
    const uri = new URL('lumi://prompts/project/my-task');

    const result = await handler(uri, { scope: 'project', name: 'my-task' });

    expect(result.contents[0].text).toBe('Task prompt content here');
  });

  it('should handle missing prompt gracefully', async () => {
    mocks.fsPromises.readFile.mockRejectedValue(new Error('ENOENT'));

    const { handler } = getResourceHandler('prompt-content');
    const uri = new URL('lumi://prompts/project/nonexistent');

    const result = await handler(uri, { scope: 'project', name: 'nonexistent' });

    expect(result.contents[0].text).toContain('not found');
  });

  it('should enumerate prompts from both scopes', async () => {
    mocks.fsPromises.readdir.mockImplementation(async (dir: string) => {
      if (typeof dir === 'string' && dir.includes('.lumi-ops/.prompts') && !dir.includes('_generated')) {
        return [
          { name: 'global-task.md', isFile: () => true },
        ];
      }
      if (typeof dir === 'string' && dir.endsWith('.prompts') && !dir.includes('_generated')) {
        return [
          { name: 'project-task.md', isFile: () => true },
        ];
      }
      // _generated dirs — return empty
      return [];
    });

    const { listHandler } = getResourceHandler('prompt-content');
    expect(listHandler).toBeDefined();

    const result = await listHandler!();

    expect(result.resources.length).toBeGreaterThanOrEqual(2);
    const uris = result.resources.map((r: any) => r.uri);
    expect(uris).toContain('lumi://prompts/global/global-task');
    expect(uris).toContain('lumi://prompts/project/project-task');
  });
});

// ===========================================================================
// v0.4.4 — MCP Prompt Tests
// ===========================================================================

// ---------------------------------------------------------------------------
// Review & Conflict MCP Prompt tests
// Clone: feat/mcp-prompts-review
// ---------------------------------------------------------------------------

describe('review-and-merge prompt', () => {
  let handler: ToolHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = getPromptHandler('review-and-merge');
  });

  it('should return messages containing relevant tool names', async () => {
    const result = await handler({ branch: 'feat/test-branch' });

    expect(result.messages).toHaveLength(1);
    const text = result.messages[0].content.text;
    expect(text).toContain('review_clone');
    expect(text).toContain('merge_clone');
    expect(text).toContain('set_clone_status');
    expect(text).toContain('request_revision');
    expect(text).toContain('get_clone_file_diff');
  });

  it('should include the branch arg in the message text', async () => {
    const result = await handler({ branch: 'feat/my-feature' });

    const text = result.messages[0].content.text;
    expect(text).toContain('feat/my-feature');
  });
});

describe('resolve-conflict prompt', () => {
  let handler: ToolHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = getPromptHandler('resolve-conflict');
  });

  it('should return messages with conflict resolution guidance', async () => {
    const result = await handler({ source: 'feat/src', target: 'main' });

    expect(result.messages).toHaveLength(1);
    const text = result.messages[0].content.text;
    expect(text).toContain('get_clone_file_diff');
    expect(text).toContain('read_clone_file');
    expect(text).toContain('merge_clone');
  });

  it('should reference both source and target branches', async () => {
    const result = await handler({ source: 'feat/source-branch', target: 'develop' });

    const text = result.messages[0].content.text;
    expect(text).toContain('feat/source-branch');
    expect(text).toContain('develop');
  });
});

// ---------------------------------------------------------------------------
// Spawn & Strategy MCP Prompt tests
// Clone: feat/mcp-prompts-spawn
// ---------------------------------------------------------------------------

describe('spawn-with-context prompt', () => {
  let handler: ToolHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = getPromptHandler('spawn-with-context');
  });

  it('should return messages containing tool names', async () => {
    const result = await handler({ task: 'Add user authentication' });

    expect(result.messages).toHaveLength(1);
    const text = result.messages[0].content.text;
    expect(text).toContain('list_prompts');
    expect(text).toContain('spawn_clone');
    expect(text).toContain('save_prompt');
  });

  it('should include the task arg in the message', async () => {
    const task = 'Implement OAuth2 login flow';
    const result = await handler({ task });

    const text = result.messages[0].content.text;
    expect(text).toContain(task);
  });

  it('should reference branch naming conventions', async () => {
    const result = await handler({ task: 'Fix login bug' });

    const text = result.messages[0].content.text;
    expect(text).toContain('feat/');
    expect(text).toContain('fix/');
    expect(text).toContain('refactor/');
  });
});

describe('multi-clone-strategy prompt', () => {
  let handler: ToolHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = getPromptHandler('multi-clone-strategy');
  });

  it('should return messages with planning guidance', async () => {
    const result = await handler({ goal: 'Migrate to new API' });

    expect(result.messages).toHaveLength(1);
    const text = result.messages[0].content.text;
    expect(text).toContain('Break Down the Goal');
    expect(text).toContain('parallelizable');
    expect(text).toContain('merge conflicts');
  });

  it('should include the goal arg in the message', async () => {
    const goal = 'Refactor the entire data layer to use GraphQL';
    const result = await handler({ goal });

    const text = result.messages[0].content.text;
    expect(text).toContain(goal);
  });

  it('should reference related tools in the message content', async () => {
    const result = await handler({ goal: 'Build v2.0 features' });

    const text = result.messages[0].content.text;
    expect(text).toContain('list_clones');
    expect(text).toContain('spawn_clone');
    expect(text).toContain('review_clone');
    expect(text).toContain('describe_clone');
  });
});

// ===========================================================================
// describe_clone tests
// ===========================================================================

describe('describe_clone tool', () => {
  let handler: ToolHandler;
  const CLONE_PATH = path.join(ROOT_DIR, '.worktrees', 'feat/detail-me');
  let existsSyncMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    handler = getToolHandler('describe_clone');
    mocks.execSync.mockReturnValue('');
    mocks.gitUtils.listWorktrees.mockResolvedValue([]);
    mocks.parseWorktrees.mockReturnValue([
      { currentBranch: 'feat/detail-me', branch: 'feat/detail-me', path: CLONE_PATH, dirName: 'feat/detail-me', baseBranch: 'main' },
    ]);
    mocks.readMetadata.mockResolvedValue({
      'feat/detail-me': { baseBranch: 'develop', description: '# Mission: Implement OAuth\nDetailed steps here...', reviewStatus: 'inProgress' },
    });
    const fsMod = await import('fs');
    existsSyncMock = fsMod.existsSync as ReturnType<typeof vi.fn>;
  });

  it('should return full clone details with description and title', async () => {
    existsSyncMock.mockReturnValue(false);

    const result = await handler({ branch: 'feat/detail-me', repo: ROOT_DIR });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.branch).toBe('feat/detail-me');
    expect(parsed.title).toBe('Mission: Implement OAuth');
    expect(parsed.description).toBe('# Mission: Implement OAuth\nDetailed steps here...');
    expect(parsed.baseBranch).toBe('develop');
    expect(parsed.reviewStatus).toBe('inProgress');
    expect(parsed.hasReport).toBe(false);
    expect(parsed.missionComplete).toBeNull();
  });

  it('should return missionComplete content when MISSION_COMPLETE.md exists', async () => {
    existsSyncMock.mockImplementation((p: string) => {
      if (typeof p === 'string' && p.includes('MISSION_COMPLETE.md')) return true;
      return false;
    });
    mocks.fsPromises.readFile.mockResolvedValue('## Summary\nAll done!');

    const result = await handler({ branch: 'feat/detail-me', repo: ROOT_DIR });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.hasReport).toBe(true);
    expect(parsed.missionComplete).toBe('## Summary\nAll done!');
  });

  it('should return error for non-existent branch', async () => {
    mocks.parseWorktrees.mockReturnValue([]);

    const result = await handler({ branch: 'feat/nonexistent', repo: ROOT_DIR });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('no worktree found');
    expect(result.content[0].text).toContain('feat/nonexistent');
  });

  it('should use resolved repo root when repo param is provided', async () => {
    const ALT_REPO = '/home/user/other-repo';
    const ALT_CLONE_PATH = path.join(ALT_REPO, '.worktrees', 'feat/detail-me');
    mocks.execSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('--git-common-dir')) {
        return `${ALT_REPO}/.git\n`;
      }
      return '';
    });
    mocks.parseWorktrees.mockReturnValue([
      { currentBranch: 'feat/detail-me', branch: 'feat/detail-me', path: ALT_CLONE_PATH, dirName: 'feat/detail-me', baseBranch: 'main' },
    ]);
    mocks.readMetadata.mockResolvedValue({
      'feat/detail-me': { baseBranch: 'main', description: '# Cross-repo task' },
    });
    existsSyncMock.mockReturnValue(false);

    const result = await handler({ branch: 'feat/detail-me', repo: `${ALT_REPO}.worktrees/feat/some-clone` });

    expect(result.isError).toBeUndefined();
    expect(mocks.GitUtilsConstructor).toHaveBeenCalledWith(ALT_REPO);
    expect(mocks.parseWorktrees).toHaveBeenCalledWith(expect.anything(), ALT_REPO);
    expect(mocks.readMetadata).toHaveBeenCalledWith(ALT_REPO);
    // The metadata read path migrates the resolved root out of .worktrees first.
    expect(mocks.migrateMetadataToLumiDir).toHaveBeenCalledWith(ALT_REPO);
  });
});

// ===========================================================================
// v0.4.5 — Per-Call `repo` Parameter Tests (review-ops)
// ===========================================================================

// ---------------------------------------------------------------------------
// set_clone_status with repo param
// ---------------------------------------------------------------------------

describe('set_clone_status with repo param', () => {
  let handler: ToolHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = getToolHandler('set_clone_status');
    mocks.setCloneStatus.mockResolvedValue(undefined);
  });

  it('should resolve repo path and pass resolved root to setCloneStatus', async () => {
    const REPO_PATH = '/home/user/other-repo.worktrees/feat/branch';
    const RESOLVED_ROOT = '/home/user/other-repo';

    mocks.execSync.mockImplementation((cmd: string, opts: any) => {
      if (typeof cmd === 'string' && cmd.includes('--git-common-dir')) {
        return `${RESOLVED_ROOT}/.git\n`;
      }
      // ensureRootDir check
      return '';
    });

    const result = await handler({
      branch: 'feat/test',
      status: 'needsReview',
      repo: REPO_PATH,
    });

    expect(result.isError).toBeUndefined();
    expect(mocks.setCloneStatus).toHaveBeenCalledWith(
      'feat/test',
      'needsReview',
      { root: RESOLVED_ROOT },
    );
  });

  it('should resolve ROOT_DIR when repo param points to ROOT_DIR', async () => {
    // ensureRootDir uses execSync — make it succeed
    mocks.execSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('--git-common-dir')) {
        return `${ROOT_DIR}/.git\n`;
      }
      return '';
    });

    const result = await handler({
      branch: 'feat/test',
      status: 'done',
      repo: ROOT_DIR,
    });

    expect(result.isError).toBeUndefined();
    expect(mocks.setCloneStatus).toHaveBeenCalledWith(
      'feat/test',
      'done',
      { root: ROOT_DIR },
    );
  });
});

// ---------------------------------------------------------------------------
// review_clone with repo param
// ---------------------------------------------------------------------------

describe('review_clone with repo param', () => {
  let handler: ToolHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = getToolHandler('review_clone');
  });

  it('should use resolved repo root for GitUtils, metadata, and git commands', async () => {
    const REPO_PATH = '/home/user/other-repo.worktrees/feat/work';
    const RESOLVED_ROOT = '/home/user/other-repo';
    const CLONE_PATH = path.join(RESOLVED_ROOT, '.worktrees', 'feat/review-me');

    mocks.execSync.mockImplementation((cmd: string, opts: any) => {
      if (typeof cmd === 'string' && cmd.includes('--git-common-dir')) {
        return `${RESOLVED_ROOT}/.git\n`;
      }
      return '';
    });

    mocks.gitUtils.listWorktrees.mockResolvedValue([]);
    mocks.parseWorktrees.mockReturnValue([
      { currentBranch: 'feat/review-me', branch: 'feat/review-me', path: CLONE_PATH, dirName: 'feat/review-me' },
    ]);
    mocks.readMetadata.mockResolvedValue({
      'feat/review-me': { baseBranch: 'main' },
    });
    mocks.fsPromises.readFile.mockRejectedValue(new Error('ENOENT'));
    mocks.execFileSync.mockReturnValue('');

    const result = await handler({ branch: 'feat/review-me', repo: REPO_PATH });

    expect(result.isError).toBeUndefined();
    // GitUtils should be constructed with resolved root
    expect(mocks.GitUtilsConstructor).toHaveBeenCalledWith(RESOLVED_ROOT);
    // parseWorktrees should be called with resolved root
    expect(mocks.parseWorktrees).toHaveBeenCalledWith(expect.anything(), RESOLVED_ROOT);
    // readMetadata should be called with resolved root
    expect(mocks.readMetadata).toHaveBeenCalledWith(RESOLVED_ROOT);
  });
});

// ---------------------------------------------------------------------------
// read_clone_file with repo param
// ---------------------------------------------------------------------------

describe('read_clone_file with repo param', () => {
  let handler: ToolHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = getToolHandler('read_clone_file');
  });

  it('should use resolved repo root for worktree lookup', async () => {
    const REPO_PATH = '/home/user/other-repo.worktrees/feat/work';
    const RESOLVED_ROOT = '/home/user/other-repo';
    const CLONE_PATH = path.join(RESOLVED_ROOT, '.worktrees', 'feat/read-me');

    mocks.execSync.mockImplementation((cmd: string, opts: any) => {
      if (typeof cmd === 'string' && cmd.includes('--git-common-dir')) {
        return `${RESOLVED_ROOT}/.git\n`;
      }
      return '';
    });

    mocks.gitUtils.listWorktrees.mockResolvedValue([]);
    mocks.parseWorktrees.mockReturnValue([
      { currentBranch: 'feat/read-me', branch: 'feat/read-me', path: CLONE_PATH, dirName: 'feat/read-me' },
    ]);
    mocks.fsPromises.stat.mockResolvedValue({ size: 42 });
    mocks.fsPromises.readFile.mockResolvedValue(Buffer.from('file content'));

    const result = await handler({ branch: 'feat/read-me', filepath: 'src/main.ts', repo: REPO_PATH });

    expect(result.isError).toBeUndefined();
    // GitUtils should be constructed with resolved root
    expect(mocks.GitUtilsConstructor).toHaveBeenCalledWith(RESOLVED_ROOT);
    // parseWorktrees should be called with resolved root
    expect(mocks.parseWorktrees).toHaveBeenCalledWith(expect.anything(), RESOLVED_ROOT);

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.content).toBe('file content');
  });
});

// ---------------------------------------------------------------------------
// repo parameter tests — list_prompts
// ---------------------------------------------------------------------------

describe('list_prompts with repo parameter', () => {
  let handler: ToolHandler;
  const ALT_REPO = '/home/user/other-repo';

  beforeEach(() => {
    vi.clearAllMocks();
    handler = getToolHandler('list_prompts');
    mocks.fsPromises.readdir.mockResolvedValue([]);
  });

  it('should read project-scope prompts from resolved repo when repo param is provided', async () => {
    mocks.execSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('--git-common-dir')) {
        return `${ALT_REPO}/.git\n`;
      }
      return '';
    });

    mocks.fsPromises.readdir.mockImplementation(async (dir: string) => {
      if (typeof dir === 'string' && dir === path.join(ALT_REPO, '.prompts')) {
        return [
          { name: 'task-a.md', isFile: () => true },
        ];
      }
      return [];
    });

    const result = await handler({ scope: 'project', repo: `${ALT_REPO}.worktrees/feat/clone` });

    const parsed = JSON.parse(result.content[0].text);
    const projectPrompts = parsed.prompts.filter((p: any) => p.scope === 'project');
    expect(projectPrompts).toHaveLength(1);
    expect(projectPrompts[0].name).toBe('task-a');
  });

  it('should not affect global scope when repo param is provided', async () => {
    mocks.execSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('--git-common-dir')) {
        return `${ALT_REPO}/.git\n`;
      }
      return '';
    });

    mocks.fsPromises.readdir.mockImplementation(async (dir: string) => {
      if (typeof dir === 'string' && dir === path.join('/home/user/.lumi-ops', '.prompts')) {
        return [
          { name: 'global-task.md', isFile: () => true },
        ];
      }
      return [];
    });

    const result = await handler({ scope: 'global', repo: ALT_REPO });

    const parsed = JSON.parse(result.content[0].text);
    const globalPrompts = parsed.prompts.filter((p: any) => p.scope === 'global');
    expect(globalPrompts).toHaveLength(1);
    expect(globalPrompts[0].name).toBe('global-task');
  });

  it('should use default rootDir when repo resolves to ROOT_DIR', async () => {
    mocks.execSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('--git-common-dir')) {
        return `${ROOT_DIR}/.git\n`;
      }
      return '';
    });

    mocks.fsPromises.readdir.mockImplementation(async (dir: string) => {
      if (typeof dir === 'string' && dir === path.join(ROOT_DIR, '.prompts')) {
        return [
          { name: 'default-task.md', isFile: () => true },
        ];
      }
      return [];
    });

    const result = await handler({ scope: 'project', repo: ROOT_DIR });

    const parsed = JSON.parse(result.content[0].text);
    const projectPrompts = parsed.prompts.filter((p: any) => p.scope === 'project');
    expect(projectPrompts).toHaveLength(1);
    expect(projectPrompts[0].name).toBe('default-task');
  });
});

// ---------------------------------------------------------------------------
// repo parameter tests — save_prompt
// ---------------------------------------------------------------------------

describe('save_prompt with repo parameter', () => {
  let handler: ToolHandler;
  const ALT_REPO = '/home/user/other-repo';

  beforeEach(() => {
    vi.clearAllMocks();
    handler = getToolHandler('save_prompt');
    mocks.fsPromises.mkdir.mockResolvedValue(undefined);
    mocks.fsPromises.writeFile.mockResolvedValue(undefined);
  });

  it('should save project-scope prompt to resolved repo when repo param is provided', async () => {
    mocks.execSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('--git-common-dir')) {
        return `${ALT_REPO}/.git\n`;
      }
      return '';
    });

    const result = await handler({
      name: 'my task',
      content: '# Task prompt',
      scope: 'project',
      repo: `${ALT_REPO}.worktrees/feat/clone`,
    });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.path).toBe(path.join(ALT_REPO, '.prompts', 'my-task.md'));
    expect(mocks.fsPromises.writeFile).toHaveBeenCalledWith(
      path.join(ALT_REPO, '.prompts', 'my-task.md'),
      '# Task prompt',
    );
  });

  it('should not affect global scope when repo param is provided', async () => {
    mocks.execSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('--git-common-dir')) {
        return `${ALT_REPO}/.git\n`;
      }
      return '';
    });

    const result = await handler({
      name: 'global-thing',
      content: '# Global prompt',
      scope: 'global',
      repo: ALT_REPO,
    });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    // Global scope should use ~/.lumi-ops/.prompts/ regardless of repo param
    expect(parsed.path).toBe(path.join('/home/user/.lumi-ops', '.prompts', 'global-thing.md'));
  });

  it('should use default rootDir when repo resolves to ROOT_DIR', async () => {
    mocks.execSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('--git-common-dir')) {
        return `${ROOT_DIR}/.git\n`;
      }
      return '';
    });

    const result = await handler({
      name: 'fallback task',
      content: '# Fallback',
      scope: 'project',
      repo: ROOT_DIR,
    });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.path).toBe(path.join(ROOT_DIR, '.prompts', 'fallback-task.md'));
  });

  it('should save generated prompt to _generated/ in resolved repo', async () => {
    mocks.execSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('--git-common-dir')) {
        return `${ALT_REPO}/.git\n`;
      }
      return '';
    });

    const result = await handler({
      name: 'auto prompt',
      content: '# Generated',
      scope: 'project',
      generated: true,
      repo: ALT_REPO,
    });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.path).toBe(path.join(ALT_REPO, '.prompts', '_generated', 'auto-prompt.md'));
    expect(parsed.generated).toBe(true);
  });
});

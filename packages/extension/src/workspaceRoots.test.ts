import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mock vscode module ---
const mockWorkspaceFolders: any[] = [];

vi.mock('vscode', () => ({
  workspace: {
    get workspaceFolders() { return mockWorkspaceFolders.length > 0 ? mockWorkspaceFolders : undefined; },
  },
  window: {
    showQuickPick: vi.fn(),
  },
}));

// --- Mock fs ---
const mockRealpathSync = vi.fn();

vi.mock('fs', () => ({
  realpathSync: (...args: any[]) => mockRealpathSync(...args),
}));

// --- Mock child_process ---
const mockExecSync = vi.fn();

vi.mock('child_process', () => ({
  execSync: (...args: any[]) => mockExecSync(...args),
}));

import { resolveWorkspaceRoots, pickRoot } from './workspaceRoots';
import type { ResolvedRoot } from './workspaceRoots';

function makeFolder(fsPath: string) {
  return { uri: { fsPath } } as any;
}

describe('resolveWorkspaceRoots', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWorkspaceFolders.length = 0;
    // Default: realpath returns the path unchanged
    mockRealpathSync.mockImplementation((p: string) => p);
    // Default: git rev-parse succeeds (is a git repo)
    mockExecSync.mockReturnValue('.git');
  });

  it('returns empty array when no workspace folders', () => {
    const result = resolveWorkspaceRoots();
    expect(result).toEqual([]);
  });

  it('returns single root for a single workspace folder', () => {
    mockWorkspaceFolders.push(makeFolder('/projects/my-repo'));
    const result = resolveWorkspaceRoots();
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      rootPath: '/projects/my-repo',
      cloneWorkspacePath: undefined,
      shadowBranchName: undefined,
      isClone: false,
    });
  });

  it('resolves symlinks', () => {
    mockWorkspaceFolders.push(makeFolder('/symlink/my-repo'));
    mockRealpathSync.mockReturnValue('/real/my-repo');
    const result = resolveWorkspaceRoots();
    expect(result[0].rootPath).toBe('/real/my-repo');
  });

  it('detects clone in .worktrees/ directory', () => {
    mockWorkspaceFolders.push(makeFolder('/projects/my-repo.worktrees/feat/new-feature'));
    mockExecSync.mockReturnValue('feat/new-feature');
    const result = resolveWorkspaceRoots();
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      rootPath: '/projects/my-repo',
      cloneWorkspacePath: '/projects/my-repo.worktrees/feat/new-feature',
      shadowBranchName: 'feat/new-feature',
      isClone: true,
    });
  });

  it('deduplicates root repo and its clone worktree', () => {
    mockWorkspaceFolders.push(
      makeFolder('/projects/my-repo'),
      makeFolder('/projects/my-repo.worktrees/feat/x'),
    );
    mockExecSync.mockReturnValue('feat/x');
    const result = resolveWorkspaceRoots();
    // Should merge into a single entry
    expect(result).toHaveLength(1);
    expect(result[0].rootPath).toBe('/projects/my-repo');
  });

  it('preserves clone info when root appears first', () => {
    mockWorkspaceFolders.push(
      makeFolder('/projects/my-repo'),
      makeFolder('/projects/my-repo.worktrees/feat/x'),
    );
    mockExecSync.mockReturnValue('feat/x');
    const result = resolveWorkspaceRoots();
    expect(result[0].isClone).toBe(true);
    expect(result[0].cloneWorkspacePath).toBe('/projects/my-repo.worktrees/feat/x');
    expect(result[0].shadowBranchName).toBe('feat/x');
  });

  it('keeps separate entries for different repos', () => {
    mockWorkspaceFolders.push(
      makeFolder('/projects/repo-a'),
      makeFolder('/projects/repo-b'),
    );
    const result = resolveWorkspaceRoots();
    expect(result).toHaveLength(2);
    expect(result[0].rootPath).toBe('/projects/repo-a');
    expect(result[1].rootPath).toBe('/projects/repo-b');
  });

  it('skips non-git folders', () => {
    mockWorkspaceFolders.push(
      makeFolder('/projects/my-repo'),
      makeFolder('/projects/not-a-repo'),
    );
    // First call succeeds (git repo), second throws (not a git repo)
    mockExecSync
      .mockReturnValueOnce('.git')
      .mockImplementationOnce(() => { throw new Error('not a git repo'); });
    const result = resolveWorkspaceRoots();
    expect(result).toHaveLength(1);
    expect(result[0].rootPath).toBe('/projects/my-repo');
  });

  it('handles failed realpath gracefully', () => {
    mockWorkspaceFolders.push(makeFolder('/projects/my-repo'));
    mockRealpathSync.mockImplementation(() => { throw new Error('ENOENT'); });
    const result = resolveWorkspaceRoots();
    // Falls back to original path
    expect(result[0].rootPath).toBe('/projects/my-repo');
  });

  it('handles failed branch detection gracefully for clones', () => {
    mockWorkspaceFolders.push(makeFolder('/projects/my-repo.worktrees/feat/x'));
    mockExecSync.mockImplementation(() => { throw new Error('HEAD detached'); });
    const result = resolveWorkspaceRoots();
    expect(result[0].isClone).toBe(true);
    expect(result[0].shadowBranchName).toBeUndefined();
  });

  it('deduplicates multiple clones from same repo', () => {
    mockWorkspaceFolders.push(
      makeFolder('/projects/my-repo.worktrees/feat/a'),
      makeFolder('/projects/my-repo.worktrees/feat/b'),
    );
    mockExecSync.mockReturnValueOnce('feat/a').mockReturnValueOnce('feat/b');
    const result = resolveWorkspaceRoots();
    // Both resolve to same root — deduplicated
    expect(result).toHaveLength(1);
    expect(result[0].rootPath).toBe('/projects/my-repo');
    // First clone info wins
    expect(result[0].shadowBranchName).toBe('feat/a');
  });
});

describe('pickRoot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns undefined for empty array', async () => {
    const result = await pickRoot([]);
    expect(result).toBeUndefined();
  });

  it('auto-selects when only one root', async () => {
    const roots: ResolvedRoot[] = [
      { rootPath: '/projects/my-repo', isClone: false },
    ];
    const result = await pickRoot(roots);
    expect(result).toBe('/projects/my-repo');
  });

  it('shows QuickPick for multiple roots', async () => {
    const { window } = await import('vscode');
    const mockShowQuickPick = vi.mocked(window.showQuickPick);
    mockShowQuickPick.mockResolvedValue({ label: 'repo-b', description: '/projects/repo-b', rootPath: '/projects/repo-b' } as any);

    const roots: ResolvedRoot[] = [
      { rootPath: '/projects/repo-a', isClone: false },
      { rootPath: '/projects/repo-b', isClone: false },
    ];
    const result = await pickRoot(roots);

    expect(mockShowQuickPick).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ label: 'repo-a' }),
        expect.objectContaining({ label: 'repo-b' }),
      ]),
      expect.objectContaining({ placeHolder: 'Select repository' }),
    );
    expect(result).toBe('/projects/repo-b');
  });

  it('returns undefined when user cancels QuickPick', async () => {
    const { window } = await import('vscode');
    const mockShowQuickPick = vi.mocked(window.showQuickPick);
    mockShowQuickPick.mockResolvedValue(undefined);

    const roots: ResolvedRoot[] = [
      { rootPath: '/projects/repo-a', isClone: false },
      { rootPath: '/projects/repo-b', isClone: false },
    ];
    const result = await pickRoot(roots);
    expect(result).toBeUndefined();
  });
});

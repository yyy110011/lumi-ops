import { describe, it, expect, vi } from 'vitest';

// --- Mock vscode module ---
vi.mock('vscode', () => ({
  TreeItem: class {
    id?: string;
    description?: string;
    tooltip?: string;
    iconPath?: any;
    command?: any;
    contextValue?: string;
    constructor(public label: string, public collapsibleState: number) {}
  },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  ThemeIcon: class {
    constructor(public id: string, public color?: any) {}
  },
  ThemeColor: class {
    constructor(public id: string) {}
  },
  Uri: { file: (path: string) => ({ fsPath: path, scheme: 'file' }) },
  EventEmitter: class {
    event = () => {};
    fire() {}
  },
}));

// --- Mock @lumi-ops/cli ---
vi.mock('@lumi-ops/cli', () => ({
  parseWorktrees: vi.fn(),
  GitUtils: vi.fn(),
  getRepoStorageDir: vi.fn(() => '/fake/.worktrees'),
  METADATA_FILE: '.lumi-metadata.json',
}));

// --- Mock fs ---
vi.mock('fs', () => ({
  readFileSync: vi.fn(() => '{}'),
}));

import { ShadowItem } from './ShadowTreeProvider';
import type { EnrichedClone } from './ShadowTreeProvider';

const NONE = 0; // TreeItemCollapsibleState.None

function makeClone(overrides: Partial<EnrichedClone> = {}): EnrichedClone {
  return {
    dirName: 'feat/test',
    currentBranch: 'feat/test',
    branch: 'feat/test',
    path: '/repo.worktrees/feat/test',
    isShadow: true,
    isMain: false,
    repoRoot: '/repo',
    ...overrides,
  };
}

describe('ShadowItem', () => {
  // ─── Current Branch (Root) Row ───

  describe('currentBranch role', () => {
    it('shows ★ when current window is at root (no currentWorkspacePath)', () => {
      const item = new ShadowItem('main', NONE, makeClone({ dirName: 'root', currentBranch: 'main', branch: 'main', path: '/repo', isShadow: false }), 'currentBranch', '/ext', undefined);
      expect(item.description).toBe('Worktree Root · ★');
    });

    it('does NOT show ★ when current window is in a clone', () => {
      const item = new ShadowItem('main', NONE, makeClone({ dirName: 'root', currentBranch: 'main', branch: 'main', path: '/repo', isShadow: false }), 'currentBranch', '/ext', '/repo.worktrees/feat/test');
      expect(item.description).toBe('Worktree Root');
    });

    it('always uses returnToRoot command', () => {
      const item = new ShadowItem('main', NONE, makeClone({ dirName: 'root', currentBranch: 'main', branch: 'main', path: '/repo', isShadow: false }), 'currentBranch', '/ext', undefined);
      expect(item.command?.command).toBe('lumi-ops.returnToRoot');
    });

    it('shows conflict prefix when hasConflict is true', () => {
      const item = new ShadowItem('main', NONE, makeClone({ dirName: 'root', currentBranch: 'main', branch: 'main', path: '/repo', isShadow: false, hasConflict: true }), 'currentBranch', '/ext', undefined);
      expect(item.description).toBe('⚠️ · Worktree Root · ★');
    });
  });

  // ─── Shadow Clone Row ───

  describe('shadowClone role', () => {
    it('shows ★ when clone path matches current workspace', () => {
      const clonePath = '/repo.worktrees/feat/test';
      const item = new ShadowItem('feat/test', NONE, makeClone({ path: clonePath }), 'shadowClone', '/ext', clonePath);
      expect(item.description).toContain('★');
    });

    it('does NOT show ★ when clone path does not match current workspace', () => {
      const item = new ShadowItem('feat/test', NONE, makeClone(), 'shadowClone', '/ext', '/repo.worktrees/feat/other');
      expect(item.description).not.toContain('★');
    });

    it('does NOT show ★ when no currentWorkspacePath', () => {
      const item = new ShadowItem('feat/test', NONE, makeClone(), 'shadowClone', '/ext', undefined);
      expect(item.description).not.toContain('★');
    });

    it('always uses cycleReviewStatus command with composite key', () => {
      const item = new ShadowItem('feat/test', NONE, makeClone(), 'shadowClone', '/ext', undefined);
      expect(item.command?.command).toBe('lumi-ops.cycleReviewStatus');
      expect(item.command?.arguments).toEqual(['/repo::feat/test']);
    });

    it('shows baseBranch in description', () => {
      const item = new ShadowItem('feat/test', NONE, makeClone({ baseBranch: 'develop' }), 'shadowClone', '/ext', undefined);
      expect(item.description).toBe('← develop');
    });

    it('shows "Shadow Clone" when no baseBranch', () => {
      const item = new ShadowItem('feat/test', NONE, makeClone({ baseBranch: undefined }), 'shadowClone', '/ext', undefined);
      expect(item.description).toBe('Shadow Clone');
    });

    it('shows detached prefix for rebasing clones', () => {
      const item = new ShadowItem('feat/test', NONE, makeClone({ isDetached: true, baseBranch: 'main' }), 'shadowClone', '/ext', undefined);
      expect(item.description).toBe('🔀 rebasing · ← main');
    });

    it('shows conflict prefix', () => {
      const item = new ShadowItem('feat/test', NONE, makeClone({ hasConflict: true, baseBranch: 'main' }), 'shadowClone', '/ext', undefined);
      expect(item.description).toBe('⚠️ · ← main');
    });

    it('combines conflict + detached + baseBranch + ★', () => {
      const clonePath = '/repo.worktrees/feat/test';
      const item = new ShadowItem('feat/test', NONE, makeClone({
        path: clonePath, hasConflict: true, isDetached: true, baseBranch: 'main'
      }), 'shadowClone', '/ext', clonePath);
      expect(item.description).toBe('⚠️ · 🔀 rebasing · ← main · ★');
    });

    it('uses dirName for stable item ID', () => {
      const item = new ShadowItem('feat/test', NONE, makeClone(), 'shadowClone', '/ext', undefined);
      expect(item.id).toBe('shadow-feat/test-shadowClone');
    });

    it('shows branch drift indicator when currentBranch differs from dirName', () => {
      const item = new ShadowItem('feat/task', NONE, makeClone({
        dirName: 'feat/task',
        currentBranch: 'develop',
        branch: 'develop',
        baseBranch: 'main',
      }), 'shadowClone', '/ext', undefined);
      expect(item.description).toBe('⚠️ on: develop · ← main');
    });

    it('does NOT show branch drift indicator when currentBranch matches dirName', () => {
      const item = new ShadowItem('feat/test', NONE, makeClone({
        baseBranch: 'main',
      }), 'shadowClone', '/ext', undefined);
      expect(item.description).toBe('← main');
      expect(item.description).not.toContain('on:');
    });

    it('shows rebase prefix when needsRebase is true', () => {
      const item = new ShadowItem('feat/test', NONE, makeClone({ needsRebase: true, baseBranch: 'main' }), 'shadowClone', '/ext', undefined);
      expect(item.description).toBe('⟲ rebase · ← main');
    });

    it('does not show rebase prefix when needsRebase is false', () => {
      const item = new ShadowItem('feat/test', NONE, makeClone({ needsRebase: false, baseBranch: 'main' }), 'shadowClone', '/ext', undefined);
      expect(item.description).toBe('← main');
    });

    it('combines conflict + rebase + detached + baseBranch + ★', () => {
      const clonePath = '/repo.worktrees/feat/test';
      const item = new ShadowItem('feat/test', NONE, makeClone({
        path: clonePath, hasConflict: true, needsRebase: true, isDetached: true, baseBranch: 'main'
      }), 'shadowClone', '/ext', clonePath);
      expect(item.description).toBe('⚠️ · ⟲ rebase · 🔀 rebasing · ← main · ★');
    });

    it('sets contextValue to shadowClone for normal clones', () => {
      const item = new ShadowItem('feat/test', NONE, makeClone(), 'shadowClone', '/ext', undefined);
      expect(item.contextValue).toBe('shadowClone');
    });

    it('sets contextValue to shadowClone-detached for detached clones', () => {
      const item = new ShadowItem('feat/test', NONE, makeClone({ isDetached: true }), 'shadowClone', '/ext', undefined);
      expect(item.contextValue).toBe('shadowClone-detached');
    });

    it('sets contextValue to currentBranch for root entry', () => {
      const item = new ShadowItem('main', NONE, makeClone({ dirName: 'root', currentBranch: 'main', path: '/repo', isShadow: false }), 'currentBranch', '/ext', undefined);
      expect(item.contextValue).toBe('currentBranch');
    });
  });
});

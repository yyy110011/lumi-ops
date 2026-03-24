import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setupAutoCloseWatcher, AutoCloseWatcherDeps } from './autoCloseWatcher';

function createMockDeps(overrides: Partial<AutoCloseWatcherDeps> = {}): {
  deps: AutoCloseWatcherDeps;
  mockCloseWindow: ReturnType<typeof vi.fn>;
  watcherClose: ReturnType<typeof vi.fn>;
  triggerWatch: (event: string, filename: string | null) => void;
} {
  let listener: ((event: string, filename: string | null) => void) | undefined;
  const watcherClose = vi.fn();
  const mockCloseWindow = vi.fn();

  const deps: AutoCloseWatcherDeps = {
    existsSync: vi.fn().mockReturnValue(true),
    watch: vi.fn((_dir, cb) => {
      listener = cb;
      return { close: watcherClose } as any;
    }),
    closeWindow: mockCloseWindow,
    ...overrides,
  };

  return {
    deps,
    mockCloseWindow,
    watcherClose,
    triggerWatch: (event: string, filename: string | null) => {
      listener?.(event, filename);
    },
  };
}

describe('setupAutoCloseWatcher', () => {
  it('watches the parent directory of the worktree path', () => {
    const { deps } = createMockDeps();
    setupAutoCloseWatcher('/repo.worktrees/feat/my-task', deps);

    expect(deps.watch).toHaveBeenCalledWith(
      '/repo.worktrees/feat',
      expect.any(Function),
    );
  });

  it('returns a disposable that closes the watcher', () => {
    const { deps, watcherClose } = createMockDeps();
    const result = setupAutoCloseWatcher('/repo.worktrees/feat/my-task', deps);

    expect(result).toBeDefined();
    result!.dispose();
    expect(watcherClose).toHaveBeenCalled();
  });

  it('closes window when directory is removed', () => {
    const { deps, mockCloseWindow, triggerWatch } = createMockDeps({
      existsSync: vi.fn().mockReturnValue(false), // directory no longer exists
    });

    setupAutoCloseWatcher('/repo.worktrees/feat/my-task', deps);
    triggerWatch('rename', 'my-task');

    expect(mockCloseWindow).toHaveBeenCalledTimes(1);
  });

  it('closes the watcher before closing the window', () => {
    const callOrder: string[] = [];
    const watcherClose = vi.fn(() => callOrder.push('watcher.close'));
    const mockCloseWindow = vi.fn(() => callOrder.push('closeWindow'));

    let listener: any;
    const deps: AutoCloseWatcherDeps = {
      existsSync: vi.fn().mockReturnValue(false),
      watch: vi.fn((_dir, cb) => {
        listener = cb;
        return { close: watcherClose } as any;
      }),
      closeWindow: mockCloseWindow,
    };

    setupAutoCloseWatcher('/repo.worktrees/feat/my-task', deps);
    listener('rename', 'my-task');

    expect(callOrder).toEqual(['watcher.close', 'closeWindow']);
  });

  it('does NOT close window when a different file changes', () => {
    const { deps, mockCloseWindow, triggerWatch } = createMockDeps({
      existsSync: vi.fn().mockReturnValue(false),
    });

    setupAutoCloseWatcher('/repo.worktrees/feat/my-task', deps);
    triggerWatch('rename', 'other-branch');

    expect(mockCloseWindow).not.toHaveBeenCalled();
  });

  it('does NOT close window when directory still exists (false positive)', () => {
    const { deps, mockCloseWindow, triggerWatch } = createMockDeps({
      existsSync: vi.fn().mockReturnValue(true), // directory still exists
    });

    setupAutoCloseWatcher('/repo.worktrees/feat/my-task', deps);
    triggerWatch('rename', 'my-task');

    expect(mockCloseWindow).not.toHaveBeenCalled();
  });

  it('does NOT close window when filename is null', () => {
    const { deps, mockCloseWindow, triggerWatch } = createMockDeps({
      existsSync: vi.fn().mockReturnValue(false),
    });

    setupAutoCloseWatcher('/repo.worktrees/feat/my-task', deps);
    triggerWatch('rename', null);

    expect(mockCloseWindow).not.toHaveBeenCalled();
  });

  it('returns undefined when watch throws', () => {
    const deps: AutoCloseWatcherDeps = {
      existsSync: vi.fn(),
      watch: vi.fn(() => { throw new Error('ENOENT'); }),
      closeWindow: vi.fn(),
    };

    const result = setupAutoCloseWatcher('/repo.worktrees/feat/my-task', deps);
    expect(result).toBeUndefined();
  });

  it('handles simple branch names (no slash prefix)', () => {
    const { deps } = createMockDeps();
    setupAutoCloseWatcher('/repo.worktrees/fix-bug', deps);

    expect(deps.watch).toHaveBeenCalledWith(
      '/repo.worktrees',
      expect.any(Function),
    );
  });

  it('handles deeply nested branch names', () => {
    const { deps, mockCloseWindow, triggerWatch } = createMockDeps({
      existsSync: vi.fn().mockReturnValue(false),
    });

    setupAutoCloseWatcher('/repo.worktrees/team/user/feature', deps);
    // Only the basename is watched
    expect(deps.watch).toHaveBeenCalledWith(
      '/repo.worktrees/team/user',
      expect.any(Function),
    );

    triggerWatch('rename', 'feature');
    expect(mockCloseWindow).toHaveBeenCalled();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  setupRevisionFeedbackWatcher,
  RevisionFeedbackWatcherDeps,
} from './revisionFeedbackWatcher';

const REVISION_PROMPT =
  'You have review feedback. Read @.lumi/MISSION.md → @.lumi/MISSION_COMPLETE.md → @.lumi/REVIEW_FEEDBACK.md, then fix the issues listed in .lumi/REVIEW_FEEDBACK.md. After fixing, update .lumi/MISSION_COMPLETE.md.';

function createMockDeps(overrides: Partial<RevisionFeedbackWatcherDeps> = {}): {
  deps: RevisionFeedbackWatcherDeps;
  watcherClose: ReturnType<typeof vi.fn>;
  triggerWatch: (event: string, filename: string | null) => void;
} {
  let listener: ((event: string, filename: string | null) => void) | undefined;
  const watcherClose = vi.fn();

  const deps: RevisionFeedbackWatcherDeps = {
    existsSync: vi.fn().mockReturnValue(true),
    watch: vi.fn((_dir, cb) => {
      listener = cb;
      return { close: watcherClose } as any;
    }),
    mkdirSync: vi.fn(),
    showRevisionPopup: vi.fn().mockResolvedValue(undefined),
    copyToClipboard: vi.fn().mockResolvedValue(undefined),
    showConfirmation: vi.fn(),
    ...overrides,
  };

  return {
    deps,
    watcherClose,
    triggerWatch: (event: string, filename: string | null) => {
      listener?.(event, filename);
    },
  };
}

describe('setupRevisionFeedbackWatcher', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // --- Setup & Teardown ---

  it('watches the .lumi/ directory inside the workspace path', () => {
    const { deps } = createMockDeps();
    setupRevisionFeedbackWatcher('/workspace/my-clone', deps);

    expect(deps.watch).toHaveBeenCalledWith(
      expect.stringMatching(/my-clone[/\\]\.lumi$/),
      expect.any(Function),
    );
  });

  it('creates .lumi/ directory if it does not exist', () => {
    const { deps } = createMockDeps({
      existsSync: vi.fn().mockReturnValue(false),
    });
    setupRevisionFeedbackWatcher('/workspace/my-clone', deps);

    expect(deps.mkdirSync).toHaveBeenCalledWith(
      expect.stringMatching(/my-clone[/\\]\.lumi$/),
      { recursive: true },
    );
  });

  it('does NOT call mkdirSync if .lumi/ already exists', () => {
    const { deps } = createMockDeps({
      existsSync: vi.fn().mockReturnValue(true),
    });
    setupRevisionFeedbackWatcher('/workspace/my-clone', deps);

    expect(deps.mkdirSync).not.toHaveBeenCalled();
  });

  it('returns a disposable that closes the watcher', () => {
    const { deps, watcherClose } = createMockDeps();
    const result = setupRevisionFeedbackWatcher('/workspace/my-clone', deps);

    expect(result).toBeDefined();
    result!.dispose();
    expect(watcherClose).toHaveBeenCalled();
  });

  it('returns undefined when watch throws', () => {
    const deps: RevisionFeedbackWatcherDeps = {
      existsSync: vi.fn().mockReturnValue(true),
      watch: vi.fn(() => {
        throw new Error('ENOENT');
      }),
      mkdirSync: vi.fn(),
      showRevisionPopup: vi.fn().mockResolvedValue(undefined),
      copyToClipboard: vi.fn().mockResolvedValue(undefined),
      showConfirmation: vi.fn(),
    };

    const result = setupRevisionFeedbackWatcher('/workspace/my-clone', deps);
    expect(result).toBeUndefined();
  });

  // --- Filename Filtering ---

  it('ignores events for files other than REVIEW_FEEDBACK.md', async () => {
    vi.useFakeTimers();
    const { deps, triggerWatch } = createMockDeps();
    setupRevisionFeedbackWatcher('/workspace/my-clone', deps);

    triggerWatch('change', 'MISSION.md');
    triggerWatch('change', 'MISSION_COMPLETE.md');
    triggerWatch('change', 'some-other-file.txt');

    await vi.advanceTimersByTimeAsync(300);

    expect(deps.showRevisionPopup).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('ignores events when filename is null', async () => {
    vi.useFakeTimers();
    const { deps, triggerWatch } = createMockDeps();
    setupRevisionFeedbackWatcher('/workspace/my-clone', deps);

    triggerWatch('change', null);

    await vi.advanceTimersByTimeAsync(300);

    expect(deps.showRevisionPopup).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  // --- Existence Check ---

  it('does NOT show popup when REVIEW_FEEDBACK.md does not exist (deletion event)', async () => {
    vi.useFakeTimers();

    // existsSync returns true for .lumi/ dir check, false for the feedback file check
    const existsSyncMock = vi.fn()
      .mockReturnValueOnce(true) // .lumi/ dir exists
      .mockReturnValue(false);  // REVIEW_FEEDBACK.md does NOT exist

    const { deps, triggerWatch } = createMockDeps({
      existsSync: existsSyncMock,
    });
    setupRevisionFeedbackWatcher('/workspace/my-clone', deps);

    triggerWatch('rename', 'REVIEW_FEEDBACK.md');

    await vi.advanceTimersByTimeAsync(300);

    expect(deps.showRevisionPopup).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  // --- Happy Path ---

  it('shows revision popup when REVIEW_FEEDBACK.md is created/modified', async () => {
    vi.useFakeTimers();
    const { deps, triggerWatch } = createMockDeps({
      existsSync: vi.fn().mockReturnValue(true),
    });
    setupRevisionFeedbackWatcher('/workspace/my-clone', deps);

    triggerWatch('change', 'REVIEW_FEEDBACK.md');

    await vi.advanceTimersByTimeAsync(300);

    expect(deps.showRevisionPopup).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('copies the revision prompt to clipboard when user clicks "Copy Prompt"', async () => {
    vi.useFakeTimers();
    const { deps, triggerWatch } = createMockDeps({
      existsSync: vi.fn().mockReturnValue(true),
      showRevisionPopup: vi.fn().mockResolvedValue('Copy Prompt'),
    });
    setupRevisionFeedbackWatcher('/workspace/my-clone', deps);

    triggerWatch('change', 'REVIEW_FEEDBACK.md');

    await vi.advanceTimersByTimeAsync(300);

    expect(deps.copyToClipboard).toHaveBeenCalledWith(REVISION_PROMPT);
    vi.useRealTimers();
  });

  it('shows confirmation message after copying', async () => {
    vi.useFakeTimers();
    const { deps, triggerWatch } = createMockDeps({
      existsSync: vi.fn().mockReturnValue(true),
      showRevisionPopup: vi.fn().mockResolvedValue('Copy Prompt'),
    });
    setupRevisionFeedbackWatcher('/workspace/my-clone', deps);

    triggerWatch('change', 'REVIEW_FEEDBACK.md');

    await vi.advanceTimersByTimeAsync(300);

    expect(deps.showConfirmation).toHaveBeenCalledWith(
      '✅ Revision prompt copied to clipboard!',
    );
    vi.useRealTimers();
  });

  it('does NOT copy when user dismisses the popup', async () => {
    vi.useFakeTimers();
    const { deps, triggerWatch } = createMockDeps({
      existsSync: vi.fn().mockReturnValue(true),
      showRevisionPopup: vi.fn().mockResolvedValue(undefined),
    });
    setupRevisionFeedbackWatcher('/workspace/my-clone', deps);

    triggerWatch('change', 'REVIEW_FEEDBACK.md');

    await vi.advanceTimersByTimeAsync(300);

    expect(deps.showRevisionPopup).toHaveBeenCalled();
    expect(deps.copyToClipboard).not.toHaveBeenCalled();
    expect(deps.showConfirmation).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  // --- Debounce ---

  it('debounces rapid file events — only one popup shown for multiple rapid triggers', async () => {
    vi.useFakeTimers();
    const { deps, triggerWatch } = createMockDeps({
      existsSync: vi.fn().mockReturnValue(true),
    });
    setupRevisionFeedbackWatcher('/workspace/my-clone', deps);

    // Fire multiple rapid events
    triggerWatch('change', 'REVIEW_FEEDBACK.md');
    triggerWatch('change', 'REVIEW_FEEDBACK.md');
    triggerWatch('change', 'REVIEW_FEEDBACK.md');

    await vi.advanceTimersByTimeAsync(300);

    expect(deps.showRevisionPopup).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('dispose clears the debounce timer', async () => {
    vi.useFakeTimers();
    const { deps, triggerWatch } = createMockDeps({
      existsSync: vi.fn().mockReturnValue(true),
    });
    const result = setupRevisionFeedbackWatcher('/workspace/my-clone', deps);

    triggerWatch('change', 'REVIEW_FEEDBACK.md');

    // Dispose before debounce timer fires
    result!.dispose();

    await vi.advanceTimersByTimeAsync(300);

    expect(deps.showRevisionPopup).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseDiffStat, toKebabCase, silenceStdout, extractRootFromRootsResponse, resolveMainRepoRoot } from './utils';
import { resolveEffectiveRoot, serverState } from './state';

// ---------------------------------------------------------------------------
// resolveMainRepoRoot
// ---------------------------------------------------------------------------

// We need to mock child_process.execSync for resolveMainRepoRoot tests
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    execSync: vi.fn(actual.execSync),
  };
});

import { execSync } from 'child_process';
const mockExecSync = vi.mocked(execSync);

describe('resolveMainRepoRoot', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should resolve main repo root from a worktree path', () => {
    mockExecSync.mockReturnValueOnce('/home/user/my-repo/.git\n' as any);

    const result = resolveMainRepoRoot('/home/user/my-repo.worktrees/feat/test');

    expect(result).toBe('/home/user/my-repo');
    expect(mockExecSync).toHaveBeenCalledWith(
      'git rev-parse --path-format=absolute --git-common-dir',
      expect.objectContaining({ cwd: '/home/user/my-repo.worktrees/feat/test' }),
    );
  });

  it('should resolve main repo root when already in the main repo', () => {
    mockExecSync.mockReturnValueOnce('/home/user/my-repo/.git\n' as any);

    const result = resolveMainRepoRoot('/home/user/my-repo');

    expect(result).toBe('/home/user/my-repo');
  });

  it('should handle .git/ with trailing slash', () => {
    mockExecSync.mockReturnValueOnce('/home/user/my-repo/.git/\n' as any);

    const result = resolveMainRepoRoot('/some/path');

    expect(result).toBe('/home/user/my-repo');
  });

  it('should fall back to --show-toplevel for bare repos', () => {
    // --git-common-dir returns something that doesn't end with /.git
    mockExecSync.mockReturnValueOnce('/home/user/bare-repo.git\n' as any);
    // Fallback --show-toplevel
    mockExecSync.mockReturnValueOnce('/home/user/bare-repo\n' as any);

    const result = resolveMainRepoRoot('/home/user/bare-repo');

    expect(result).toBe('/home/user/bare-repo');
    expect(mockExecSync).toHaveBeenCalledTimes(2);
  });

  it('should throw if not inside a git repo', () => {
    mockExecSync.mockImplementation(() => {
      throw new Error('fatal: not a git repository');
    });

    expect(() => resolveMainRepoRoot('/tmp/not-a-repo')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// extractRootFromRootsResponse
// ---------------------------------------------------------------------------

describe('extractRootFromRootsResponse', () => {
  it('should extract path from valid file:// URI', () => {
    const result = extractRootFromRootsResponse([
      { uri: 'file:///home/user/project', name: 'My Project' },
    ]);
    expect(result).toBe('/home/user/project');
  });

  it('should use the first root when multiple are provided', () => {
    const result = extractRootFromRootsResponse([
      { uri: 'file:///first/project', name: 'First' },
      { uri: 'file:///second/project', name: 'Second' },
    ]);
    expect(result).toBe('/first/project');
  });

  it('should return null for empty roots array', () => {
    expect(extractRootFromRootsResponse([])).toBeNull();
  });

  it('should return null for non-file URI schemes', () => {
    const result = extractRootFromRootsResponse([
      { uri: 'https://example.com/project', name: 'Remote' },
    ]);
    expect(result).toBeNull();
  });

  it('should handle URI with spaces (percent-encoded)', () => {
    const result = extractRootFromRootsResponse([
      { uri: 'file:///home/user/my%20project' },
    ]);
    expect(result).toBe('/home/user/my project');
  });

  it('should return null for null/undefined roots', () => {
    expect(extractRootFromRootsResponse(null as any)).toBeNull();
    expect(extractRootFromRootsResponse(undefined as any)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseDiffStat
// ---------------------------------------------------------------------------

describe('parseDiffStat', () => {
  it('should parse normal multi-file numstat output', () => {
    const raw = [
      '10\t2\tsrc/index.ts',
      '5\t0\tsrc/utils.ts',
      '0\t3\tREADME.md',
    ].join('\n');

    const result = parseDiffStat(raw);

    expect(result.filesChanged).toBe(3);
    expect(result.insertions).toBe(15);
    expect(result.deletions).toBe(5);
    expect(result.files).toEqual([
      { path: 'src/index.ts', insertions: 10, deletions: 2 },
      { path: 'src/utils.ts', insertions: 5, deletions: 0 },
      { path: 'README.md', insertions: 0, deletions: 3 },
    ]);
  });

  it('should handle empty diff', () => {
    const result = parseDiffStat('');

    expect(result.filesChanged).toBe(0);
    expect(result.insertions).toBe(0);
    expect(result.deletions).toBe(0);
    expect(result.files).toEqual([]);
  });

  it('should handle whitespace-only input', () => {
    const result = parseDiffStat('  \n\n  ');

    expect(result.filesChanged).toBe(0);
    expect(result.insertions).toBe(0);
    expect(result.deletions).toBe(0);
    expect(result.files).toEqual([]);
  });

  it('should handle binary files (- for insertions/deletions)', () => {
    const raw = [
      '-\t-\tassets/logo.png',
      '10\t2\tsrc/index.ts',
      '-\t-\tfonts/inter.woff2',
    ].join('\n');

    const result = parseDiffStat(raw);

    expect(result.filesChanged).toBe(3);
    // Binary files don't contribute to numeric totals
    expect(result.insertions).toBe(10);
    expect(result.deletions).toBe(2);
    expect(result.files).toEqual([
      { path: 'assets/logo.png', insertions: 0, deletions: 0 },
      { path: 'src/index.ts', insertions: 10, deletions: 2 },
      { path: 'fonts/inter.woff2', insertions: 0, deletions: 0 },
    ]);
  });

  it('should handle rename paths ({old => new})', () => {
    const raw = '5\t3\tsrc/{old-name.ts => new-name.ts}';

    const result = parseDiffStat(raw);

    expect(result.filesChanged).toBe(1);
    expect(result.insertions).toBe(5);
    expect(result.deletions).toBe(3);
    expect(result.files[0].path).toBe('src/{old-name.ts => new-name.ts}');
  });

  it('should skip lines with fewer than 3 tab-separated parts', () => {
    const raw = [
      '10\t2\tsrc/index.ts',
      'invalid-line',
      '5\t0\tsrc/utils.ts',
    ].join('\n');

    const result = parseDiffStat(raw);

    expect(result.filesChanged).toBe(2);
    expect(result.files).toHaveLength(2);
  });

  it('should handle file paths containing tabs', () => {
    const raw = '10\t5\tpath\twith\ttabs.ts';

    const result = parseDiffStat(raw);

    expect(result.filesChanged).toBe(1);
    expect(result.files[0].path).toBe('path\twith\ttabs.ts');
    expect(result.files[0].insertions).toBe(10);
    expect(result.files[0].deletions).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// toKebabCase
// ---------------------------------------------------------------------------

describe('toKebabCase', () => {
  it('should convert normal strings to kebab-case', () => {
    expect(toKebabCase('My Prompt')).toBe('my-prompt');
  });

  it('should convert multi-word strings', () => {
    expect(toKebabCase('Add OAuth Login Flow')).toBe('add-oauth-login-flow');
  });

  it('should pass through already kebab-case strings', () => {
    expect(toKebabCase('my-prompt')).toBe('my-prompt');
  });

  it('should strip special characters', () => {
    expect(toKebabCase('Hello, World! (v2)')).toBe('hello-world-v2');
  });

  it('should handle empty string', () => {
    expect(toKebabCase('')).toBe('');
  });

  it('should collapse multiple spaces into single hyphen', () => {
    expect(toKebabCase('too   many    spaces')).toBe('too-many-spaces');
  });

  it('should trim leading/trailing whitespace', () => {
    expect(toKebabCase('  padded name  ')).toBe('padded-name');
  });

  it('should handle strings with only special characters', () => {
    expect(toKebabCase('!@#$%')).toBe('');
  });

  it('should preserve numbers', () => {
    expect(toKebabCase('Phase 2 Plan')).toBe('phase-2-plan');
  });

  it('should handle mixed case', () => {
    expect(toKebabCase('CamelCaseString')).toBe('camelcasestring');
  });
});

// ---------------------------------------------------------------------------
// silenceStdout
// ---------------------------------------------------------------------------

describe('silenceStdout', () => {
  let origLog: typeof console.log;

  beforeEach(() => {
    origLog = console.log;
  });

  afterEach(() => {
    // Ensure console.log is always restored even if test fails
    console.log = origLog;
  });

  it('should redirect console.log to console.error during execution', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let capturedLog: typeof console.log | undefined;

    await silenceStdout(async () => {
      capturedLog = console.log;
    });

    // During execution, console.log should have been console.error
    expect(capturedLog).toBe(console.error);
    errorSpy.mockRestore();
  });

  it('should restore console.log after execution', async () => {
    await silenceStdout(async () => {
      // Do nothing
    });

    expect(console.log).toBe(origLog);
  });

  it('should restore console.log even if fn throws', async () => {
    await expect(
      silenceStdout(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(console.log).toBe(origLog);
  });

  it('should return the value from fn', async () => {
    const result = await silenceStdout(async () => 42);
    expect(result).toBe(42);
  });

  it('should not affect console.error', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const origError = console.error;

    let errorDuringExec: typeof console.error | undefined;
    await silenceStdout(async () => {
      errorDuringExec = console.error;
    });

    // console.error should remain the same spy throughout
    expect(errorDuringExec).toBe(origError);
    errorSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// resolveEffectiveRoot
// ---------------------------------------------------------------------------

describe('resolveEffectiveRoot', () => {
  const ORIGINAL_ROOT = serverState.rootDir;

  beforeEach(() => {
    serverState.rootDir = '/home/user/default-repo';
    vi.restoreAllMocks();
  });

  afterEach(() => {
    serverState.rootDir = ORIGINAL_ROOT;
  });

  it('should resolve main repo root from a valid repo path', () => {
    mockExecSync.mockReturnValueOnce('/home/user/target-repo/.git\n' as any);

    const result = resolveEffectiveRoot('/home/user/target-repo');

    expect(result).toBe('/home/user/target-repo');
  });

  it('should throw descriptive error for invalid path (non-git directory)', () => {
    mockExecSync.mockImplementation(() => {
      throw new Error('fatal: not a git repository');
    });

    expect(() => resolveEffectiveRoot('/some/invalid/path')).toThrow(
      "Could not resolve repo root from path: '/some/invalid/path'"
    );
  });

  it('should throw descriptive error for non-existent path', () => {
    mockExecSync.mockImplementation(() => {
      throw new Error('fatal: cannot change to /nonexistent/path');
    });

    expect(() => resolveEffectiveRoot('/nonexistent/path')).toThrow(
      "Could not resolve repo root from path: '/nonexistent/path'"
    );
  });
});

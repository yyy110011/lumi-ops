import { describe, it, expect } from 'vitest';
import { sanitizeSessionName } from './tmux';

describe('sanitizeSessionName', () => {
  it('sanitizes simple branch name', () => {
    expect(sanitizeSessionName('feat/my-task')).toBe('lumi-feat-my-task');
  });

  it('replaces dots and colons', () => {
    expect(sanitizeSessionName('v1.2.3:hotfix')).toBe('lumi-v1-2-3-hotfix');
  });

  it('replaces spaces and special chars', () => {
    expect(sanitizeSessionName('feat/my task (wip)')).toBe('lumi-feat-my-task--wip-');
  });

  it('preserves underscores and hyphens', () => {
    expect(sanitizeSessionName('feat_my-task')).toBe('lumi-feat_my-task');
  });

  it('handles deeply nested branch names', () => {
    expect(sanitizeSessionName('org/team/feat/deep')).toBe('lumi-org-team-feat-deep');
  });
});

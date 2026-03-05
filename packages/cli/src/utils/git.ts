import { SimpleGit, simpleGit } from 'simple-git';
import * as path from 'path';
import * as fs from 'fs-extra';

export class GitUtils {
  private git: SimpleGit;

  constructor(private rootDir: string) {
    this.git = simpleGit(rootDir);
  }

  async isGitRepo(): Promise<boolean> {
    try {
      return await this.git.checkIsRepo();
    } catch {
      return false;
    }
  }

  async getCurrentBranch(): Promise<string> {
    const branch = await this.git.raw(['branch', '--show-current']);
    return branch.trim();
  }

  async hasCommits(): Promise<boolean> {
    try {
      await this.git.raw(['rev-parse', 'HEAD']);
      return true;
    } catch {
      return false;
    }
  }

  async listBranches(): Promise<string[]> {
    const output = await this.git.raw(['branch', '--list', '--format=%(refname:short)']);
    return output.split('\n').map(b => b.trim()).filter(Boolean);
  }

  async branchExists(branchName: string): Promise<boolean> {
    const branches = await this.listBranches();
    return branches.includes(branchName);
  }

  async addWorktree(branchName: string, targetPath: string, baseBranch: string = 'main'): Promise<void> {
    // git worktree add -b <branchName> <targetPath> <baseBranch>
    await this.git.raw(['worktree', 'add', '-b', branchName, targetPath, baseBranch]);
  }

  async addWorktreeExisting(targetPath: string, branchName: string): Promise<void> {
    // git worktree add <targetPath> <branchName>
    await this.git.raw(['worktree', 'add', targetPath, branchName]);
  }

  async removeWorktree(targetPath: string, force: boolean = false): Promise<void> {
    const args = ['worktree', 'remove', targetPath];
    if (force) args.push('--force');
    await this.git.raw(args);
  }

  async listWorktrees(): Promise<string[]> {
    const output = await this.git.raw(['worktree', 'list', '--porcelain']);
    return output.split('\n\n').filter(Boolean);
  }

  async deleteBranch(branchName: string, force: boolean = false): Promise<void> {
    const args = ['branch', force ? '-D' : '-d', branchName];
    await this.git.raw(args);
  }

  async mergeSquash(branchName: string): Promise<void> {
    await this.git.merge(['--squash', branchName]);
  }

  async commit(message: string): Promise<void> {
    await this.git.commit(message);
  }

  async listRemoteBranches(): Promise<string[]> {
    const output = await this.git.raw(['branch', '-r', '--format=%(refname:short)']);
    return output
      .split('\n')
      .map(b => b.trim())
      .filter(b => b && b.includes('/') && !b.endsWith('/HEAD'));
  }

  async fetchRemote(remote?: string): Promise<void> {
    const args = ['fetch'];
    if (remote) args.push(remote);
    await this.git.raw(args);
  }

  async checkoutBranch(branchName: string): Promise<void> {
    await this.git.raw(['checkout', branchName]);
  }

  /**
   * Fetch a remote branch and create a local tracking branch without checkout.
   * Equivalent to: git fetch origin <branchName>:refs/heads/<branchName>
   */
  async fetchBranch(branchName: string, remote: string = 'origin'): Promise<void> {
    await this.git.raw(['fetch', remote, `${branchName}:refs/heads/${branchName}`]);
  }

  /**
   * Check if the working tree has unmerged (conflicted) files.
   */
  async hasConflicts(): Promise<boolean> {
    try {
      const output = await this.git.raw(['status', '--porcelain']);
      return output.split('\n').some(line => /^(UU|AA|DD|DU|UD)/.test(line));
    } catch {
      return false;
    }
  }

  /**
   * Prune stale worktree references (e.g. after manual deletion of worktree directories).
   */
  async pruneWorktrees(): Promise<void> {
    await this.git.raw(['worktree', 'prune']);
  }

  /**
   * List untracked and gitignored top-level entries (files/directories).
   * Uses `git ls-files --others --ignored --exclude-standard` and collapses
   * nested paths to their top-level parent directory.
   */
  async listUntrackedEntries(): Promise<string[]> {
    const output = await this.git.raw([
      'ls-files', '--others', '--ignored', '--exclude-standard',
    ]);
    // Extract unique top-level names (e.g. ".agent/foo/bar.ts" → ".agent")
    const topLevel = new Set<string>();
    for (const line of output.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const firstSlash = trimmed.indexOf('/');
      topLevel.add(firstSlash > 0 ? trimmed.substring(0, firstSlash) : trimmed);
    }
    return [...topLevel].sort();
  }

  /**
   * Returns how many commits baseBranch is ahead of targetBranch.
   * Uses: git rev-list --count targetBranch..baseBranch
   */
  async getCommitsAhead(baseBranch: string, targetBranch: string): Promise<number> {
    try {
      const output = await this.git.raw(['rev-list', '--count', `${targetBranch}..${baseBranch}`]);
      return parseInt(output.trim(), 10) || 0;
    } catch {
      return 0;
    }
  }

  /**
   * Rebase the current branch onto the given base branch.
   * Throws on conflict — caller should catch and handle.
   */
  async rebase(baseBranch: string): Promise<void> {
    await this.git.raw(['rebase', baseBranch]);
  }

}

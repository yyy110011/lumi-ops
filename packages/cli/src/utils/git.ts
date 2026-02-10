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
    const rev = await this.git.revparse(['--abbrev-ref', 'HEAD']);
    return rev.trim();
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
      .filter(b => b && !b.endsWith('/HEAD'));
  }

  async fetchRemote(remote?: string): Promise<void> {
    const args = ['fetch'];
    if (remote) args.push(remote);
    await this.git.raw(args);
  }

  async checkoutBranch(branchName: string): Promise<void> {
    await this.git.raw(['checkout', branchName]);
  }

}

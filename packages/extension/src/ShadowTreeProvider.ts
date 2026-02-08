import * as vscode from 'vscode';
import * as path from 'path';
import { list, ShadowClone, GitUtils } from '@lumi-ops/cli';


export class ShadowTreeProvider implements vscode.TreeDataProvider<ShadowItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<ShadowItem | undefined | void> = new vscode.EventEmitter<ShadowItem | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<ShadowItem | undefined | void> = this._onDidChangeTreeData.event;

  constructor(private workspaceRoot: string | undefined) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: ShadowItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: ShadowItem): Promise<ShadowItem[]> {
    if (!this.workspaceRoot) {
      return [];
    }

    if (element) {
      return [];
    } else {
      try {
        const clones = await this.getShadowClones();
        const items: ShadowItem[] = [];

        // 1. Find current workspace worktree (non-shadow) and show it first
        const currentWorktree = clones.find(c => !c.isShadow);
        if (currentWorktree) {
          items.push(new ShadowItem(
            currentWorktree.branch,
            vscode.TreeItemCollapsibleState.None,
            currentWorktree,
            'currentBranch'  // Protected - no kill/merge menu
          ));
        }

        // 2. Show only shadow clones below
        const shadowClones = clones.filter(c => c.isShadow);
        for (const clone of shadowClones) {
          items.push(new ShadowItem(
            clone.branch,
            vscode.TreeItemCollapsibleState.None,
            clone,
            'shadowClone'
          ));
        }

        return items;
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to list shadow clones: ${error}`);
        return [];
      }
    }
  }

  private async getShadowClones(): Promise<ShadowClone[]> {
    if (!this.workspaceRoot) return [];
    
    const worktrees: ShadowClone[] = [];

    try {
        const git = new GitUtils(this.workspaceRoot);

        const worktreesRaw = await git.listWorktrees();
        
        for (const entry of worktreesRaw) {
          const lines = entry.split('\n');
          const worktreePath = lines.find((l: string) => l.startsWith('worktree'))?.split(' ')[1];
          const branch = lines.find((l: string) => l.startsWith('branch'))?.split(' ').pop();

          if (worktreePath && branch) {
            const isShadow = worktreePath.includes('.shadow-clones');
            worktrees.push({
              branch: branch.replace('refs/heads/', ''),
              path: worktreePath,
              isShadow
            });
          }
        }
        return worktrees;
    } catch (e) {
        console.error(e);
        return [];
    }
  }
}

class ShadowItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly clone: ShadowClone,
    public readonly role: 'currentBranch' | 'shadowClone'
  ) {
    super(label, collapsibleState);
    this.contextValue = role;

    if (role === 'currentBranch') {
      this.tooltip = `Current workspace: ${this.clone.path}`;
      this.description = '🏠 Current Branch';
      this.iconPath = new vscode.ThemeIcon('home');
    } else {
      this.tooltip = `${this.clone.path}`;
      this.description = 'Shadow Clone';
      this.iconPath = new vscode.ThemeIcon('git-branch');
      this.command = {
        command: 'lumi-ops.open',
        title: 'Open Clone',
        arguments: [this.clone]
      };
    }
  }
}

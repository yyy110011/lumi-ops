import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { list, ShadowClone, GitUtils, SHADOW_CLONES_DIR } from '@lumi-ops/cli';


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

        // Load centralized metadata once
        const metadataPath = path.join(this.workspaceRoot, SHADOW_CLONES_DIR, '.lumi-metadata.json');
        let metadata: Record<string, { baseBranch: string }> = {};
        try {
          const raw = fs.readFileSync(metadataPath, 'utf-8');
          metadata = JSON.parse(raw);
        } catch {
          // No metadata file yet
        }

        const worktreesRaw = await git.listWorktrees();
        
        for (const entry of worktreesRaw) {
          const lines = entry.split('\n');
          const worktreePath = lines.find((l: string) => l.startsWith('worktree'))?.split(' ')[1];
          const branch = lines.find((l: string) => l.startsWith('branch'))?.split(' ').pop();

          if (worktreePath && branch) {
            const branchName = branch.replace('refs/heads/', '');
            const isShadow = worktreePath.includes(SHADOW_CLONES_DIR);
            let baseBranch: string | undefined;
            
            if (isShadow) {
              // Look up from centralized metadata
              baseBranch = metadata[branchName]?.baseBranch;
            }
            worktrees.push({
              branch: branchName,
              path: worktreePath,
              isShadow,
              baseBranch
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
      this.description = this.clone.baseBranch ? `← ${this.clone.baseBranch}` : 'Shadow Clone';
      this.iconPath = new vscode.ThemeIcon('git-branch');
      this.command = {
        command: 'lumi-ops.open',
        title: 'Open Clone',
        arguments: [this.clone]
      };
    }
  }
}

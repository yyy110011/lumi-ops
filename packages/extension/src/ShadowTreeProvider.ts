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
        // Fetch clones using the logic from the CLI
        const clones = await this.getShadowClones();
        return clones.map(clone => new ShadowItem(
          clone.branch,
          clone.isShadow ? vscode.TreeItemCollapsibleState.None : vscode.TreeItemCollapsibleState.None,
          clone
        ));
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to list shadow clones: ${error}`);
        return [];
      }
    }
  }

  private async getShadowClones(): Promise<ShadowClone[]> {
    if (!this.workspaceRoot) return [];
    
    // We'll capture the console output or directly call the logic.
    // For this MVP, we'll re-implement the list logic slightly or use the imported function.
    // Note: In a real monorepo, you'd want to make sure the CLI logic is exported cleanly.
    
    const worktrees: ShadowClone[] = [];
    // Here we wrap the list logic or call it
    // For now, let's assume we can call the function directly if the import works.
    // Since we are in a monorepo, we might need to handle the 'root' option.
    
    // Mocking for now to avoid execution issues during extension loading if CLI isn't built
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
    public readonly clone: ShadowClone
  ) {
    super(label, collapsibleState);
    this.tooltip = `${this.clone.path}`;
    this.description = this.clone.isShadow ? 'Shadow Clone' : 'Main Repository';
    this.contextValue = this.clone.isShadow ? 'shadowClone' : 'coreRepo';
    this.iconPath = new vscode.ThemeIcon(this.clone.isShadow ? 'git-branch' : 'repo');
    
    this.command = {
      command: 'lumi-ops.open',
      title: 'Open Clone',
      arguments: [this.clone]
    };
  }
}

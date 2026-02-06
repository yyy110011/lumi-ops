import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ShadowClone, GitUtils } from '@lumi-ops/cli';

/**
 * Status file schema for agent monitoring
 */
export interface LumiStatus {
  status: 'coding' | 'testing' | 'blocked' | 'done' | 'idle';
  message: string;
  session: string;        // tmux session name
  startedAt?: string;     // ISO-8601 timestamp
  driver?: string;        // driver command used
}

/**
 * Read the last N lines from an agent's log file
 */
function getLogSnippet(worktreePath: string, lines: number = 50): string | null {
  const logPath = path.join(worktreePath, 'agent.log');

  try {
    if (!fs.existsSync(logPath)) {
      return null;
    }

    const content = fs.readFileSync(logPath, 'utf-8');
    const allLines = content.split('\n');
    const lastLines = allLines.slice(-lines).join('\n');

    return lastLines || null;
  } catch (e) {
    return null;
  }
}

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
        
        // Read status for each clone
        const itemsWithStatus = await Promise.all(
          clones.map(async (clone) => {
            const statusPath = path.join(clone.path, '.lumi-status.json');
            let status: LumiStatus | undefined;
            
            try {
              if (fs.existsSync(statusPath)) {
                const content = fs.readFileSync(statusPath, 'utf-8');
                status = JSON.parse(content);
              }
            } catch (e) {
              // Ignore read errors
            }
            
            return new ShadowItem(
              clone.branch,
              vscode.TreeItemCollapsibleState.None,
              clone,
              status
            );
          })
        );
        
        return itemsWithStatus;
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

export class ShadowItem extends vscode.TreeItem {
  public readonly logPath: string;

  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly clone: ShadowClone,
    public readonly status?: LumiStatus
  ) {
    super(label, collapsibleState);
    
    this.logPath = path.join(clone.path, 'agent.log');
    this.tooltip = this.getTooltip();
    this.description = this.getDescription();
    this.contextValue = this.getContextValue();
    this.iconPath = this.getIcon();
    
    // Only set default command if no active session
    if (!this.status?.session) {
      this.command = {
        command: 'lumi-ops.open',
        title: 'Open Clone',
        arguments: [this.clone]
      };
    }
  }
  
  private getTooltip(): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.isTrusted = true;

    // Basic info
    md.appendMarkdown(`**Path:** \`${this.clone.path}\`\n\n`);

    if (this.status) {
      md.appendMarkdown(`**Status:** ${this.status.status}\n\n`);
      md.appendMarkdown(`**Message:** ${this.status.message}\n\n`);
      if (this.status.session) {
        md.appendMarkdown(`**Session:** \`${this.status.session}\`\n\n`);
      }
    }

    // Log preview (last 10 lines for tooltip)
    const logSnippet = getLogSnippet(this.clone.path, 10);
    if (logSnippet) {
      md.appendMarkdown(`---\n**Recent Log:**\n\`\`\`\n${logSnippet}\n\`\`\``);
    }

    return md;
  }
  
  private getDescription(): string {
    if (this.status) {
      return `[${this.status.status.toUpperCase()}] ${this.status.message}`;
    }
    return this.clone.isShadow ? 'Shadow Clone' : 'Main Repository';
  }
  
  private getContextValue(): string {
    if (this.status?.session) {
      return 'activeAgent';  // Has context menu for attach
    }
    return this.clone.isShadow ? 'shadowClone' : 'coreRepo';
  }
  
  private getIcon(): vscode.ThemeIcon {
    if (!this.status) {
      return new vscode.ThemeIcon(this.clone.isShadow ? 'git-branch' : 'repo');
    }
    
    switch (this.status.status) {
      case 'coding':
        return new vscode.ThemeIcon('sync~spin', new vscode.ThemeColor('charts.yellow'));
      case 'testing':
        return new vscode.ThemeIcon('beaker', new vscode.ThemeColor('charts.blue'));
      case 'blocked':
        return new vscode.ThemeIcon('warning', new vscode.ThemeColor('charts.red'));
      case 'done':
        return new vscode.ThemeIcon('check', new vscode.ThemeColor('charts.green'));
      case 'idle':
      default:
        return new vscode.ThemeIcon('circle-outline');
    }
  }
}

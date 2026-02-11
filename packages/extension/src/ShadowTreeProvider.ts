import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { list, ShadowClone, GitUtils, SHADOW_CLONES_DIR, METADATA_FILE } from '@lumi-ops/cli';
import type { ReviewStatus } from '@lumi-ops/cli';

const STATUS_SVG: Partial<Record<ReviewStatus, string>> = {
  todo:   'status-todo.svg',
  done:   'status-done.svg',
  wontDo: 'status-wont-do.svg',
};

const STATUS_LABELS: Record<ReviewStatus, string> = {
  todo: 'Todo',
  inProgress: 'In Progress',
  done: 'Done',
  wontDo: "Won't Do",
};

const STATUS_ORDER: ReviewStatus[] = ['todo', 'inProgress', 'done', 'wontDo'];

export class ShadowTreeProvider implements vscode.TreeDataProvider<ShadowItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<ShadowItem | undefined | void> = new vscode.EventEmitter<ShadowItem | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<ShadowItem | undefined | void> = this._onDidChangeTreeData.event;

  /** In-memory status cache for rapid clicks */
  private statusCache: Map<string, ReviewStatus> = new Map();
  /** Live item references — mutated in place for instant partial updates */
  private itemCache: Map<string, ShadowItem> = new Map();
  /** Debounce timer for coalescing rapid disk writes */
  private diskWriteTimer: ReturnType<typeof setTimeout> | null = null;
  /** Track which branch is currently focused (selected) for focus-then-click guard */
  private lastFocusedBranch: string | null = null;

  constructor(private workspaceRoot: string | undefined, private extensionPath: string) {}

  /** Full refresh: clears item cache, re-fetches from git */
  refresh(): void {
    this.itemCache.clear();
    this.lastFocusedBranch = null;
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
            'currentBranch'
          ));
        }

        // 2. Show only shadow clones below
        const shadowClones = clones.filter(c => c.isShadow);
        for (const clone of shadowClones) {
          // Apply in-memory cache (overrides disk metadata)
          const cached = this.statusCache.get(clone.branch);
          if (cached !== undefined) {
            clone.reviewStatus = cached;
          }
          const item = new ShadowItem(
            clone.branch,
            vscode.TreeItemCollapsibleState.None,
            clone,
            'shadowClone',
            this.extensionPath
          );
          // Store live reference for partial updates
          this.itemCache.set(clone.branch, item);
          items.push(item);
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
        const metadataPath = path.join(this.workspaceRoot, SHADOW_CLONES_DIR, METADATA_FILE);
        let metadata: Record<string, { baseBranch?: string; reviewStatus?: ReviewStatus }> = {};
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
            const meta = metadata[branchName];
            
            worktrees.push({
              branch: branchName,
              path: worktreePath,
              isShadow,
              baseBranch: meta?.baseBranch,
              reviewStatus: meta?.reviewStatus,
            });
          }
        }
        return worktrees;
    } catch (e) {
        console.error(e);
        return [];
    }
  }

  /**
   * Update a clone's review status — instant partial update, no tree rebuild.
   */
  setReviewStatus(branchName: string, status: ReviewStatus): void {
    if (!this.workspaceRoot) return;

    // Update cache
    this.statusCache.set(branchName, status);

    // Mutate existing item in place + partial fire (NO getChildren, NO loading bar)
    const item = this.itemCache.get(branchName);
    if (item) {
      item.updateStatus(status, this.extensionPath!);
      this._onDidChangeTreeData.fire(item);
    }

    // Debounce disk write (300ms)
    if (this.diskWriteTimer) {
      clearTimeout(this.diskWriteTimer);
    }
    this.diskWriteTimer = setTimeout(() => {
      this.flushStatusToDisk();
    }, 300);
  }

  /**
   * Flush all cached statuses to disk (called after debounce settles).
   */
  private flushStatusToDisk(): void {
    if (!this.workspaceRoot) return;
    const metadataPath = path.join(this.workspaceRoot, SHADOW_CLONES_DIR, METADATA_FILE);
    try {
      let metadata: Record<string, any> = {};
      try {
        const raw = fs.readFileSync(metadataPath, 'utf-8');
        metadata = JSON.parse(raw);
      } catch {
        // File doesn't exist yet
      }
      for (const [branch, status] of this.statusCache) {
        if (!metadata[branch]) {
          metadata[branch] = {};
        }
        metadata[branch].reviewStatus = status;
      }
      fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
    } catch {
      // Disk write failed — cache still has the correct state
    }
  }

  /**
   * Cycle to the next review status with focus guard.
   * First click on a branch just focuses it; subsequent clicks cycle the status.
   */
  cycleReviewStatus(branchName: string, currentStatus?: ReviewStatus): void {
    if (this.lastFocusedBranch !== branchName) {
      // First click — just focus, don't cycle
      this.lastFocusedBranch = branchName;
      return;
    }
    // Already focused — cycle status
    const cached = this.statusCache.get(branchName);
    const current = cached ?? currentStatus ?? 'todo';
    const idx = STATUS_ORDER.indexOf(current);
    const next = STATUS_ORDER[(idx + 1) % STATUS_ORDER.length];
    this.setReviewStatus(branchName, next);
  }
}

class ShadowItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly clone: ShadowClone,
    public readonly role: 'currentBranch' | 'shadowClone',
    private extensionPath?: string
  ) {
    super(label, collapsibleState);
    // Stable ID so VS Code tracks this item across updates
    this.id = `shadow-${clone.branch}`;
    this.contextValue = role;

    if (role === 'currentBranch') {
      this.tooltip = `Current workspace: ${this.clone.path}`;
      this.description = '🏠 Current Branch';
      this.iconPath = new vscode.ThemeIcon('home');
    } else {
      const status: ReviewStatus = this.clone.reviewStatus || 'todo';
      this.applyStatus(status);
      this.description = this.clone.baseBranch ? `← ${this.clone.baseBranch}` : 'Shadow Clone';
      // Click the row → focus-then-cycle status
      this.command = {
        command: 'lumi-ops.cycleReviewStatus',
        title: 'Cycle Status',
        arguments: [this]
      };
    }
  }

  /** Apply status visuals (icon + tooltip). Can be called to mutate in place. */
  private applyStatus(status: ReviewStatus): void {
    this.tooltip = `[${STATUS_LABELS[status]}] ${this.clone.path}`;
    if (status === 'inProgress') {
      // Animated spinning icon in blue
      this.iconPath = new vscode.ThemeIcon('sync~spin', new vscode.ThemeColor('notificationsInfoIcon.foreground'));
    } else {
      const svgFile = STATUS_SVG[status];
      this.iconPath = svgFile
        ? vscode.Uri.file(path.join(this.extensionPath!, 'media', svgFile))
        : new vscode.ThemeIcon('circle-outline');
    }
  }

  /** Public method for in-place mutation from the provider. */
  updateStatus(status: ReviewStatus, extensionPath: string): void {
    this.extensionPath = extensionPath;
    this.applyStatus(status);
  }
}

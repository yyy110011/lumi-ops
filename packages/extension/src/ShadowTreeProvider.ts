import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { parseWorktrees, ShadowClone, GitUtils, getRepoStorageDir, METADATA_FILE } from '@lumi-ops/cli';
import type { ReviewStatus } from '@lumi-ops/cli';
import type { StatusEventBus } from './StatusEventBus';

const STATUS_SVG: Partial<Record<ReviewStatus, string>> = {
  todo:   'status-todo.svg',
  done:   'status-done.svg',
  wontDo: 'status-wont-do.svg',
  needsReview: 'status-needs-review.svg',
  needsRevision: 'status-needs-revision.svg',
};

const STATUS_LABELS: Record<ReviewStatus, string> = {
  todo: 'Todo',
  inProgress: 'In Progress',
  needsReview: 'Needs Review',
  done: 'Done',
  wontDo: "Won't Do",
  needsRevision: 'Needs Revision',
};

const STATUS_ORDER: ReviewStatus[] = ['todo', 'inProgress', 'needsReview', 'done', 'wontDo'];

export class ShadowTreeProvider implements vscode.TreeDataProvider<ShadowItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<ShadowItem | undefined | void> = new vscode.EventEmitter<ShadowItem | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<ShadowItem | undefined | void> = this._onDidChangeTreeData.event;

  /** In-memory status cache for rapid clicks (keyed by dirName) */
  private statusCache: Map<string, ReviewStatus> = new Map();
  /** Live item references — mutated in place for instant partial updates (keyed by dirName) */
  private itemCache: Map<string, ShadowItem> = new Map();
  /** Debounce timer for coalescing rapid disk writes */
  private diskWriteTimer: ReturnType<typeof setTimeout> | null = null;
  /** Track which clone is currently focused (selected) for focus-then-click guard (by dirName) */
  private lastFocusedClone: string | null = null;

  constructor(
    private workspaceRoot: string | undefined,
    private extensionPath: string,
    private statusBus: StatusEventBus,
    private shadowBranchName?: string,
    private currentWorkspacePath?: string
  ) {
    // Subscribe to status changes (from file watcher via bus)
    let busRefreshTimer: ReturnType<typeof setTimeout> | null = null;
    this._busDisposable = statusBus.onDidChange(() => {
      if (busRefreshTimer) clearTimeout(busRefreshTimer);
      busRefreshTimer = setTimeout(() => {
        // If we have a pending flush, our cache IS the source of truth — skip.
        // Only sync from disk when idle (external changes).
        if (this.diskWriteTimer) return;
        this._syncCacheFromDisk();
        this.itemCache.clear();
        this._onDidChangeTreeData.fire();
      }, 100);
    });
  }

  private _busDisposable: vscode.Disposable;

  /** Full refresh: clears item cache, re-fetches from git */
  refresh(): void {
    this.itemCache.clear();
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
      // Root Mode: Show all clones
      try {
        const clones = await this.getShadowClones();
        const items: ShadowItem[] = [];

        // 1. Find current workspace worktree (non-shadow) and show it first
        const currentWorktree = clones.find(c => c.isMain);
        if (currentWorktree) {
          items.push(new ShadowItem(
            currentWorktree.currentBranch,
            vscode.TreeItemCollapsibleState.None,
            currentWorktree,
            'currentBranch',
            this.extensionPath,
            this.currentWorkspacePath
          ));
        }

        // 2. Show only shadow clones below
        const shadowClones = clones.filter(c => c.isShadow);
        for (const clone of shadowClones) {
          // Apply in-memory cache (overrides disk metadata)
          const cached = this.statusCache.get(clone.dirName);
          if (cached !== undefined) {
            clone.reviewStatus = cached;
          }
          const item = new ShadowItem(
            clone.dirName,
            vscode.TreeItemCollapsibleState.None,
            clone,
            'shadowClone',
            this.extensionPath,
            this.currentWorkspacePath
          );
          // Store live reference for partial updates (keyed by dirName)
          this.itemCache.set(clone.dirName, item);
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

    try {
        const git = new GitUtils(this.workspaceRoot);

        // Load centralized metadata once
        const metadataPath = path.join(getRepoStorageDir(this.workspaceRoot), METADATA_FILE);
        let metadata: Record<string, { baseBranch?: string; reviewStatus?: ReviewStatus; needsRebase?: boolean }> = {};
        try {
          const raw = fs.readFileSync(metadataPath, 'utf-8');
          metadata = JSON.parse(raw);
        } catch {
          // No metadata file yet
        }

        const worktreesRaw = await git.listWorktrees();
        const clones = parseWorktrees(worktreesRaw, this.workspaceRoot!);

        // Enrich with metadata (keyed by dirName)
        for (const clone of clones) {
          const meta = metadata[clone.dirName];
          if (meta) {
            clone.baseBranch = meta.baseBranch;
            clone.reviewStatus = meta.reviewStatus;
            clone.needsRebase = meta.needsRebase;
          }
        }

        // Check conflicts in parallel
        const conflictResults = await Promise.all(
          clones.map(async (c) => {
            try {
              const wtGit = new GitUtils(c.path);
              return await wtGit.hasConflicts();
            } catch {
              return false;
            }
          })
        );
        clones.forEach((c, i) => { c.hasConflict = conflictResults[i]; });

        return clones;
    } catch (e) {
        console.error(e);
        return [];
    }
  }

  /**
   * Update a clone's review status — instant partial update, no tree rebuild.
   * Keyed by dirName (stable identity).
   */
  setReviewStatus(cloneIdentifier: string, status: ReviewStatus): void {
    if (!this.workspaceRoot) return;

    // Update cache (keyed by dirName)
    this.statusCache.set(cloneIdentifier, status);

    // Mutate existing item in place + partial fire (NO getChildren, NO loading bar)
    const item = this.itemCache.get(cloneIdentifier);
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
      this.diskWriteTimer = null;
    }, 300);
  }

  /**
   * Flush all cached statuses to disk (called after debounce settles).
   * Keys are dirName identifiers.
   */
  private flushStatusToDisk(): void {
    if (!this.workspaceRoot) return;
    const metadataPath = path.join(getRepoStorageDir(this.workspaceRoot), METADATA_FILE);
    try {
      let metadata: Record<string, any> = {};
      try {
        const raw = fs.readFileSync(metadataPath, 'utf-8');
        metadata = JSON.parse(raw);
      } catch {
        // File doesn't exist yet
      }
      for (const [identifier, status] of this.statusCache) {
        if (!metadata[identifier]) {
          metadata[identifier] = {};
        }
        metadata[identifier].reviewStatus = status;
      }
      fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
      // File watcher will detect this write and fire bus for other consumers
    } catch {
      // Disk write failed — cache still has the correct state
    }
  }

  /**
   * Sync statusCache from disk metadata (called by bus handler).
   * Unlike clear(), this ensures cycleReviewStatus always has
   * the correct current status to cycle from.
   */
  private _syncCacheFromDisk(): void {
    if (!this.workspaceRoot) return;
    const metadataPath = path.join(getRepoStorageDir(this.workspaceRoot), METADATA_FILE);
    try {
      const raw = fs.readFileSync(metadataPath, 'utf-8');
      const metadata = JSON.parse(raw);
      // Rebuild cache from disk to clear stale entries (e.g. after kill + respawn)
      this.statusCache.clear();
      for (const [key, data] of Object.entries(metadata)) {
        const status = (data as any)?.reviewStatus;
        if (status) {
          this.statusCache.set(key, status as ReviewStatus);
        }
      }
    } catch {
      // No metadata file — clear cache
      this.statusCache.clear();
    }
  }

  /**
   * Cycle to the next review status with focus guard.
   * First click on a clone just focuses it; subsequent clicks cycle the status.
   * Keyed by dirName (stable identity).
   */
  cycleReviewStatus(cloneIdentifier: string, currentStatus?: ReviewStatus): void {
    if (this.lastFocusedClone !== cloneIdentifier) {
      // First click — just focus, don't cycle
      this.lastFocusedClone = cloneIdentifier;
      return;
    }
    // Already focused — cycle status
    const cached = this.statusCache.get(cloneIdentifier);
    const current = cached ?? currentStatus ?? 'todo';
    const idx = STATUS_ORDER.indexOf(current);
    const next = STATUS_ORDER[(idx + 1) % STATUS_ORDER.length];
    this.setReviewStatus(cloneIdentifier, next);
  }
}

export class ShadowItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly clone: ShadowClone,
    public readonly role: 'currentBranch' | 'shadowClone',
    private extensionPath?: string,
    private currentWorkspacePath?: string
  ) {
    super(label, collapsibleState);
    // Stable ID using dirName so VS Code tracks this item across updates
    this.id = `shadow-${clone.dirName}-${role}`;
    this.contextValue = (role === 'shadowClone' && clone.isDetached)
      ? 'shadowClone-detached'
      : role;

    const conflictPrefix = this.clone.hasConflict ? '⚠️ · ' : '';
    const rebasePrefix = this.clone.needsRebase ? '⟲ rebase · ' : '';

    if (role === 'currentBranch') {
      this.tooltip = `Current workspace: ${this.clone.path}`;
      const isAtRoot = !this.currentWorkspacePath;
      this.description = isAtRoot
        ? `${conflictPrefix}Worktree Root · ★`
        : `${conflictPrefix}Worktree Root`;
      this.iconPath = new vscode.ThemeIcon('home');
      // Click = navigate to root (no-op if already at root)
      this.command = {
        command: 'lumi-ops.returnToRoot',
        title: 'Return to Root',
      };
    } else {
      const status: ReviewStatus = this.clone.reviewStatus || 'todo';
      this.applyStatus(status);
      const detachedPrefix = this.clone.isDetached ? '🔀 rebasing · ' : '';
      // Show branch drift indicator when currentBranch differs from dirName
      const branchDrift = this.clone.currentBranch !== this.clone.dirName
        ? `⚠️ on: ${this.clone.currentBranch} · `
        : '';
      const isCurrent = this.currentWorkspacePath && this.clone.path === this.currentWorkspacePath;
      const baseDesc = this.clone.baseBranch ? `← ${this.clone.baseBranch}` : 'Shadow Clone';
      this.description = isCurrent
        ? `${conflictPrefix}${rebasePrefix}${detachedPrefix}${branchDrift}${baseDesc} · ★`
        : `${conflictPrefix}${rebasePrefix}${detachedPrefix}${branchDrift}${baseDesc}`;
      // Click = focus-then-cycle status (uses dirName as identifier)
      this.command = {
        command: 'lumi-ops.cycleReviewStatus',
        title: 'Cycle Status',
        arguments: [clone.dirName]
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


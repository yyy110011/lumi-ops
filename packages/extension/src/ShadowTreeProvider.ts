import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { parseWorktrees, ShadowClone, GitUtils, getRepoStorageDir, METADATA_FILE } from '@lumi-ops/cli';
import type { ReviewStatus } from '@lumi-ops/cli';
import type { StatusEventBus } from './StatusEventBus';

/** Extension-local type that enriches CLI's ShadowClone with the repo root it belongs to. */
export interface EnrichedClone extends ShadowClone {
  repoRoot: string;
}

/** Composite cache key to isolate per-repo clone status. */
function cacheKey(repoRoot: string, dirName: string): string {
  return `${repoRoot}::${dirName}`;
}

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

  /** In-memory status cache for rapid clicks (keyed by repoRoot::dirName) */
  private statusCache: Map<string, ReviewStatus> = new Map();
  /** Live item references — mutated in place for instant partial updates (keyed by repoRoot::dirName) */
  private itemCache: Map<string, ShadowItem> = new Map();
  /** Debounce timer for coalescing rapid disk writes */
  private diskWriteTimer: ReturnType<typeof setTimeout> | null = null;
  /** Track which clone is currently focused (selected) for focus-then-click guard (by composite key) */
  private lastFocusedClone: string | null = null;
  /** Cached grouped clones for multi-root tree children lookup */
  private _repoCloneCache: Map<string, EnrichedClone[]> = new Map();

  constructor(
    private workspaceRoots: string[],
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
    if (this.workspaceRoots.length === 0) {
      return [];
    }

    // Multi-root: repo header children
    if (element && element.role === 'repoHeader' && element.repoRoot) {
      const repoClones = this._repoCloneCache.get(element.repoRoot) || [];
      return this._buildCloneItems(repoClones);
    }

    if (element) {
      return [];
    }

    // Root level
    try {
      const clones = await this.getShadowClones();

      // Single root: flat list (unchanged behavior)
      if (this.workspaceRoots.length <= 1) {
        return this._buildCloneItems(clones);
      }

      // Multi-root: group by repoRoot → return repo headers as expandable parents
      const grouped = new Map<string, EnrichedClone[]>();
      for (const clone of clones) {
        const root = clone.repoRoot || this.workspaceRoots[0];
        if (!grouped.has(root)) grouped.set(root, []);
        grouped.get(root)!.push(clone);
      }

      // Cache for getChildren(repoHeader) to access
      this._repoCloneCache = grouped;

      const items: ShadowItem[] = [];
      for (const [repoRoot] of grouped) {
        const repoName = path.basename(repoRoot);
        const repoItem = new ShadowItem(
          repoName,
          vscode.TreeItemCollapsibleState.Expanded,
          undefined,
          'repoHeader',
          this.extensionPath,
          this.currentWorkspacePath,
          repoRoot,
        );
        items.push(repoItem);
      }

      return items;
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to list shadow clones: ${error}`);
      return [];
    }
  }

  /** Build children items for a single repo (shared by single-root + multi-root tree) */
  private _buildCloneItems(clones: EnrichedClone[]): ShadowItem[] {
    const items: ShadowItem[] = [];

    const mainClone = clones.find(c => c.isMain);
    if (mainClone) {
      items.push(new ShadowItem(
        mainClone.currentBranch,
        vscode.TreeItemCollapsibleState.None,
        mainClone,
        'currentBranch',
        this.extensionPath,
        this.currentWorkspacePath,
      ));
    }

    for (const clone of clones.filter(c => c.isShadow)) {
      const key = cacheKey(clone.repoRoot, clone.dirName);
      const cached = this.statusCache.get(key);
      if (cached !== undefined) clone.reviewStatus = cached;
      const item = new ShadowItem(
        clone.dirName,
        vscode.TreeItemCollapsibleState.None,
        clone,
        'shadowClone',
        this.extensionPath,
        this.currentWorkspacePath,
      );
      this.itemCache.set(key, item);
      items.push(item);
    }

    return items;
  }

  private async getShadowClones(): Promise<EnrichedClone[]> {
    if (this.workspaceRoots.length === 0) return [];

    const allClones: EnrichedClone[] = [];

    for (const workspaceRoot of this.workspaceRoots) {
      try {
        const git = new GitUtils(workspaceRoot);

        // Load centralized metadata once per root
        const metadataPath = path.join(getRepoStorageDir(workspaceRoot), METADATA_FILE);
        let metadata: Record<string, { baseBranch?: string; reviewStatus?: ReviewStatus; needsRebase?: boolean }> = {};
        try {
          const raw = fs.readFileSync(metadataPath, 'utf-8');
          metadata = JSON.parse(raw);
        } catch {
          // No metadata file yet
        }

        const worktreesRaw = await git.listWorktrees();
        const parsed = parseWorktrees(worktreesRaw, workspaceRoot);

        // Condition-driven self-tidy: git flags a worktree whose folder was
        // deleted manually as `prunable`. Drop those from the list (no ghost
        // entries) and reconcile git's stale registrations — but only when
        // something is actually prunable, so steady-state refreshes do no work.
        const clones = parsed.filter(c => !c.prunable);
        if (parsed.some(c => c.prunable)) {
          try { await git.pruneWorktrees(); } catch { /* best-effort */ }
        }

        // Enrich with metadata (keyed by dirName) and repoRoot
        for (const clone of clones) {
          const enriched = clone as EnrichedClone;
          enriched.repoRoot = workspaceRoot;
          const meta = metadata[enriched.dirName];
          if (meta) {
            enriched.baseBranch = meta.baseBranch;
            enriched.reviewStatus = meta.reviewStatus;
            enriched.needsRebase = meta.needsRebase;
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
        clones.forEach((c, i) => { (c as EnrichedClone).hasConflict = conflictResults[i]; });

        allClones.push(...(clones as EnrichedClone[]));
      } catch (e) {
        console.error(`[lumi-ops] Failed to get clones for ${workspaceRoot}:`, e);
      }
    }

    return allClones;
  }

  /**
   * Update a clone's review status — instant partial update, no tree rebuild.
   * Keyed by composite key (repoRoot::dirName).
   */
  setReviewStatus(cloneIdentifier: string, status: ReviewStatus): void {
    if (this.workspaceRoots.length === 0) return;

    // Update cache (keyed by repoRoot::dirName)
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
   * Keys are composite (repoRoot::dirName) — only entries belonging to each root are written.
   */
  private flushStatusToDisk(): void {
    if (this.workspaceRoots.length === 0) return;
    for (const workspaceRoot of this.workspaceRoots) {
      const metadataPath = path.join(getRepoStorageDir(workspaceRoot), METADATA_FILE);
      try {
        let metadata: Record<string, any> = {};
        try {
          const raw = fs.readFileSync(metadataPath, 'utf-8');
          metadata = JSON.parse(raw);
        } catch {
          // File doesn't exist yet
        }
        let changed = false;
        const prefix = `${workspaceRoot}::`;
        for (const [key, status] of this.statusCache) {
          if (!key.startsWith(prefix)) continue;
          const dirName = key.slice(prefix.length);
          if (metadata[dirName]) {
            metadata[dirName].reviewStatus = status;
            changed = true;
          }
        }
        if (changed) {
          fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
        }
      } catch {
        // Disk write failed — cache still has the correct state
      }
    }
  }

  /**
   * Sync statusCache from disk metadata (called by bus handler).
   * Unlike clear(), this ensures cycleReviewStatus always has
   * the correct current status to cycle from.
   * Uses composite keys (repoRoot::dirName) to avoid cross-repo collisions.
   */
  private _syncCacheFromDisk(): void {
    if (this.workspaceRoots.length === 0) return;
    this.statusCache.clear();
    for (const workspaceRoot of this.workspaceRoots) {
      const metadataPath = path.join(getRepoStorageDir(workspaceRoot), METADATA_FILE);
      try {
        const raw = fs.readFileSync(metadataPath, 'utf-8');
        const metadata = JSON.parse(raw);
        for (const [key, data] of Object.entries(metadata)) {
          const status = (data as any)?.reviewStatus;
          if (status) {
            this.statusCache.set(cacheKey(workspaceRoot, key), status as ReviewStatus);
          }
        }
      } catch {
        // No metadata file for this root — skip
      }
    }
  }

  /**
   * Cycle to the next review status with focus guard.
   * First click on a clone just focuses it; subsequent clicks cycle the status.
   * Keyed by composite key (repoRoot::dirName).
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
    public readonly clone: EnrichedClone | undefined,
    public readonly role: 'currentBranch' | 'shadowClone' | 'repoHeader',
    private extensionPath?: string,
    private currentWorkspacePath?: string,
    public readonly repoRoot?: string,
  ) {
    super(label, collapsibleState);

    if (role === 'repoHeader') {
      this.id = `repo-header-${label}`;
      this.contextValue = 'repoHeader';
      this.iconPath = new vscode.ThemeIcon('repo');
      this.description = '';
      return;
    }

    if (!clone) return;

    // Stable ID using dirName so VS Code tracks this item across updates
    this.id = `shadow-${clone.dirName}-${role}`;
    this.contextValue = (role === 'shadowClone' && clone.isDetached)
      ? 'shadowClone-detached'
      : role;

    const conflictPrefix = clone.hasConflict ? '⚠️ · ' : '';
    const rebasePrefix = clone.needsRebase ? '⟲ rebase · ' : '';

    if (role === 'currentBranch') {
      this.tooltip = `Current workspace: ${clone.path}`;
      const isAtRoot = !this.currentWorkspacePath;
      this.description = isAtRoot
        ? `${conflictPrefix}Worktree Root · ★`
        : `${conflictPrefix}Worktree Root`;
      this.iconPath = new vscode.ThemeIcon('home');
      // Click = navigate to root
      const cloneRepoRoot = clone.repoRoot;
      this.command = {
        command: 'lumi-ops.returnToRoot',
        title: 'Return to Root',
        arguments: cloneRepoRoot ? [cloneRepoRoot] : [],
      };
    } else {
      const status: ReviewStatus = clone.reviewStatus || 'todo';
      this.applyStatus(status, clone);
      const detachedPrefix = clone.isDetached ? '🔀 rebasing · ' : '';
      // Show branch drift indicator when currentBranch differs from dirName
      const branchDrift = clone.currentBranch !== clone.dirName
        ? `⚠️ on: ${clone.currentBranch} · `
        : '';
      const isCurrent = this.currentWorkspacePath && clone.path === this.currentWorkspacePath;
      const baseDesc = clone.baseBranch ? `← ${clone.baseBranch}` : 'Shadow Clone';
      this.description = isCurrent
        ? `${conflictPrefix}${rebasePrefix}${detachedPrefix}${branchDrift}${baseDesc} · ★`
        : `${conflictPrefix}${rebasePrefix}${detachedPrefix}${branchDrift}${baseDesc}`;
      // Click = focus-then-cycle status (uses composite key as identifier)
      this.command = {
        command: 'lumi-ops.cycleReviewStatus',
        title: 'Cycle Status',
        arguments: [cacheKey(clone.repoRoot, clone.dirName)]
      };
    }
  }

  /** Apply status visuals (icon + tooltip). Can be called to mutate in place. */
  private applyStatus(status: ReviewStatus, clone?: EnrichedClone): void {
    const clonePath = clone?.path ?? this.clone?.path ?? '';
    this.tooltip = `[${STATUS_LABELS[status]}] ${clonePath}`;
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


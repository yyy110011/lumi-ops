import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import {
  listRegisteredRepos,
  registerRepo,
  unregisterRepo,
  parseWorktrees,
  GitUtils,
  getClonesDir,
  METADATA_FILE,
} from '@lumi-ops/cli';
import type { ShadowClone, RegisteredRepo } from '@lumi-ops/cli';

/** Repo + its resolved worktrees, sent to the webview. */
interface RepoData {
  name: string;
  rootDir: string;
  reachable: boolean;
  worktrees: ShadowClone[];
  currentBranch?: string;
}

export class WorktreeManagerPanel {
  public static readonly viewType = 'lumi-ops.worktreeManager';
  private static currentPanel: WorktreeManagerPanel | undefined;

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];
  private _metadataWatchers: fs.FSWatcher[] = [];
  private _skipNextWatch = false;

  /* ── Singleton entry point ─────────────────────────── */
  public static createOrShow(extensionUri: vscode.Uri) {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

    if (WorktreeManagerPanel.currentPanel) {
      WorktreeManagerPanel.currentPanel._panel.reveal();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      WorktreeManagerPanel.viewType,
      '⚙ Worktree Manager (Beta)',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [extensionUri],
      },
    );

    WorktreeManagerPanel.currentPanel = new WorktreeManagerPanel(panel, extensionUri);

    // Float the panel into an independent auxiliary window
    setTimeout(() => {
      vscode.commands.executeCommand('workbench.action.moveEditorToNewWindow');
    }, 150);
  }

  /* ── Revive from serializer (reload / reopen) ──────── */
  public static revive(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    WorktreeManagerPanel.currentPanel = new WorktreeManagerPanel(panel, extensionUri);
  }

  /* ── Constructor ───────────────────────────────────── */
  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._panel.title = '⚙ Worktree Manager (Beta)';

    this._panel.webview.html = this._getHtmlForWebview();
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      async (msg) => {
        switch (msg.command) {
          case 'getRepos':
            await this._sendRepoData();
            break;
          case 'openWorktree':
            if (msg.path) {
              vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(msg.path), { forceNewWindow: true });
            }
            break;
          case 'deleteWorktree':
            if (msg.branch && msg.rootDir) {
              const choice = await vscode.window.showWarningMessage(
                `How do you want to kill the shadow clone for "${msg.branch}"?`,
                { modal: true },
                'Remove Clone Only',
                'Kill Clone + Branch',
              );

              if (choice === 'Kill Clone + Branch' || choice === 'Remove Clone Only') {
                const keepBranch = choice === 'Remove Clone Only';
                try {
                  await vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: `Killing shadow clone: ${msg.branch}`,
                    cancellable: false,
                  }, async () => {
                    const { kill } = await import('@lumi-ops/cli');
                    await kill(msg.branch, { root: msg.rootDir, keepBranch, worktreePath: msg.worktreePath });
                  });

                  const info = keepBranch
                    ? `Shadow clone ${msg.branch} removed (branch preserved).`
                    : `Shadow clone ${msg.branch} killed.`;
                  vscode.window.showInformationMessage(info);
                  await this._sendRepoData();
                } catch (e: any) {
                  vscode.window.showErrorMessage(`Failed to kill shadow clone: ${e.message}`);
                }
              }
            }
            break;
          case 'addRepo':
            {
              const uris = await vscode.window.showOpenDialog({
                canSelectFolders: true,
                canSelectFiles: false,
                canSelectMany: false,
                openLabel: 'Add Repo',
              });
              if (uris && uris.length > 0) {
                const dir = uris[0].fsPath;
                const git = new GitUtils(dir);
                if (await git.isGitRepo()) {
                  registerRepo(path.basename(dir), dir);
                  await this._sendRepoData();
                } else {
                  vscode.window.showWarningMessage('Selected folder is not a Git repository.');
                }
              }
            }
            break;
          case 'removeRepo':
            if (msg.repoName) {
              unregisterRepo(msg.repoName);
              await this._sendRepoData();
            }
            break;
          case 'copyText':
            if (msg.text) {
              await vscode.env.clipboard.writeText(msg.text);
              vscode.window.showInformationMessage(`Copied: ${msg.text}`);
            }
            break;
          case 'refreshRepos':
            await this._sendRepoData();
            break;
          case 'cycleStatus':
            if (msg.branch && msg.rootDir) {
              const statusOrder = ['todo', 'inProgress', 'done', 'wontDo'];
              const metaPath = path.join(getClonesDir(msg.rootDir), METADATA_FILE);
              let meta: Record<string, any> = {};
              try {
                const raw = fs.readFileSync(metaPath, 'utf-8');
                meta = JSON.parse(raw);
              } catch { /* no file yet */ }
              const current = meta[msg.branch]?.reviewStatus || 'todo';
              const idx = statusOrder.indexOf(current);
              const next = statusOrder[(idx + 1) % statusOrder.length];
              if (!meta[msg.branch]) meta[msg.branch] = {};
              meta[msg.branch].reviewStatus = next;
              // Skip the self-triggered fs.watch refresh
              this._skipNextWatch = true;
              setTimeout(() => { this._skipNextWatch = false; }, 500);
              try {
                fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
              } catch { /* write failed */ }
              // Targeted update — only the changed branch, no full refresh
              this._panel.webview.postMessage({
                command: 'updateStatus',
                branch: msg.branch,
                rootDir: msg.rootDir,
                status: next,
              });
            }
            break;
        }
      },
      null,
      this._disposables,
    );
  }

  /* ── Dispose ───────────────────────────────────────── */
  public dispose() {
    WorktreeManagerPanel.currentPanel = undefined;
    this._panel.dispose();
    // Clean up metadata file watchers
    for (const w of this._metadataWatchers) { w.close(); }
    this._metadataWatchers = [];
    while (this._disposables.length) {
      const d = this._disposables.pop();
      if (d) d.dispose();
    }
  }

  /* ── Data ───────────────────────────────────────────── */
  private async _sendRepoData() {
    const repos = listRegisteredRepos();
    const results: RepoData[] = [];

    // Set up file watchers for cross-window metadata sync
    this._setupMetadataWatchers(repos);

    for (const repo of repos) {
      if (!fs.existsSync(repo.rootDir)) {
        results.push({ name: repo.name, rootDir: repo.rootDir, reachable: false, worktrees: [] });
        continue;
      }

      try {
        const git = new GitUtils(repo.rootDir);
        if (!(await git.isGitRepo())) {
          results.push({ name: repo.name, rootDir: repo.rootDir, reachable: false, worktrees: [] });
          continue;
        }

        await git.pruneWorktrees();
        const worktreesRaw = await git.listWorktrees();
        const clones = parseWorktrees(worktreesRaw, repo.rootDir);

        // Enrich with metadata
        const metadataPath = path.join(getClonesDir(repo.rootDir), METADATA_FILE);
        let metadata: Record<string, { baseBranch?: string; reviewStatus?: string }> = {};
        try {
          const raw = fs.readFileSync(metadataPath, 'utf-8');
          metadata = JSON.parse(raw);
        } catch { /* no metadata */ }

        for (const clone of clones) {
          const meta = metadata[clone.branch];
          if (meta) {
            clone.baseBranch = meta.baseBranch;
            clone.reviewStatus = meta.reviewStatus as typeof clone.reviewStatus;
          }
        }

        // First entry from `git worktree list` is always the main worktree
        if (clones.length > 0) {
          (clones[0] as any).isMain = true;
        }

        const currentBranch = await git.getCurrentBranch();
        results.push({
          name: repo.name,
          rootDir: repo.rootDir,
          reachable: true,
          worktrees: clones,
          currentBranch,
        });
      } catch {
        results.push({ name: repo.name, rootDir: repo.rootDir, reachable: false, worktrees: [] });
      }
    }

    this._panel.webview.postMessage({ command: 'setRepos', repos: results });
  }

  /** Watch all registered repos' metadata dirs for cross-window sync. */
  private _watchedDirs = new Set<string>();
  private _metaDebounce: ReturnType<typeof setTimeout> | null = null;

  private _setupMetadataWatchers(repos: { name: string; rootDir: string }[]) {
    const currentDirs = new Set(repos.map(r => getClonesDir(r.rootDir)));

    // Skip if same set of dirs already watched
    if (currentDirs.size === this._watchedDirs.size &&
        [...currentDirs].every(d => this._watchedDirs.has(d))) {
      return;
    }

    // Tear down old watchers
    for (const w of this._metadataWatchers) { w.close(); }
    this._metadataWatchers = [];
    this._watchedDirs = currentDirs;

    for (const dir of currentDirs) {
      try {
        if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); }
        const watcher = fs.watch(dir, (_, filename) => {
          if (filename && filename !== METADATA_FILE) return;
          if (this._skipNextWatch) { this._skipNextWatch = false; return; }
          if (this._metaDebounce) clearTimeout(this._metaDebounce);
          this._metaDebounce = setTimeout(() => { this._sendRepoData(); }, 200);
        });
        this._metadataWatchers.push(watcher);
      } catch {
        // Failed to watch this dir
      }
    }
  }

  /* ── HTML ───────────────────────────────────────────── */
  private _getHtmlForWebview(): string {
    const webview = this._panel.webview;
    const codiconUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'media', 'codicon.css'),
    );

    return /*html*/ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${codiconUri}">
  <style>
    /* ─── Reset & Base ──────────────────────────────── */
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { height: 100%; overflow: hidden; }
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size, 13px);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      display: flex;
      flex-direction: column;
    }

    /* ─── Header ────────────────────────────────────── */
    .header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 16px;
      border-bottom: 1px solid var(--vscode-panel-border, var(--vscode-editorGroup-border));
      flex-shrink: 0;
    }
    .header-title {
      font-size: 14px;
      font-weight: 600;
      flex: 1;
    }
    .header-btn {
      background: none;
      border: 1px solid var(--vscode-button-secondaryBackground, var(--vscode-input-border));
      color: var(--vscode-foreground);
      padding: 4px 10px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 11px;
      display: flex;
      align-items: center;
      gap: 4px;
      transition: background 0.15s;
    }
    .header-btn:hover {
      background: var(--vscode-list-hoverBackground);
    }

    /* ─── Layout ────────────────────────────────────── */
    .layout {
      display: flex;
      flex: 1;
      min-height: 0;
    }

    /* ─── Left Panel ────────────────────────────────── */
    .left-panel {
      width: 280px;
      min-width: 200px;
      border-right: 1px solid var(--vscode-panel-border, var(--vscode-editorGroup-border));
      display: flex;
      flex-direction: column;
      overflow-y: auto;
    }
    .add-repo-btn {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px 12px;
      cursor: pointer;
      font-size: 11px;
      color: var(--vscode-textLink-foreground, #3794ff);
      border-bottom: 1px solid var(--vscode-panel-border, var(--vscode-editorGroup-border));
      user-select: none;
      transition: background 0.15s;
    }
    .add-repo-btn:hover {
      background: var(--vscode-list-hoverBackground);
    }
    .repo-group {
      border-bottom: 1px solid var(--vscode-panel-border, var(--vscode-editorGroup-border));
    }
    .repo-header {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 10px;
      cursor: pointer;
      user-select: none;
      font-weight: 600;
      font-size: 12px;
      transition: background 0.15s;
    }
    .repo-header:hover {
      background: var(--vscode-list-hoverBackground);
    }
    .repo-header .chevron {
      transition: transform 0.15s;
      font-size: 10px;
      flex-shrink: 0;
    }
    .repo-header .chevron.collapsed {
      transform: rotate(-90deg);
    }
    .repo-header .repo-name {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .repo-header .repo-path {
      font-size: 10px;
      color: var(--vscode-descriptionForeground);
      font-weight: normal;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 120px;
    }
    .repo-header .repo-remove {
      opacity: 0;
      cursor: pointer;
      font-size: 10px;
      padding: 2px 4px;
      border-radius: 3px;
      color: var(--vscode-descriptionForeground);
      flex-shrink: 0;
    }
    .repo-header:hover .repo-remove { opacity: 0.6; }
    .repo-remove:hover { opacity: 1 !important; color: var(--vscode-errorForeground); }
    .repo-unreachable {
      opacity: 0.5;
    }
    .worktree-list {
      overflow: hidden;
      transition: max-height 0.2s ease;
    }
    .worktree-list.collapsed {
      max-height: 0 !important;
    }
    .worktree-item {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px 4px 24px;
      cursor: pointer;
      font-size: 11px;
      transition: background 0.15s;
      min-width: 0;
      position: relative;
    }
    .worktree-item:hover {
      background: var(--vscode-list-hoverBackground);
    }
    .worktree-item.selected {
      background: var(--vscode-list-activeSelectionBackground);
      color: var(--vscode-list-activeSelectionForeground);
    }
    .wt-icon {
      flex-shrink: 0;
      font-size: 14px;
      line-height: 1;
      display: flex;
      align-items: center;
    }
    .wt-icon.main { color: var(--vscode-foreground); }
    .wt-icon.shadow { color: var(--vscode-descriptionForeground); }
    .wt-icon.detached { color: var(--vscode-notificationsInfoIcon-foreground, #3794ff); }
    .wt-icon.status-todo { color: var(--vscode-descriptionForeground); }
    .wt-icon.status-inProgress { color: var(--vscode-notificationsInfoIcon-foreground, #3794ff); }
    .wt-icon.status-done { color: var(--vscode-charts-green, #89d185); }
    .wt-icon.status-wontDo { color: var(--vscode-errorForeground, #f44747); }
    .wt-icon.clickable { cursor: pointer; border-radius: 3px; padding: 1px; }
    .wt-icon.clickable:hover { background: var(--vscode-toolbar-hoverBackground, rgba(90,93,94,0.31)); }
    .wt-name {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* ─── Hover Inline Actions ────────────────────────── */
    .wt-actions {
      display: flex;
      gap: 2px;
      opacity: 0;
      flex-shrink: 0;
      transition: opacity 0.1s;
    }
    .worktree-item:hover .wt-actions { opacity: 1; }
    .wt-action-btn {
      background: none;
      border: none;
      color: var(--vscode-foreground);
      cursor: pointer;
      padding: 2px 4px;
      border-radius: 3px;
      font-size: 13px;
      line-height: 1;
      opacity: 0.6;
    }
    .wt-action-btn:hover {
      opacity: 1;
      background: var(--vscode-toolbar-hoverBackground, rgba(90,93,94,0.31));
    }
    .wt-action-btn.danger:hover {
      color: var(--vscode-errorForeground);
    }

    /* ─── Context Menu ────────────────────────────────── */
    .ctx-menu {
      display: none;
      position: fixed;
      z-index: 1000;
      min-width: 180px;
      background: var(--vscode-menu-background, var(--vscode-editorWidget-background));
      color: var(--vscode-menu-foreground, var(--vscode-foreground));
      border: 1px solid var(--vscode-menu-border, var(--vscode-widget-border, rgba(255,255,255,0.1)));
      border-radius: 6px;
      padding: 4px 0;
      box-shadow: 0 4px 16px rgba(0,0,0,0.3);
      font-size: 13px;
    }
    .ctx-menu.visible { display: block; }
    .ctx-item {
      padding: 6px 16px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 8px;
      white-space: nowrap;
      user-select: none;
    }
    .ctx-item:hover {
      background: var(--vscode-menu-selectionBackground, var(--vscode-list-activeSelectionBackground));
      color: var(--vscode-menu-selectionForeground, var(--vscode-list-activeSelectionForeground));
    }
    .ctx-separator {
      height: 1px;
      background: var(--vscode-menu-separatorBackground, var(--vscode-widget-border, rgba(255,255,255,0.1)));
      margin: 4px 0;
    }

    /* ─── Right Panel (Detail) ──────────────────────── */
    .right-panel {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow-y: auto;
      padding: 16px 20px;
    }
    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      flex: 1;
      color: var(--vscode-descriptionForeground);
      font-size: 13px;
      gap: 8px;
    }
    .empty-state .icon { font-size: 32px; opacity: 0.5; }
    .detail-title {
      font-size: 16px;
      font-weight: 600;
      margin-bottom: 16px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .detail-grid {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 6px 12px;
      font-size: 12px;
      margin-bottom: 16px;
    }
    .detail-label {
      color: var(--vscode-descriptionForeground);
      font-weight: 600;
      text-transform: uppercase;
      font-size: 10px;
      letter-spacing: 0.4px;
      align-self: center;
    }
    .detail-value {
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 12px;
      word-break: break-all;
    }
    .detail-future {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
      opacity: 0.5;
      border-top: 1px solid var(--vscode-panel-border, var(--vscode-editorGroup-border));
      margin-top: 16px;
      padding-top: 16px;
    }

    /* ─── Loading ───────────────────────────────────── */
    .loading {
      display: flex;
      align-items: center;
      justify-content: center;
      flex: 1;
      color: var(--vscode-descriptionForeground);
    }
  </style>
</head>
<body>

  <div class="header">
    <span class="header-title">⚙ Worktree Manager (Beta)</span>
    <button class="header-btn" id="refreshBtn" title="Refresh">↻ Refresh</button>
  </div>

  <div class="layout">
    <div class="left-panel" id="leftPanel">
      <div class="add-repo-btn" id="addRepoBtn">＋ Add Repo</div>
      <div id="repoList"><div class="loading">Loading…</div></div>
    </div>
    <div class="right-panel" id="rightPanel">
      <div class="empty-state">
        <span class="icon codicon codicon-folder"></span>
        <span>Select a worktree to view details</span>
      </div>
    </div>
  </div>

  <div class="ctx-menu" id="ctxMenu"></div>

  <script>
    const vscode = acquireVsCodeApi();
    let repos = [];
    let selectedKey = null; // "repoName:branch"
    let collapsedRepos = {};

    // ── Init ──
    vscode.postMessage({ command: 'getRepos' });

    document.getElementById('addRepoBtn').addEventListener('click', () => {
      vscode.postMessage({ command: 'addRepo' });
    });
    document.getElementById('refreshBtn').addEventListener('click', () => {
      vscode.postMessage({ command: 'refreshRepos' });
    });

    // ── Message Handler ──
    window.addEventListener('message', (event) => {
      const msg = event.data;
      switch (msg.command) {
        case 'setRepos':
          repos = msg.repos || [];
          renderRepoList();
          renderDetail();
          break;
        case 'updateStatus': {
          const statusIcons = {
            todo: 'codicon-circle-outline',
            inProgress: 'codicon-sync',
            done: 'codicon-pass-filled',
            wontDo: 'codicon-close',
          };
          const statusLabelsMap = { todo: 'Todo', inProgress: 'In Progress', done: 'Done', wontDo: "Won't Do" };

          // 1. Update in-memory repos array
          for (const r of repos) {
            if (r.rootDir !== msg.rootDir) continue;
            const wt = r.worktrees.find(w => w.branch === msg.branch);
            if (wt) { wt.reviewStatus = msg.status; }
          }

          // 2. Update DOM: find matching worktree-item(s)
          const items = document.querySelectorAll(
            '.worktree-item[data-branch="' + msg.branch + '"][data-root="' + msg.rootDir + '"]'
          );
          items.forEach(item => {
            item.setAttribute('data-status', msg.status);
            const icon = item.querySelector('.wt-icon[data-status-btn]');
            if (icon) {
              icon.className = 'wt-icon status-' + msg.status + ' clickable';
              const codicon = icon.querySelector('.codicon');
              if (codicon) {
                codicon.className = 'codicon ' + (statusIcons[msg.status] || 'codicon-circle-outline');
              }
            }
          });

          // 3. Update detail panel if this branch is currently selected
          if (selectedKey) {
            const [rn, ...bp] = selectedKey.split(':');
            const selBranch = bp.join(':');
            const selRepo = repos.find(r => r.name === rn);
            if (selRepo && selRepo.rootDir === msg.rootDir && selBranch === msg.branch) {
              // Update icon in detail title
              const detailIcon = document.querySelector('#rightPanel .detail-title .wt-icon');
              if (detailIcon) {
                detailIcon.className = 'wt-icon status-' + msg.status;
                const codicon = detailIcon.querySelector('.codicon');
                if (codicon) {
                  codicon.className = 'codicon ' + (statusIcons[msg.status] || 'codicon-circle-outline');
                }
              }
              // Update Status text in detail grid
              const labels = document.querySelectorAll('#rightPanel .detail-label');
              labels.forEach(label => {
                if (label.textContent === 'Status') {
                  const valueEl = label.nextElementSibling;
                  if (valueEl) { valueEl.textContent = statusLabelsMap[msg.status] || msg.status; }
                }
              });
            }
          }
          break;
        }
      }
    });

    // ── Repo List ──
    function renderRepoList() {
      const container = document.getElementById('repoList');
      container.innerHTML = '';

      if (repos.length === 0) {
        container.innerHTML = '<div class="loading" style="padding:16px; font-size:12px;">No repos registered. Click "+ Add Repo" to get started.</div>';
        return;
      }

      repos.forEach((repo) => {
        const group = document.createElement('div');
        group.className = 'repo-group' + (!repo.reachable ? ' repo-unreachable' : '');

        const isCollapsed = collapsedRepos[repo.name] ?? false;

        // Header
        const header = document.createElement('div');
        header.className = 'repo-header';
        header.innerHTML =
          '<span class="chevron ' + (isCollapsed ? 'collapsed' : '') + '">▼</span>' +
          '<span class="repo-name">' + escHtml(repo.name) + '</span>' +
          (!repo.reachable ? '<span style="font-size:10px;color:var(--vscode-errorForeground);">unreachable</span>' : '') +
          '<span class="repo-remove" title="Remove from Manager">✕</span>';

        const removeBtn = header.querySelector('.repo-remove');
        removeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          vscode.postMessage({ command: 'removeRepo', repoName: repo.name });
        });

        header.addEventListener('click', (e) => {
          if (e.target === removeBtn) return;
          collapsedRepos[repo.name] = !collapsedRepos[repo.name];
          renderRepoList();
        });

        group.appendChild(header);

        // Worktree list
        const list = document.createElement('div');
        list.className = 'worktree-list' + (isCollapsed ? ' collapsed' : '');
        list.style.maxHeight = isCollapsed ? '0' : (repo.worktrees.length * 30 + 4) + 'px';

        if (repo.reachable) {
          repo.worktrees.forEach((wt) => {
            const key = repo.name + ':' + wt.branch;
            const item = document.createElement('div');
            item.className = 'worktree-item' + (selectedKey === key ? ' selected' : '');
            item.setAttribute('data-branch', wt.branch);
            item.setAttribute('data-root', repo.rootDir);
            item.setAttribute('data-status', wt.reviewStatus || 'todo');

            const isMain = wt.isMain;
            const status = wt.reviewStatus || 'todo';
            let iconClass, iconCodicon;
            if (isMain) {
              iconClass = 'main';
              iconCodicon = 'codicon-home';
            } else if (wt.isDetached) {
              iconClass = 'detached';
              iconCodicon = 'codicon-sync';
            } else {
              iconClass = 'status-' + status;
              iconCodicon = status === 'inProgress' ? 'codicon-sync' : status === 'done' ? 'codicon-pass-filled' : status === 'wontDo' ? 'codicon-close' : 'codicon-circle-outline';
            }
            const clickable = (!isMain && !wt.isDetached) ? ' clickable' : '';
            item.innerHTML =
              '<span class="wt-icon ' + iconClass + clickable + '" data-status-btn="true"><span class="codicon ' + iconCodicon + '"></span></span>' +
              '<span class="wt-name">' + escHtml(wt.branch) + '</span>' +
              '<span class="wt-actions">' +
                '<button class="wt-action-btn" title="Open in New Window" data-act="open"><span class="codicon codicon-window"></span></button>' +
                (!isMain ? '<button class="wt-action-btn danger" title="Kill Shadow Clone" data-act="delete"><span class="codicon codicon-trash"></span></button>' : '') +
              '</span>';

            // Click to select
            item.addEventListener('click', (e) => {
              if (e.target.closest('.wt-action-btn')) return;
              selectedKey = key;
              renderRepoList();
              renderDetail();
            });

            // Status icon click to cycle
            const statusBtn = item.querySelector('[data-status-btn]');
            if (statusBtn && !isMain && !wt.isDetached) {
              statusBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                vscode.postMessage({ command: 'cycleStatus', branch: wt.branch, rootDir: repo.rootDir });
              });
            }

            // Hover action buttons
            item.querySelectorAll('.wt-action-btn').forEach(btn => {
              btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const act = btn.getAttribute('data-act');
                if (act === 'open') {
                  vscode.postMessage({ command: 'openWorktree', path: wt.path });
                } else if (act === 'delete') {
                  vscode.postMessage({ command: 'deleteWorktree', branch: wt.branch, rootDir: repo.rootDir, worktreePath: wt.path });
                }
              });
            });

            // Right-click context menu
            item.addEventListener('contextmenu', (e) => {
              e.preventDefault();
              e.stopPropagation();
              showContextMenu(e.clientX, e.clientY, wt, repo);
            });

            list.appendChild(item);
          });
        }

        group.appendChild(list);
        container.appendChild(group);
      });
    }

    // ── Detail ──
    function renderDetail() {
      const panel = document.getElementById('rightPanel');

      if (!selectedKey) {
        panel.innerHTML = '<div class="empty-state"><span class="icon codicon codicon-folder"></span><span>Select a worktree to view details</span></div>';
        return;
      }

      const [repoName, ...branchParts] = selectedKey.split(':');
      const branch = branchParts.join(':');
      const repo = repos.find((r) => r.name === repoName);
      if (!repo) { panel.innerHTML = ''; return; }

      const wt = repo.worktrees.find((w) => w.branch === branch);
      if (!wt) { panel.innerHTML = ''; return; }

      const isMain = wt.isMain;
      const status = wt.reviewStatus || 'todo';
      const statusLabels = { todo: 'Todo', inProgress: 'In Progress', done: 'Done', wontDo: "Won't Do" };

      let detailIconClass, detailIconCodicon;
      if (isMain) {
        detailIconClass = 'main';
        detailIconCodicon = 'codicon-home';
      } else if (wt.isDetached) {
        detailIconClass = 'detached';
        detailIconCodicon = 'codicon-sync';
      } else {
        detailIconClass = 'status-' + status;
        detailIconCodicon = status === 'inProgress' ? 'codicon-sync' : status === 'done' ? 'codicon-pass-filled' : status === 'wontDo' ? 'codicon-close' : 'codicon-circle-outline';
      }

      panel.innerHTML =
        '<div class="detail-title">' +
          '<span class="wt-icon ' + detailIconClass + '" style="font-size:16px;"><span class="codicon ' + detailIconCodicon + '"></span></span>' +
          escHtml(wt.branch) +
        '</div>' +
        '<div class="detail-grid">' +
          '<span class="detail-label">Repo</span><span class="detail-value">' + escHtml(repo.name) + '</span>' +
          '<span class="detail-label">Type</span><span class="detail-value">' + (isMain ? 'Main worktree' : (wt.isDetached ? 'Detached HEAD' : 'Shadow Clone')) + '</span>' +
          (!isMain && !wt.isDetached ? '<span class="detail-label">Status</span><span class="detail-value">' + (statusLabels[status] || status) + '</span>' : '') +
          (wt.baseBranch ? '<span class="detail-label">Base</span><span class="detail-value">' + escHtml(wt.baseBranch) + '</span>' : '') +
          '<span class="detail-label">Path</span><span class="detail-value">' + escHtml(wt.path) + '</span>' +
        '</div>' +
        '<div class="detail-future">Changed files will appear here</div>';
    }

    // ── Context Menu ──
    let ctxTarget = null;
    function showContextMenu(x, y, wt, repo) {
      const menu = document.getElementById('ctxMenu');
      const isMain = wt.isMain;
      ctxTarget = { wt, repo };

      let items = '';
      items += '<div class="ctx-item" data-action="copyBranch">Copy Branch Name</div>';
      items += '<div class="ctx-item" data-action="open"><span class="codicon codicon-window"></span> Open in New Window</div>';
      if (!isMain) {
        items += '<div class="ctx-separator"></div>';
        items += '<div class="ctx-item" data-action="kill">Lumi-Ops: Kill Shadow Clone</div>';
      }
      menu.innerHTML = items;

      // Position
      menu.style.left = x + 'px';
      menu.style.top = y + 'px';
      menu.classList.add('visible');

      // Adjust if off-screen
      requestAnimationFrame(() => {
        const rect = menu.getBoundingClientRect();
        if (rect.right > window.innerWidth) menu.style.left = (window.innerWidth - rect.width - 4) + 'px';
        if (rect.bottom > window.innerHeight) menu.style.top = (window.innerHeight - rect.height - 4) + 'px';
      });

      // Bind clicks
      menu.querySelectorAll('.ctx-item').forEach(el => {
        el.addEventListener('click', () => {
          const action = el.getAttribute('data-action');
          if (action === 'copyBranch') vscode.postMessage({ command: 'copyText', text: wt.branch });
          else if (action === 'open') vscode.postMessage({ command: 'openWorktree', path: wt.path });
          else if (action === 'kill') vscode.postMessage({ command: 'deleteWorktree', branch: wt.branch, rootDir: repo.rootDir, worktreePath: wt.path });
          hideContextMenu();
        });
      });
    }
    function hideContextMenu() {
      document.getElementById('ctxMenu').classList.remove('visible');
      ctxTarget = null;
    }
    document.addEventListener('click', hideContextMenu);
    document.addEventListener('contextmenu', (e) => {
      if (!e.target.closest('.worktree-item')) hideContextMenu();
    });

    function escHtml(str) {
      const div = document.createElement('div');
      div.textContent = str || '';
      return div.innerHTML;
    }
  </script>
</body>
</html>`;
  }
}

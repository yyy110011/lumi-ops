import * as vscode from 'vscode';

export class ShadowCreatorProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'lumi-ops.creator';

  private _view?: vscode.WebviewView;

  constructor(private readonly _extensionUri: vscode.Uri) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri]
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(data => {
      switch (data.command) {
        case 'spawn':
          vscode.commands.executeCommand('lumi-ops.spawn', {
            branch: data.branch,
            description: data.description,
            baseBranch: data.baseBranch,
            templates: data.templates
          });
          break;
        case 'getBranches':
          vscode.commands.executeCommand('lumi-ops.getBranches');
          break;
        case 'getPrompts':
          vscode.commands.executeCommand('lumi-ops._getPrompts', data.scopes);
          break;
        case 'selectPrompt':
          vscode.commands.executeCommand('lumi-ops._selectPrompt', data.fileName, data.scope);
          break;
        case 'importFolder':
          vscode.commands.executeCommand('lumi-ops._importFolder', data.scope);
          break;
        case 'addPrompt':
          vscode.commands.executeCommand('lumi-ops._addPrompt', data.scope);
          break;
        case 'deletePrompt':
          vscode.commands.executeCommand('lumi-ops._deletePrompt', data.fileName, data.scope);
          break;
        case 'movePrompt':
          vscode.commands.executeCommand('lumi-ops._movePrompt', data.fileName, data.fromScope, data.toScope);
          break;
        case 'saveAsPrompt':
          vscode.commands.executeCommand('lumi-ops.saveAsPrompt', data.content, data.scope);
          break;
        case 'getCloneBranches':
          vscode.commands.executeCommand('lumi-ops._getCloneBranches');
          break;
      }
    });
  }

  public updateBranches(branches: { name: string; isRemote: boolean }[], currentBranch: string, worktreeBranches: string[] = []) {
    if (this._view) {
      this._view.webview.postMessage({ command: 'setBranches', branches, currentBranch, worktreeBranches });
    }
  }

  public resetForm() {
    if (this._view) {
      this._view.webview.postMessage({ command: 'resetForm' });
    }
  }

  public loadPrompt(name: string, content: string) {
    if (this._view) {
      this._view.show?.(true);
      this._view.webview.postMessage({ command: 'loadPrompt', name, content });
    }
  }

  public updatePrompts(prompts: { name: string; fileName: string; preview: string; scope: string }[]) {
    if (this._view) {
      this._view.webview.postMessage({ command: 'setPrompts', prompts });
    }
  }

  public updateCloneBranches(cloneBranches: string[]) {
    if (this._view) {
      this._view.webview.postMessage({ command: 'setCloneBranches', cloneBranches });
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview) {
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        html, body {
          height: 100%;
          margin: 0;
        }
        body {
          padding: 6px 8px;
          font-family: var(--vscode-font-family);
          font-size: var(--vscode-font-size, 13px);
          color: var(--vscode-foreground);
          display: flex;
          flex-direction: column;
          box-sizing: border-box;
        }
        .form-group {
          margin-bottom: 8px;
        }
        label {
          display: block;
          margin-bottom: 3px;
          font-size: 11px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.4px;
          color: var(--vscode-foreground);
        }
        input, textarea, select {
          width: 100%;
          box-sizing: border-box;
          padding: 4px 8px;
          font-size: 12px;
          background: var(--vscode-input-background);
          color: var(--vscode-input-foreground);
          border: 1px solid var(--vscode-input-border);
          border-radius: 3px;
        }

        /* -- Dropdown items -- */
        .branch-dropdown {
          display: none;
          position: absolute;
          top: 100%;
          left: 0;
          right: 0;
          max-height: 200px;
          overflow-y: auto;
          background: var(--vscode-dropdown-background, var(--vscode-input-background));
          border: 1px solid var(--vscode-dropdown-border, var(--vscode-input-border));
          border-radius: 4px;
          z-index: 100;
          margin-top: 1px;
        }
        .branch-dropdown.show { display: block; }
        .branch-dropdown-item {
          padding: 4px 8px;
          cursor: pointer;
          font-size: 11px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .branch-dropdown-item:hover {
          background: var(--vscode-list-hoverBackground);
        }
        .branch-dropdown-item.selected {
          background: var(--vscode-list-activeSelectionBackground);
          color: var(--vscode-list-activeSelectionForeground);
        }
        .branch-dropdown-item.remote {
          color: var(--vscode-descriptionForeground);
        }
        .branch-dropdown-item.remote .remote-icon {
          margin-right: 4px;
          font-size: 10px;
        }
        .branch-dropdown-separator {
          border-top: 1px solid var(--vscode-input-border);
          margin: 4px 0;
          padding: 2px 10px 0;
          font-size: 10px;
          color: var(--vscode-descriptionForeground);
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .branch-dropdown-empty {
          padding: 8px 10px;
          font-size: 12px;
          color: var(--vscode-descriptionForeground);
          font-style: italic;
        }
        .branch-wrapper {
          position: relative;
        }
        button#spawnBtn {
          width: 100%;
          padding: 6px;
          font-size: 12px;
          background: var(--vscode-button-background);
          color: var(--vscode-button-foreground);
          border: none;
          border-radius: 3px;
          cursor: pointer;
          font-weight: 600;
        }
        button#spawnBtn:hover {
          background: var(--vscode-button-hoverBackground);
        }

        /* -- Prompts Section (integrated with Task Description) -- */
        .prompts-section {
          position: relative;
          flex: 1;
          display: flex;
          flex-direction: column;
          min-height: 0;
        }
        .desc-label-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 4px;
        }
        .desc-label-row label {
          margin-bottom: 0;
        }
        .prompts-trigger {
          display: inline-flex;
          align-items: center;
          gap: 3px;
          padding: 2px 6px;
          font-size: 10px;
          color: var(--vscode-descriptionForeground);
          cursor: pointer;
          user-select: none;
          border-radius: 3px;
          transition: all 0.15s;
        }
        .prompts-trigger:hover {
          color: var(--vscode-foreground);
          background: var(--vscode-list-hoverBackground);
        }
        .prompts-trigger svg {
          transition: transform 0.15s;
        }
        .desc-panel-wrapper {
          position: relative;
          flex: 1;
          min-height: 0;
        }
        .prompts-dropdown {
          display: none;
          position: absolute;
          inset: 0;
          flex-direction: column;
          box-sizing: border-box;
          border: 1px solid var(--vscode-input-border);
          border-radius: 3px;
          overflow: hidden;
          background: var(--vscode-input-background);
          z-index: 1;
        }
        .prompts-dropdown.show {
          display: flex;
        }
        .scope-filter-bar {
          display: flex;
          gap: 4px;
          padding: 4px 8px;
          border-bottom: 1px solid var(--vscode-input-border);
          flex-wrap: nowrap;
          overflow: hidden;
          align-items: center;
        }
        .scope-toggle {
          font-size: 10px;
          padding: 2px 8px;
          border: 1px solid var(--vscode-input-border);
          border-radius: 10px;
          background: transparent;
          color: var(--vscode-descriptionForeground);
          cursor: pointer;
          user-select: none;
          transition: all 0.15s;
        }
        .scope-toggle.active {
          background: var(--vscode-badge-background);
          color: var(--vscode-badge-foreground);
          border-color: var(--vscode-badge-background);
        }
        .scope-toggle:hover:not(.active) {
          border-color: var(--vscode-focusBorder);
          color: var(--vscode-foreground);
        }
        .prompt-scope-badge {
          flex-shrink: 0;
          font-size: 9px;
          padding: 0 4px;
          border-radius: 3px;
          cursor: pointer;
          transition: opacity 0.15s;
          font-weight: 600;
        }
        .prompt-scope-badge:hover {
          opacity: 1 !important;
        }
        .prompt-scope-badge.scope-project {
          background: var(--vscode-badge-background);
          color: var(--vscode-badge-foreground);
          opacity: 0.6;
        }
        .prompt-scope-badge.scope-global {
          background: #e8a317;
          color: #1e1e1e;
          opacity: 0.85;
        }
        .prompt-item {
          display: flex;
          align-items: center;
          padding: 4px 8px;
          cursor: pointer;
          font-size: 11px;
          gap: 5px;
          min-width: 0;
          overflow: hidden;
        }
        .prompt-item:hover {
          background: var(--vscode-list-hoverBackground);
        }
        .prompt-item.selected {
          background: var(--vscode-list-activeSelectionBackground);
          color: var(--vscode-list-activeSelectionForeground);
        }
        .prompt-item-name {
          flex: 1;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .prompt-item-indicator {
          flex-shrink: 0;
          font-size: 10px;
          color: var(--vscode-charts-green, #89d185);
        }
        .prompt-item-delete {
          flex-shrink: 0;
          opacity: 0;
          cursor: pointer;
          font-size: 10px;
          padding: 2px;
          color: var(--vscode-descriptionForeground);
        }
        .prompt-item:hover .prompt-item-delete {
          opacity: 0.6;
        }
        .prompt-item-delete:hover {
          opacity: 1 !important;
          color: var(--vscode-errorForeground);
        }
        .prompts-empty {
          padding: 8px;
          font-size: 10px;
          color: var(--vscode-descriptionForeground);
          font-style: italic;
          text-align: center;
        }

        /* -- Textarea + seamless Save as Template -- */
        .desc-container {
          border: 1px solid var(--vscode-input-border);
          border-radius: 3px;
          overflow: hidden;
          box-sizing: border-box;
          display: flex;
          flex-direction: column;
          height: 100%;
        }
        .desc-container textarea {
          border: none;
          border-radius: 0;
          resize: none;
          flex: 1;
          min-height: 80px;
        }
        .desc-container textarea:focus {
          outline: none;
        }
        .save-template-btn {
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 3px 8px;
          background: transparent;
          border: none;
          cursor: pointer;
          font-size: 11px;
          color: var(--vscode-descriptionForeground);
          user-select: none;
          width: 100%;
        }
        .save-template-btn:hover {
          color: var(--vscode-foreground);
          background: var(--vscode-list-hoverBackground);
        }
        .save-template-btn svg {
          flex-shrink: 0;
        }

        /* -- SVG icon base -- */
        .icon-btn svg {
          width: 14px;
          height: 14px;
          vertical-align: middle;
        }
      </style>
    </head>
    <body>
      <!-- Branch Name -->
      <div class="form-group">
        <label for="branch">Branch Name</label>
        <div class="branch-wrapper">
          <input type="text" id="branch" placeholder="feature/new-task">
          <div class="branch-dropdown" id="branchDropdown"></div>
        </div>
      </div>

      <!-- Base Branch -->
      <div class="form-group" id="baseBranchGroup">
        <label for="baseBranchInput">Base Branch</label>
        <div class="branch-wrapper">
          <input type="text" id="baseBranchInput" placeholder="loading...">
          <div class="branch-dropdown" id="baseBranchDropdown"></div>
        </div>
      </div>

      <!-- Task Description + Prompts -->
      <div class="form-group prompts-section">
        <div class="desc-label-row">
          <label for="description">Task Description</label>
          <span class="prompts-trigger" id="promptsHeader">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4h12M2 4l2-2h4l2 2M2 4v9a1 1 0 001 1h10a1 1 0 001-1V4"/></svg>
            <span>Prompts</span>
            <span id="promptsCount" style="font-size:10px; color:var(--vscode-descriptionForeground);"></span>
            <span id="promptsChevron"><svg width="8" height="8" viewBox="0 0 16 16" fill="currentColor"><path d="M4 6l4 4 4-4"/></svg></span>
          </span>
        </div>
        <div class="desc-panel-wrapper">
          <div class="prompts-dropdown" id="promptsDropdown"></div>
          <div class="desc-container">
            <textarea id="description" placeholder="Describe the objective for the AI Agent..."></textarea>
            <button class="save-template-btn" id="saveAsTemplateBtn" title="Save as Template">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M3 1h8l3 3v9a2 2 0 01-2 2H3a2 2 0 01-2-2V3a2 2 0 012-2z"/><path d="M5 1v4h6V1"/><circle cx="8" cy="10" r="2"/></svg>
              Save as Template
            </button>
          </div>
        </div>
      </div>

      <button id="spawnBtn">Create Clone Only</button>

      <script>
        const vscode = acquireVsCodeApi();
        let branches = [];
        let currentBranch = '';
        let selectedBaseBranch = '';
        let worktreeBranches = [];
        let prompts = [];
        let cloneBranches = [];  // branches that already have active clones
        let selectedPromptFileName = null;
        let selectedPromptScope = null;
        let showGlobal = true;
        let showProject = true;

        const branchInput = document.getElementById('branch');
        const dropdown = document.getElementById('branchDropdown');

        const baseBranchInput = document.getElementById('baseBranchInput');
        const baseDropdown = document.getElementById('baseBranchDropdown');

        const baseBranchGroup = document.getElementById('baseBranchGroup');
        const descriptionEl = document.getElementById('description');
        const spawnBtn = document.getElementById('spawnBtn');

        // === Prompts Dropdown ===
        const promptsHeader = document.getElementById('promptsHeader');
        const promptsDropdown = document.getElementById('promptsDropdown');
        const promptsChevron = document.getElementById('promptsChevron');
        const promptsCount = document.getElementById('promptsCount');

        // Request data on load
        vscode.postMessage({ command: 'getBranches' });
        vscode.postMessage({ command: 'getPrompts', scopes: getActiveScopes() });
        vscode.postMessage({ command: 'getCloneBranches' });

        function getActiveScopes() {
          const s = [];
          if (showGlobal) s.push('global');
          if (showProject) s.push('project');
          return s.length > 0 ? s : ['project'];
        }

        function showPromptsDropdown() {
          renderPrompts();
          promptsDropdown.classList.add('show');
          promptsChevron.style.transform = 'rotate(180deg)';
          // Close other dropdowns
          hideDropdown();
          hideBaseDropdown();
        }

        function hidePromptsDropdown() {
          promptsDropdown.classList.remove('show');
          promptsChevron.style.transform = '';
        }

        // === Prompts toggle ===
        promptsHeader.addEventListener('click', (e) => {
          if (promptsDropdown.classList.contains('show')) {
            hidePromptsDropdown();
          } else {
            showPromptsDropdown();
          }
        });

        function deriveBranch(fileName) {
          // phase-1-auth.md → feat/phase-1-auth
          const name = fileName.replace(/\\.md$/, '');
          return 'feat/' + name;
        }

        function renderPrompts() {
          promptsDropdown.innerHTML = '';

          // -- Filter bar --
          const filterBar = document.createElement('div');
          filterBar.className = 'scope-filter-bar';
          ['project', 'global'].forEach(scope => {
            const btn = document.createElement('button');
            btn.className = 'scope-toggle' + ((scope === 'project' ? showProject : showGlobal) ? ' active' : '');
            btn.textContent = scope.charAt(0).toUpperCase() + scope.slice(1);
            btn.addEventListener('click', (e) => {
              e.stopPropagation();
              if (scope === 'project') showProject = !showProject;
              else showGlobal = !showGlobal;
              // Ensure at least one is active
              if (!showProject && !showGlobal) {
                if (scope === 'project') showGlobal = true;
                else showProject = true;
              }
              vscode.postMessage({ command: 'getPrompts', scopes: getActiveScopes() });
            });
            filterBar.appendChild(btn);
          });
          promptsDropdown.appendChild(filterBar);

          // -- Action buttons in filter bar --
          const spacer = document.createElement('span');
          spacer.style.flex = '1';
          filterBar.appendChild(spacer);

          const importBtn = document.createElement('button');
          importBtn.className = 'scope-toggle';
          importBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v8M5 7l3 3 3-3"/><path d="M2 11v2a1 1 0 001 1h10a1 1 0 001-1v-2"/></svg>';
          importBtn.title = 'Import prompts';
          importBtn.style.padding = '2px 5px';
          importBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            vscode.postMessage({ command: 'importFolder', scope: showProject ? 'project' : 'global' });
          });
          filterBar.appendChild(importBtn);

          // -- Prompt list container --
          const listContainer = document.createElement('div');
          listContainer.style.flex = '1';
          listContainer.style.overflowY = 'auto';

          const filtered = prompts.filter(p => {
            if (p.scope === 'project' && showProject) return true;
            if (p.scope === 'global' && showGlobal) return true;
            return false;
          });

          promptsCount.textContent = filtered.length > 0 ? '(' + filtered.length + ')' : '';

          if (filtered.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'prompts-empty';
            empty.textContent = 'No prompts yet \u2014 import a folder or add one';
            listContainer.appendChild(empty);
            promptsDropdown.appendChild(listContainer);
            return;
          }

          const cloneSet = new Set(cloneBranches);

          filtered.forEach(p => {
            const item = document.createElement('div');
            item.className = 'prompt-item' + (selectedPromptFileName === p.fileName && selectedPromptScope === p.scope ? ' selected' : '');

            // Indicator
            const derived = deriveBranch(p.fileName);
            const hasClone = cloneSet.has(derived) || cloneSet.has(p.name);
            const indicator = document.createElement('span');
            indicator.className = 'prompt-item-indicator';
            indicator.textContent = hasClone ? '\u2726' : '';
            indicator.title = hasClone ? 'Clone exists for this prompt' : '';

            const nameSpan = document.createElement('span');
            nameSpan.className = 'prompt-item-name';
            nameSpan.textContent = p.name;
            nameSpan.title = p.preview || p.name;

            // Scope badge — click to move between scopes
            const badge = document.createElement('span');
            badge.className = 'prompt-scope-badge scope-' + p.scope;
            badge.textContent = p.scope === 'global' ? 'G' : 'P';
            const targetScope = p.scope === 'global' ? 'project' : 'global';
            badge.title = 'Move to ' + targetScope;
            badge.addEventListener('click', (e) => {
              e.stopPropagation();
              vscode.postMessage({ command: 'movePrompt', fileName: p.fileName, fromScope: p.scope, toScope: targetScope });
            });

            const deleteBtn = document.createElement('span');
            deleteBtn.className = 'prompt-item-delete';
            deleteBtn.textContent = '\u2715';
            deleteBtn.title = 'Delete prompt';
            deleteBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              vscode.postMessage({ command: 'deletePrompt', fileName: p.fileName, scope: p.scope });
            });

            item.appendChild(indicator);
            item.appendChild(nameSpan);
            item.appendChild(badge);
            item.appendChild(deleteBtn);

            item.addEventListener('click', () => {
              selectedPromptFileName = p.fileName;
              selectedPromptScope = p.scope;
              vscode.postMessage({ command: 'selectPrompt', fileName: p.fileName, scope: p.scope });
              branchInput.value = deriveBranch(p.fileName);
              updateBaseBranchVisibility();
              hidePromptsDropdown();
            });

            listContainer.appendChild(item);
          });
          promptsDropdown.appendChild(listContainer);
        }

        // === Message handler ===
        window.addEventListener('message', event => {
          const msg = event.data;
          switch (msg.command) {
            case 'setBranches':
              branches = msg.branches || [];
              worktreeBranches = msg.worktreeBranches || [];
              const newCurrent = msg.currentBranch || '';
              if (newCurrent !== currentBranch || !selectedBaseBranch) {
                currentBranch = newCurrent;
                selectedBaseBranch = currentBranch;
                baseBranchInput.value = selectedBaseBranch;
              }
              currentBranch = newCurrent;
              updateBaseBranchVisibility();
              if (dropdown.classList.contains('show')) showDropdown();
              if (baseDropdown.classList.contains('show')) showBaseDropdown();
              break;

            case 'setPrompts':
              prompts = msg.prompts || [];
              renderPrompts();
              break;

            case 'setCloneBranches':
              cloneBranches = msg.cloneBranches || [];
              renderPrompts();
              break;

            case 'resetForm':
              branchInput.value = '';
              descriptionEl.value = '';
              selectedPromptFileName = null;
              spawnBtn.textContent = 'Create Clone Only';
              selectedBaseBranch = currentBranch;
              baseBranchInput.value = selectedBaseBranch;
              updateBaseBranchVisibility();
              vscode.postMessage({ command: 'getBranches' });
              vscode.postMessage({ command: 'getCloneBranches' });
              break;

            case 'loadPrompt':
              descriptionEl.value = msg.content;
              updateSpawnBtnText();
              break;
          }
        });

        // === Branch Name Dropdown ===
        function isNewBranch() {
          const name = branchInput.value.trim();
          if (!name) return true;
          return !branches.some(b => b.name === name);
        }

        function updateBaseBranchVisibility() {
          baseBranchGroup.style.display = isNewBranch() ? '' : 'none';
        }

        function renderBranchItems() {
          dropdown.innerHTML = '';
          const filter = branchInput.value.toLowerCase();
          const worktreeSet = new Set(worktreeBranches);
          const available = branches.filter(b => !worktreeSet.has(b.name));
          const localFiltered = available.filter(b => !b.isRemote && b.name.toLowerCase().includes(filter));
          const remoteFiltered = available.filter(b => b.isRemote && b.name.toLowerCase().includes(filter));

          if (localFiltered.length === 0 && remoteFiltered.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'branch-dropdown-empty';
            empty.textContent = filter ? '+ Create new branch: ' + branchInput.value.trim() : 'No branches available';
            dropdown.appendChild(empty);
          } else {
            localFiltered.forEach(b => {
              const item = document.createElement('div');
              item.className = 'branch-dropdown-item';
              item.textContent = b.name;
              item.addEventListener('click', () => {
                branchInput.value = b.name;
                hideDropdown();
                updateBaseBranchVisibility();
              });
              dropdown.appendChild(item);
            });

            if (remoteFiltered.length > 0) {
              if (localFiltered.length > 0) {
                const sep = document.createElement('div');
                sep.className = 'branch-dropdown-separator';
                sep.textContent = 'Remote';
                dropdown.appendChild(sep);
              }
              remoteFiltered.forEach(b => {
                const item = document.createElement('div');
                item.className = 'branch-dropdown-item remote';
                item.innerHTML = '<span class="remote-icon">☁</span>' + b.name;
                item.addEventListener('click', () => {
                  branchInput.value = b.name;
                  hideDropdown();
                  updateBaseBranchVisibility();
                });
                dropdown.appendChild(item);
              });
            }
          }
        }

        function showDropdown() {
          renderBranchItems();
          dropdown.classList.add('show');
        }

        function hideDropdown() {
          dropdown.classList.remove('show');
        }

        branchInput.addEventListener('input', () => {
          updateBaseBranchVisibility();
          if (dropdown.classList.contains('show')) renderBranchItems();
        });

        branchInput.addEventListener('mousedown', () => {
          hideBaseDropdown();
          hidePromptsDropdown();
          if (!dropdown.classList.contains('show')) {
            vscode.postMessage({ command: 'getBranches' });
            showDropdown();
          }
        });

        branchInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === 'Tab') hideDropdown();
        });

        // === Base Branch Dropdown ===
        function renderBaseItems() {
          baseDropdown.innerHTML = '';
          const filter = baseBranchInput.value.toLowerCase();
          const selectedBranch = branchInput.value.trim();
          const allBranches = [
            { name: currentBranch, isRemote: false, isCurrent: true },
            ...branches.filter(b => b.name !== currentBranch)
          ].filter(b => b.name !== selectedBranch);

          const localItems = allBranches.filter(b => !b.isRemote && b.name.toLowerCase().includes(filter));
          const remoteItems = allBranches.filter(b => b.isRemote && b.name.toLowerCase().includes(filter));

          if (localItems.length === 0 && remoteItems.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'branch-dropdown-empty';
            empty.textContent = filter ? 'No matching branches' : 'No branches available';
            baseDropdown.appendChild(empty);
            return;
          }

          localItems.forEach(b => {
            const item = document.createElement('div');
            item.className = 'branch-dropdown-item' + (b.name === selectedBaseBranch ? ' selected' : '');
            item.textContent = b.name + (b.isCurrent ? ' ← current' : '');
            item.addEventListener('click', () => {
              selectedBaseBranch = b.name;
              baseBranchInput.value = b.name;
              hideBaseDropdown();
            });
            baseDropdown.appendChild(item);
          });

          if (remoteItems.length > 0) {
            if (localItems.length > 0) {
              const sep = document.createElement('div');
              sep.className = 'branch-dropdown-separator';
              sep.textContent = 'Remote';
              baseDropdown.appendChild(sep);
            }
            remoteItems.forEach(b => {
              const item = document.createElement('div');
              item.className = 'branch-dropdown-item remote' + (b.name === selectedBaseBranch ? ' selected' : '');
              item.innerHTML = '<span class="remote-icon">☁</span>' + b.name;
              item.addEventListener('click', () => {
                selectedBaseBranch = b.name;
                baseBranchInput.value = b.name;
                hideBaseDropdown();
              });
              baseDropdown.appendChild(item);
            });
          }
        }

        function showBaseDropdown() {
          renderBaseItems();
          baseDropdown.classList.add('show');
        }

        function hideBaseDropdown() {
          baseDropdown.classList.remove('show');
        }

        // Close dropdowns when clicking outside (replaces overlay pattern)
        document.addEventListener('mousedown', (e) => {
          const target = e.target;
          const inBranch = branchInput.contains(target) || dropdown.contains(target);
          const inBase = baseBranchInput.contains(target) || baseDropdown.contains(target);
          const inPrompts = promptsHeader.contains(target) || promptsDropdown.contains(target);
          if (!inBranch && dropdown.classList.contains('show')) {
            hideDropdown();
          }
          if (!inBase && baseDropdown.classList.contains('show')) {
            hideBaseDropdown();
          }
          if (!inPrompts && promptsDropdown.classList.contains('show')) {
            hidePromptsDropdown();
          }
        });

        // Close dropdowns when webview loses focus (click outside webview iframe)
        window.addEventListener('blur', () => {
          hideDropdown();
          hideBaseDropdown();
          hidePromptsDropdown();
        });

        // Close dropdowns on Escape key
        document.addEventListener('keydown', (e) => {
          if (e.key === 'Escape') {
            hideDropdown();
            hideBaseDropdown();
            hidePromptsDropdown();
          }
        });

        baseBranchInput.addEventListener('input', () => {
          if (baseDropdown.classList.contains('show')) renderBaseItems();
        });

        baseBranchInput.addEventListener('mousedown', () => {
          hideDropdown();
          hidePromptsDropdown();
          if (!baseDropdown.classList.contains('show')) {
            vscode.postMessage({ command: 'getBranches' });
            showBaseDropdown();
          }
        });

        baseBranchInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === 'Tab') hideBaseDropdown();
        });

        // === Spawn Button ===
        function updateSpawnBtnText() {
          spawnBtn.textContent = descriptionEl.value.trim() ? 'Spawn Agent' : 'Create Clone Only';
        }
        descriptionEl.addEventListener('input', updateSpawnBtnText);

        // === Save as Template (footer bar) ===
        document.getElementById('saveAsTemplateBtn').addEventListener('click', () => {
          const content = descriptionEl.value.trim();
          if (content) {
            vscode.postMessage({ command: 'saveAsPrompt', content, scope: showProject ? 'project' : 'global' });
          }
        });

        // === Spawn ===
        spawnBtn.addEventListener('click', () => {
          const branch = branchInput.value;
          const description = descriptionEl.value;

          if (branch) {
            vscode.postMessage({
              command: 'spawn',
              branch: branch,
              description: description,
              baseBranch: selectedBaseBranch
            });
          }
        });
      </script>
    </body>
    </html>`;
  }
}

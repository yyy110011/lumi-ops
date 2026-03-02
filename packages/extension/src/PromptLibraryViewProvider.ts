import * as vscode from 'vscode';

export class PromptLibraryViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'lumi-ops.promptLibrary';

  private _view?: vscode.WebviewView;
  private _activeMissionName: string = 'default';
  private _missionTemplates: { name: string; fileName: string; scope: string }[] = [];

  constructor(
    private readonly _extensionUri: vscode.Uri,
  ) {}

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

    webviewView.webview.html = this._getHtml();

    webviewView.webview.onDidReceiveMessage(data => {
      switch (data.command) {
        case 'getPrompts':
          vscode.commands.executeCommand('lumi-ops._getPrompts', data.scopes);
          break;
        case 'selectPrompt':
          vscode.commands.executeCommand('lumi-ops._selectPrompt', data.fileName, data.scope);
          break;
        case 'importFolder':
          vscode.commands.executeCommand('lumi-ops._importFolder', data.scope);
          break;
        case 'createPromptInline':
          vscode.commands.executeCommand('lumi-ops._createPromptInline', data.name, data.scope);
          break;
        case 'deletePrompt':
          vscode.commands.executeCommand('lumi-ops._deletePrompt', data.fileName, data.scope);
          break;
        case 'copyPromptScope':
          vscode.commands.executeCommand('lumi-ops._copyPromptScope', data.fileName, data.fromScope, data.toScope);
          break;
        case 'editPrompt':
          vscode.commands.executeCommand('lumi-ops._editPrompt', data.fileName, data.scope);
          break;
        case 'getCloneBranches':
          vscode.commands.executeCommand('lumi-ops._getCloneBranches');
          break;
        // Mission template messages
        case 'switchMission':
          vscode.commands.executeCommand('lumi-ops._switchMission', data.name, data.scope);
          break;
        case 'editMission':
          vscode.commands.executeCommand('lumi-ops._editMission');
          break;
        case 'forkMission':
          vscode.commands.executeCommand('lumi-ops._forkMission');
          break;
        case 'getMissionTemplates':
          vscode.commands.executeCommand('lumi-ops._getMissionTemplates');
          break;
        case 'copyMissionScope':
          vscode.commands.executeCommand('lumi-ops._copyMissionScope', data.name, data.fromScope, data.toScope);
          break;
        case 'editMissionByName':
          vscode.commands.executeCommand('lumi-ops._editMissionByName', data.name, data.scope);
          break;
        case 'deleteMission':
          vscode.commands.executeCommand('lumi-ops._deleteMission', data.name, data.scope);
          break;
      }
    });
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

  public updateMissionTemplate(activeName: string, templates: { name: string; fileName: string; scope: string }[]) {
    this._activeMissionName = activeName;
    this._missionTemplates = templates;
    if (this._view) {
      this._view.webview.postMessage({ command: 'setMission', activeName, templates });
    }
  }

  private _getHtml() {
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

        /* -- Scope filter bar -- */
        .scope-filter-bar {
          display: flex;
          gap: 4px;
          padding: 4px 0;
          flex-wrap: nowrap;
          overflow: hidden;
          align-items: center;
          margin-bottom: 4px;
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

        /* -- Prompt items -- */
        .prompt-list {
          flex: 1;
          overflow-y: auto;
          min-height: 0;
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
        .prompt-item-action {
          flex-shrink: 0;
          opacity: 0;
          cursor: pointer;
          font-size: 10px;
          padding: 2px;
          color: var(--vscode-descriptionForeground);
          display: flex;
          align-items: center;
        }
        .prompt-item:hover .prompt-item-action {
          opacity: 0.6;
        }
        .prompt-item-action:hover {
          opacity: 1 !important;
        }
        .prompt-item-action.copy:hover {
          color: var(--vscode-foreground);
        }
        .prompt-item-action.edit:hover {
          color: var(--vscode-foreground);
        }
        .prompt-item-action.delete:hover {
          color: var(--vscode-errorForeground);
        }
        .prompts-empty {
          padding: 8px;
          font-size: 10px;
          color: var(--vscode-descriptionForeground);
          font-style: italic;
          text-align: center;
        }
        /* -- Mission wrapper (positioning anchor) -- */
        .mission-wrapper {
          position: relative;
        }
        /* -- Mission row -- */
        .mission-row {
          display: flex;
          align-items: center;
          padding: 4px 8px;
          cursor: pointer;
          font-size: 11px;
          gap: 5px;
          border: 1px solid var(--vscode-input-border);
          border-radius: 4px;
          user-select: none;
        }
        .mission-wrapper.dropdown-open .mission-row {
          border-radius: 4px 4px 0 0;
          border-bottom-color: transparent;
        }
        .mission-row:hover {
          background: var(--vscode-list-hoverBackground);
        }
        .mission-row-label {
          flex: 1;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-weight: 600;
        }
        .mission-row-label .icon {
          margin-right: 3px;
        }
        .mission-row-action {
          flex-shrink: 0;
          opacity: 0;
          cursor: pointer;
          font-size: 10px;
          padding: 2px;
          color: var(--vscode-descriptionForeground);
          display: flex;
          align-items: center;
        }
        .mission-row:hover .mission-row-action {
          opacity: 0.6;
        }
        .mission-row-action:hover {
          opacity: 1 !important;
          color: var(--vscode-foreground);
        }
        .mission-dropdown {
          display: none;
          position: absolute;
          top: 100%;
          left: 0;
          right: 0;
          max-height: 200px;
          overflow-y: auto;
          background: var(--vscode-dropdown-background, var(--vscode-input-background));
          border: 1px solid var(--vscode-dropdown-border, var(--vscode-input-border));
          border-top: none;
          border-radius: 0 0 4px 4px;
          z-index: 100;
        }
        .mission-dropdown.show { display: block; }
      </style>
    </head>
    <body>

      <div class="mission-wrapper" id="missionWrapper">
        <div class="mission-row" id="missionRow">
          <span class="mission-row-label" id="missionLabel" title="Click to switch template">
            <span class="icon" style="margin-right: 4px;">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style="vertical-align: text-bottom;">
                <path fill-rule="evenodd" clip-rule="evenodd" d="M11 1.5H5.5L4 3v10l1.5 1.5H11l1.5-1.5V3L11 1.5zm.5 11l-.5.5H5.5l-.5-.5V3l.5-.5H11l.5.5v9.5z"/>
                <path d="M6 5h4v1H6V5zm4 2H6v1h4V7zm-4 2h4v1H6V9z"/>
              </svg>
            </span> Mission: <span id="missionName">default</span> <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" style="vertical-align: text-bottom;"><path d="M4 6l4 4 4-4z"/></svg>
          </span>
          <span id="missionScopeBadge" class="prompt-scope-badge" style="display:none"></span>
          <span class="mission-row-action" id="editMissionBtn" title="Edit mission template">
            <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M11.5 1.5l3 3L5 14H2v-3z"/><path d="M9.5 3.5l3 3"/></svg>
          </span>
          <span class="mission-row-action" id="forkMissionBtn" title="Create new template from default">+</span>
        </div>
        <div class="mission-dropdown" id="missionDropdown"></div>
      </div>

      <div class="scope-filter-bar" id="filterBar"></div>
      <div class="prompt-list" id="promptList"></div>

      <script>
        const vscode = acquireVsCodeApi();
        let prompts = [];
        let cloneBranches = [];
        let selectedPromptFileName = null;
        let selectedPromptScope = null;
        let showGlobal = true;
        let showProject = true;

        // Mission state
        let activeMissionName = 'default';
        let activeMissionScope = null;
        let missionTemplates = [];

        const filterBar = document.getElementById('filterBar');
        const promptList = document.getElementById('promptList');
        const missionRow = document.getElementById('missionRow');
        const missionLabel = document.getElementById('missionLabel');
        const missionNameEl = document.getElementById('missionName');
        const missionDropdown = document.getElementById('missionDropdown');
        const editMissionBtn = document.getElementById('editMissionBtn');
        const forkMissionBtn = document.getElementById('forkMissionBtn');
        const missionScopeBadge = document.getElementById('missionScopeBadge');

        // Request data on load
        vscode.postMessage({ command: 'getPrompts', scopes: getActiveScopes() });
        vscode.postMessage({ command: 'getCloneBranches' });
        vscode.postMessage({ command: 'getMissionTemplates' });

        // === Mission Row Events ===
        // Click label or row → open dropdown
        const missionWrapper = document.getElementById('missionWrapper');

        function setDropdownOpen(open) {
          if (open) {
            missionDropdown.classList.add('show');
            missionWrapper.classList.add('dropdown-open');
          } else {
            missionDropdown.classList.remove('show');
            missionWrapper.classList.remove('dropdown-open');
          }
        }

        missionLabel.addEventListener('click', (e) => {
          e.stopPropagation();
          renderMissionDropdown();
          setDropdownOpen(!missionDropdown.classList.contains('show'));
        });

        // Edit icon → open editor
        editMissionBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          vscode.postMessage({ command: 'editMission' });
        });

        forkMissionBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          vscode.postMessage({ command: 'forkMission' });
        });

        document.addEventListener('mousedown', (e) => {
          if (!missionWrapper.contains(e.target)) {
            setDropdownOpen(false);
          }
        });

        function renderMissionDropdown() {
          missionDropdown.innerHTML = '';
          // Default item
          const defItem = document.createElement('div');
          defItem.className = 'prompt-item' + (activeMissionName === 'default' ? ' selected' : '');

          const defIndicator = document.createElement('span');
          defIndicator.className = 'prompt-item-indicator';

          const defName = document.createElement('span');
          defName.className = 'prompt-item-name';
          defName.textContent = 'default';

          defItem.appendChild(defIndicator);
          defItem.appendChild(defName);

          defItem.addEventListener('click', () => {
            vscode.postMessage({ command: 'switchMission', name: 'default' });
            setDropdownOpen(false);
          });
          missionDropdown.appendChild(defItem);

          // Custom templates
          missionTemplates.forEach(t => {
            const item = document.createElement('div');
            const isActive = activeMissionName === t.name && (activeMissionScope === null || activeMissionScope === t.scope);
            item.className = 'prompt-item' + (isActive ? ' selected' : '');

            const nameSpan = document.createElement('span');
            nameSpan.className = 'prompt-item-name';
            nameSpan.textContent = t.name;

            const scopeTag = document.createElement('span');
            scopeTag.className = 'prompt-scope-badge scope-' + t.scope;
            scopeTag.textContent = t.scope === 'global' ? 'G' : 'P';
            scopeTag.title = t.scope === 'global' ? 'Global scope' : 'Project scope';

            const copyBtn = document.createElement('span');
            copyBtn.className = 'prompt-item-action copy';
            copyBtn.innerHTML = '<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="5" width="9" height="9" rx="1"/><path d="M11 5V3a1 1 0 00-1-1H3a1 1 0 00-1 1v7a1 1 0 001 1h2"/></svg>';
            const targetScope = t.scope === 'project' ? 'global' : 'project';
            copyBtn.title = 'Copy to ' + (t.scope === 'project' ? 'Global' : 'Project');
            copyBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              vscode.postMessage({ command: 'copyMissionScope', name: t.name, fromScope: t.scope, toScope: targetScope });
            });

            const editBtn = document.createElement('span');
            editBtn.className = 'prompt-item-action edit';
            editBtn.innerHTML = '<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M11.5 1.5l3 3L5 14H2v-3z"/><path d="M9.5 3.5l3 3"/></svg>';
            editBtn.title = 'Edit template';
            editBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              vscode.postMessage({ command: 'editMissionByName', name: t.name, scope: t.scope });
              setDropdownOpen(false);
            });

            const deleteBtn = document.createElement('span');
            deleteBtn.className = 'prompt-item-action delete';
            deleteBtn.textContent = '✕';
            deleteBtn.title = 'Delete template';
            deleteBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              vscode.postMessage({ command: 'deleteMission', name: t.name, scope: t.scope });
            });

            const indicator = document.createElement('span');
            indicator.className = 'prompt-item-indicator';

            item.appendChild(indicator);
            item.appendChild(nameSpan);
            item.appendChild(scopeTag);
            item.appendChild(copyBtn);
            item.appendChild(editBtn);
            item.appendChild(deleteBtn);
            item.addEventListener('click', () => {
              vscode.postMessage({ command: 'switchMission', name: t.name, scope: t.scope });
              setDropdownOpen(false);
            });
            missionDropdown.appendChild(item);
          });
        }

        function getActiveScopes() {
          const s = [];
          if (showGlobal) s.push('global');
          if (showProject) s.push('project');
          return s.length > 0 ? s : ['project'];
        }

        function deriveBranch(fileName) {
          const name = fileName.replace(/\\.md$/, '');
          return 'feat/' + name;
        }

        function render() {
          // -- Filter bar --
          filterBar.innerHTML = '';
          ['project', 'global'].forEach(scope => {
            const btn = document.createElement('button');
            btn.className = 'scope-toggle' + ((scope === 'project' ? showProject : showGlobal) ? ' active' : '');
            btn.textContent = scope.charAt(0).toUpperCase() + scope.slice(1);
            btn.addEventListener('click', (e) => {
              e.stopPropagation();
              if (scope === 'project') showProject = !showProject;
              else showGlobal = !showGlobal;
              if (!showProject && !showGlobal) {
                if (scope === 'project') showGlobal = true;
                else showProject = true;
              }
              vscode.postMessage({ command: 'getPrompts', scopes: getActiveScopes() });
            });
            filterBar.appendChild(btn);
          });

          // -- Action buttons --
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

          // -- Prompt list --
          promptList.innerHTML = '';

          const filtered = prompts.filter(p => {
            if (p.scope === 'project' && showProject) return true;
            if (p.scope === 'global' && showGlobal) return true;
            return false;
          });

          if (filtered.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'prompts-empty';
            empty.textContent = 'No prompts yet — import a folder or add one';
            promptList.appendChild(empty);
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
            indicator.textContent = hasClone ? '✦' : '';
            indicator.title = hasClone ? 'Clone exists for this prompt' : '';

            const nameSpan = document.createElement('span');
            nameSpan.className = 'prompt-item-name';
            nameSpan.textContent = p.name;
            nameSpan.title = p.preview || p.name;

            const badge = document.createElement('span');
            badge.className = 'prompt-scope-badge scope-' + p.scope;
            badge.textContent = p.scope === 'global' ? 'G' : 'P';
            badge.title = p.scope === 'global' ? 'Global scope' : 'Project scope';

            // Copy to other scope button
            const copyBtn = document.createElement('span');
            copyBtn.className = 'prompt-item-action copy';
            copyBtn.innerHTML = '<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="5" width="9" height="9" rx="1"/><path d="M11 5V3a1 1 0 00-1-1H3a1 1 0 00-1 1v7a1 1 0 001 1h2"/></svg>';
            const targetScope = p.scope === 'global' ? 'project' : 'global';
            copyBtn.title = 'Copy to ' + (p.scope === 'project' ? 'Global' : 'Project');
            copyBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              vscode.postMessage({ command: 'copyPromptScope', fileName: p.fileName, fromScope: p.scope, toScope: targetScope });
            });

            const editBtn = document.createElement('span');
            editBtn.className = 'prompt-item-action edit';
            editBtn.innerHTML = '<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M11.5 1.5l3 3L5 14H2v-3z"/><path d="M9.5 3.5l3 3"/></svg>';
            editBtn.title = 'Edit prompt';
            editBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              vscode.postMessage({ command: 'editPrompt', fileName: p.fileName, scope: p.scope });
            });

            const deleteBtn = document.createElement('span');
            deleteBtn.className = 'prompt-item-action delete';
            deleteBtn.textContent = '✕';
            deleteBtn.title = 'Delete prompt';
            deleteBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              vscode.postMessage({ command: 'deletePrompt', fileName: p.fileName, scope: p.scope });
            });

            item.appendChild(indicator);
            item.appendChild(nameSpan);
            item.appendChild(badge);
            item.appendChild(copyBtn);
            item.appendChild(editBtn);
            item.appendChild(deleteBtn);

            item.addEventListener('click', () => {
              selectedPromptFileName = p.fileName;
              selectedPromptScope = p.scope;
              vscode.postMessage({ command: 'selectPrompt', fileName: p.fileName, scope: p.scope });
              render();
            });

            promptList.appendChild(item);
          });

          // Double-click to create inline prompt
          promptList.addEventListener('dblclick', (e) => {
            if (e.target !== promptList && document.activeElement?.tagName !== 'INPUT') return;
            if (promptList.querySelector('.prompt-inline-input')) return;

            const inlineWrapper = document.createElement('div');
            inlineWrapper.className = 'prompt-item inline-create-item';

            const icon = document.createElement('span');
            icon.className = 'prompt-item-indicator';
            icon.textContent = '📄';

            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'prompt-inline-input';
            input.value = 'prompt';
            input.style.flex = '1';
            input.style.padding = '2px 4px';
            input.style.fontSize = '11px';
            input.style.border = '1px solid var(--vscode-focusBorder)';
            input.style.borderRadius = '2px';
            input.style.background = 'var(--vscode-input-background)';
            input.style.color = 'var(--vscode-input-foreground)';

            inlineWrapper.appendChild(icon);
            inlineWrapper.appendChild(input);

            promptList.appendChild(inlineWrapper);
            promptList.scrollTop = promptList.scrollHeight;
            input.select();

            const submitInline = () => {
              const val = input.value.trim();
              if (val) {
                vscode.postMessage({ command: 'createPromptInline', name: val, scope: showProject ? 'project' : 'global' });
              }
              render();
            };

            input.addEventListener('keydown', (e) => {
              if (e.key === 'Enter') submitInline();
              if (e.key === 'Escape') render();
            });

            input.addEventListener('blur', submitInline);
          });
        }

        // === Message handler ===
        window.addEventListener('message', event => {
          const msg = event.data;
          switch (msg.command) {
            case 'setPrompts':
              prompts = msg.prompts || [];
              render();
              break;
            case 'setCloneBranches':
              cloneBranches = msg.cloneBranches || [];
              render();
              break;
            case 'highlightPrompt':
              selectedPromptFileName = msg.fileName;
              selectedPromptScope = msg.scope;
              render();
              break;
            case 'setMission': {
              const rawActive = msg.activeName || 'default';
              let displayName = rawActive;
              let activeScope = null;
              if (rawActive !== 'default') {
                const colonIdx = rawActive.lastIndexOf(':');
                if (colonIdx > 0) {
                  displayName = rawActive.substring(0, colonIdx);
                  activeScope = rawActive.substring(colonIdx + 1);
                }
              }
              activeMissionName = displayName;
              activeMissionScope = activeScope;
              missionTemplates = msg.templates || [];
              missionNameEl.textContent = displayName;
              // Update scope badge on the row
              if (displayName === 'default') {
                missionScopeBadge.style.display = 'none';
              } else {
                const activeT = missionTemplates.find(t => t.name === displayName && (activeScope === null || t.scope === activeScope));
                if (activeT) {
                  missionScopeBadge.textContent = activeT.scope === 'global' ? 'G' : 'P';
                  missionScopeBadge.className = 'prompt-scope-badge scope-' + activeT.scope;
                  missionScopeBadge.style.display = '';
                } else {
                  missionScopeBadge.style.display = 'none';
                }
              }
              // Re-render dropdown if it's currently open
              if (missionDropdown.classList.contains('show')) {
                renderMissionDropdown();
              }
              break;
            }
          }
        });
      </script>
    </body>
    </html>`;
  }
}

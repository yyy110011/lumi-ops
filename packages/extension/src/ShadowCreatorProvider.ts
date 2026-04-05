import * as vscode from 'vscode';
import * as path from 'path';

export class ShadowCreatorProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'lumi-ops.creator';

  private _view?: vscode.WebviewView;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _allRoots: string[] = [],
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

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(data => {
      switch (data.command) {
        case 'spawn':
          vscode.commands.executeCommand('lumi-ops.spawn', {
            branch: data.branch,
            description: data.description,
            baseBranch: data.baseBranch,
            cloneType: data.cloneType,
            templates: data.templates,
            repoRoot: data.repoRoot,
          });
          break;
        case 'getBranches':
          vscode.commands.executeCommand('lumi-ops.getBranches', data.repoRoot);
          break;
        case 'returnToRoot':
          vscode.commands.executeCommand('lumi-ops.returnToRoot');
          break;
        case 'saveAsPrompt':
          vscode.commands.executeCommand('lumi-ops.saveAsPrompt', data.content, data.scope);
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

  public setBranchName(name: string) {
    if (this._view) {
      this._view.webview.postMessage({ command: 'setBranchName', name });
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview) {
    const repos = this._allRoots.map(r => ({
      label: path.basename(r),
      rootPath: r,
    }));
    return this._getUnifiedHtml(repos);
  }


  private _getUnifiedHtml(repos: { label: string; rootPath: string }[] = []) {
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
        .branch-row {
          display: flex;
          align-items: flex-end;
          gap: 6px;
          margin-bottom: 8px;
        }
        .branch-row .form-group {
          flex: 1;
          margin-bottom: 0;
          min-width: 0;
        }
        .branch-row-arrow {
          font-size: 11px;
          color: var(--vscode-descriptionForeground);
          padding-bottom: 5px;
          flex-shrink: 0;
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

        /* -- Textarea area -- */
        .desc-section {
          flex: 1;
          display: flex;
          flex-direction: column;
          min-height: 0;
        }
        .desc-container {
          border: 1px solid var(--vscode-input-border);
          border-radius: 3px;
          overflow: hidden;
          box-sizing: border-box;
          display: flex;
          flex-direction: column;
          flex: 1;
          min-height: 0;
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
        .save-template-row {
          display: flex;
          align-items: center;
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
        }
        .save-template-btn:hover {
          color: var(--vscode-foreground);
          background: var(--vscode-list-hoverBackground);
        }
        .save-template-btn svg {
          flex-shrink: 0;
        }
        .scope-pill {
          font-size: 9px;
          padding: 1px 6px;
          border-radius: 8px;
          cursor: pointer;
          user-select: none;
          font-weight: 600;
          margin-right: 4px;
          transition: all 0.15s;
        }
        .scope-pill.scope-project {
          background: var(--vscode-badge-background);
          color: var(--vscode-badge-foreground);
        }
        .scope-pill.scope-global {
          background: #e8a317;
          color: #1e1e1e;
        }

        /* -- Input clear button -- */
        .input-with-clear {
          position: relative;
        }
        .input-with-clear input {
          padding-right: 22px;
        }
        .input-clear-btn {
          position: absolute;
          right: 4px;
          top: 50%;
          transform: translateY(-50%);
          background: none;
          border: none;
          cursor: pointer;
          color: var(--vscode-descriptionForeground);
          font-size: 12px;
          padding: 0 2px;
          line-height: 1;
          display: none;
          z-index: 1;
        }
        .input-clear-btn:hover {
          color: var(--vscode-foreground);
        }
        .input-with-clear input:not(:placeholder-shown) ~ .input-clear-btn {
          display: block;
        }

        /* -- Integration Checkbox -- */
        .desc-label-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 3px;
        }
        .desc-label-row label {
          margin-bottom: 0;
        }
        .integration-check {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 11px;
          color: var(--vscode-descriptionForeground);
          cursor: pointer;
          user-select: none;
        }
        .integration-check input[type="checkbox"] {
          width: auto;
          margin: 0;
          cursor: pointer;
        }

      </style>
    </head>
    <body>

      <!-- Repo Selector (only shown when multiple roots) -->
      <div class="form-group" id="repoGroup" style="display:none;">
        <label for="repoSelect">Repository</label>
        <select id="repoSelect"></select>
      </div>

      <!-- Branch Row: [Base ▾] → [Create Branch] -->
      <div class="branch-row">
        <div class="form-group" id="baseBranchGroup">
          <label for="baseBranchInput">Base</label>
          <div class="branch-wrapper input-with-clear">
            <input type="text" id="baseBranchInput" placeholder="loading...">
            <span class="input-clear-btn" id="baseBranchClear">✕</span>
            <div class="branch-dropdown" id="baseBranchDropdown"></div>
          </div>
        </div>
        <span class="branch-row-arrow">→</span>
        <div class="form-group">
          <label for="branch" id="branchLabel">Create Branch</label>
          <div class="branch-wrapper input-with-clear">
            <input type="text" id="branch" placeholder="feature/new-task">
            <span class="input-clear-btn" id="branchClear">✕</span>
            <div class="branch-dropdown" id="branchDropdown"></div>
          </div>
        </div>
      </div>

      <!-- Task Description -->
      <div class="form-group desc-section">
        <div class="desc-label-row">
          <label for="description" id="descriptionLabel">Task Description</label>
          <label class="integration-check"><input type="checkbox" id="integrationToggle"> Integration</label>
        </div>
        <div class="desc-container">
          <textarea id="description" placeholder="Describe the objective for the AI Agent..."></textarea>
          <div class="save-template-row">
            <button class="save-template-btn" id="saveAsTemplateBtn" title="Save as Template">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M3 1h8l3 3v9a2 2 0 01-2 2H3a2 2 0 01-2-2V3a2 2 0 012-2z"/><path d="M5 1v4h6V1"/><circle cx="8" cy="10" r="2"/></svg>
              Save as Template
            </button>
            <span class="scope-pill scope-project" id="scopePill" title="Click to toggle scope">P</span>
          </div>
        </div>
      </div>

      <button id="spawnBtn">Create Clone Only</button>

      <script>
        const vscode = acquireVsCodeApi();
        const initialRepos = ${JSON.stringify(repos)};
        let branches = [];
        let currentBranch = '';
        let selectedBaseBranch = '';
        let worktreeBranches = [];
        let saveScope = 'project';
        let cloneType = 'task';
        let repos = initialRepos;
        let selectedRepoRoot = repos.length > 0 ? repos[0].rootPath : '';

        const repoGroup = document.getElementById('repoGroup');
        const repoSelect = document.getElementById('repoSelect');
        const branchInput = document.getElementById('branch');
        const dropdown = document.getElementById('branchDropdown');
        const branchClear = document.getElementById('branchClear');

        const baseBranchInput = document.getElementById('baseBranchInput');
        const baseDropdown = document.getElementById('baseBranchDropdown');
        const baseBranchClear = document.getElementById('baseBranchClear');

        const baseBranchGroup = document.getElementById('baseBranchGroup');
        const branchRowArrow = document.querySelector('.branch-row-arrow');
        const descriptionEl = document.getElementById('description');
        const descriptionLabel = document.getElementById('descriptionLabel');
        const spawnBtn = document.getElementById('spawnBtn');
        const scopePill = document.getElementById('scopePill');

        // === Clear buttons ===
        branchClear.addEventListener('click', () => {
          branchInput.value = '';
          branchInput.focus();
          updateBaseBranchVisibility();
          updateSpawnBtnText();
        });
        baseBranchClear.addEventListener('click', () => {
          baseBranchInput.value = '';
          selectedBaseBranch = '';
          baseBranchInput.focus();
          showBaseDropdown();
        });

        // === Initialize repo selector ===
        if (repos.length > 1) {
          repoGroup.style.display = '';
          repoSelect.innerHTML = repos.map(r =>
            '<option value="' + r.rootPath + '">' + r.label + '</option>'
          ).join('');
        }

        // Request data on load
        vscode.postMessage({ command: 'getBranches', repoRoot: selectedRepoRoot });

        // === Repo selector ===
        repoSelect.addEventListener('change', () => {
          selectedRepoRoot = repoSelect.value;
          vscode.postMessage({ command: 'getBranches', repoRoot: selectedRepoRoot });
        });

        // === Scope pill toggle ===
        scopePill.addEventListener('click', () => {
          saveScope = saveScope === 'project' ? 'global' : 'project';
          scopePill.textContent = saveScope === 'project' ? 'P' : 'G';
          scopePill.className = 'scope-pill scope-' + saveScope;
          scopePill.title = saveScope === 'project' ? 'Saving to Project' : 'Saving to Global';
        });

        // === Integration Toggle ===
        const integrationToggle = document.getElementById('integrationToggle');
        function updateDescriptionLabel() {
          if (cloneType === 'integration') {
            descriptionLabel.textContent = 'Integration Purpose';
            descriptionEl.placeholder = 'Describe the purpose of this integration branch...';
          } else {
            descriptionLabel.textContent = 'Task Description';
            descriptionEl.placeholder = 'Describe the objective for the AI Agent...';
          }
        }
        integrationToggle.addEventListener('change', () => {
          cloneType = integrationToggle.checked ? 'integration' : 'task';
          updateDescriptionLabel();
          updateSpawnBtnText();
        });

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

            case 'resetForm':
              branchInput.value = '';
              descriptionEl.value = '';
              cloneType = 'task';
              integrationToggle.checked = false;
              updateDescriptionLabel();
              spawnBtn.textContent = 'Create Clone Only';
              selectedBaseBranch = currentBranch;
              baseBranchInput.value = selectedBaseBranch;
              updateBaseBranchVisibility();
              vscode.postMessage({ command: 'getBranches', repoRoot: selectedRepoRoot });
              break;

            case 'loadPrompt':
              descriptionEl.value = msg.content;
              updateSpawnBtnText();
              break;

            case 'setBranchName':
              branchInput.value = msg.name;
              updateBaseBranchVisibility();
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
          const show = isNewBranch();
          baseBranchGroup.style.display = show ? '' : 'none';
          if (branchRowArrow) branchRowArrow.style.display = show ? '' : 'none';
          const branchLabelEl = document.getElementById('branchLabel');
          if (branchLabelEl) branchLabelEl.textContent = show ? 'Create Branch' : 'Branch Name';
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

        // Close dropdowns when clicking outside
        document.addEventListener('mousedown', (e) => {
          const target = e.target;
          const inBranch = branchInput.contains(target) || dropdown.contains(target);
          const inBase = baseBranchInput.contains(target) || baseDropdown.contains(target);
          if (!inBranch && dropdown.classList.contains('show')) {
            hideDropdown();
          }
          if (!inBase && baseDropdown.classList.contains('show')) {
            hideBaseDropdown();
          }
        });

        // Close dropdowns when webview loses focus
        window.addEventListener('blur', () => {
          hideDropdown();
          hideBaseDropdown();
        });

        // Close dropdowns on Escape key
        document.addEventListener('keydown', (e) => {
          if (e.key === 'Escape') {
            hideDropdown();
            hideBaseDropdown();
          }
        });

        baseBranchInput.addEventListener('input', () => {
          if (baseDropdown.classList.contains('show')) renderBaseItems();
        });

        baseBranchInput.addEventListener('mousedown', () => {
          hideDropdown();
          if (!baseDropdown.classList.contains('show')) {
            vscode.postMessage({ command: 'getBranches', repoRoot: selectedRepoRoot });
            showBaseDropdown();
          }
        });

        baseBranchInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === 'Tab') hideBaseDropdown();
        });

        // === Spawn Button ===
        function updateSpawnBtnText() {
          if (descriptionEl.value.trim()) {
            spawnBtn.textContent = cloneType === 'integration' ? 'Spawn Coordinator' : 'Spawn Agent';
          } else {
            spawnBtn.textContent = 'Create Clone Only';
          }
        }
        descriptionEl.addEventListener('input', updateSpawnBtnText);

        // === Save as Template (footer bar) ===
        document.getElementById('saveAsTemplateBtn').addEventListener('click', () => {
          const content = descriptionEl.value.trim();
          if (content) {
            vscode.postMessage({ command: 'saveAsPrompt', content, scope: saveScope });
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
              baseBranch: selectedBaseBranch,
              cloneType: cloneType,
              repoRoot: selectedRepoRoot
            });
          }
        });
      </script>
    </body>
    </html>`;
}
}

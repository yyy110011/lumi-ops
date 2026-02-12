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
            baseBranch: data.baseBranch
          });
          break;
        case 'getBranches':
          vscode.commands.executeCommand('lumi-ops.getBranches');
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

  private _getHtmlForWebview(webview: vscode.Webview) {
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body {
          padding: 10px;
          font-family: var(--vscode-font-family);
          color: var(--vscode-foreground);
        }
        .form-group {
          margin-bottom: 15px;
        }
        label {
          display: block;
          margin-bottom: 5px;
          font-weight: bold;
        }
        input, textarea, select {
          width: 100%;
          box-sizing: border-box;
          padding: 8px;
          background: var(--vscode-input-background);
          color: var(--vscode-input-foreground);
          border: 1px solid var(--vscode-input-border);
          border-radius: 6px;
        }

        .dropdown-overlay {
          display: none;
          position: fixed;
          top: 0; left: 0; right: 0; bottom: 0;
          z-index: 99;
        }
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
          border-radius: 6px;
          z-index: 100;
          margin-top: 2px;
        }
        .branch-dropdown.show {
          display: block;
        }
        .dropdown-overlay.show {
          display: block;
        }
        .branch-dropdown-item {
          padding: 6px 10px;
          cursor: pointer;
          font-size: 12px;
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
          padding: 8px;
          background: var(--vscode-button-background);
          color: var(--vscode-button-foreground);
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-weight: bold;
        }
        button#spawnBtn:hover {
          background: var(--vscode-button-hoverBackground);
        }
      </style>
    </head>
    <body>
      <div class="form-group">
        <label for="branch">Branch Name</label>
        <div class="branch-wrapper">
          <input type="text" id="branch" placeholder="feature/new-task">
          <div class="dropdown-overlay" id="overlay"></div>
          <div class="branch-dropdown" id="branchDropdown"></div>
        </div>
      </div>

      <div class="form-group" id="baseBranchGroup">
        <label for="baseBranchInput">Base Branch</label>
        <div class="branch-wrapper">
          <input type="text" id="baseBranchInput" placeholder="loading...">
          <div class="dropdown-overlay" id="baseOverlay"></div>
          <div class="branch-dropdown" id="baseBranchDropdown"></div>
        </div>
      </div>
      
      <div class="form-group">
        <label for="description">Task Description</label>
        <textarea id="description" rows="5" placeholder="Describe the objective for the AI Agent..."></textarea>
      </div>

      <button id="spawnBtn">Create Clone Only</button>

      <script>
        const vscode = acquireVsCodeApi();
        let branches = [];
        let currentBranch = '';
        let selectedBaseBranch = '';
        let worktreeBranches = [];

        const branchInput = document.getElementById('branch');
        const dropdown = document.getElementById('branchDropdown');
        const overlay = document.getElementById('overlay');

        const baseBranchInput = document.getElementById('baseBranchInput');
        const baseDropdown = document.getElementById('baseBranchDropdown');
        const baseOverlay = document.getElementById('baseOverlay');

        const baseBranchGroup = document.getElementById('baseBranchGroup');

        // Request branches on load
        vscode.postMessage({ command: 'getBranches' });

        // Check if typed branch name is new (not in existing list)
        function isNewBranch() {
          const name = branchInput.value.trim();
          if (!name) return true; // empty = assume new
          return !branches.some(b => b.name === name);
        }

        function updateBaseBranchVisibility() {
          if (isNewBranch()) {
            baseBranchGroup.style.display = '';
          } else {
            baseBranchGroup.style.display = 'none';
          }
        }

        // Listen for messages from extension
        window.addEventListener('message', event => {
          const msg = event.data;
          if (msg.command === 'setBranches') {
            branches = msg.branches || [];
            worktreeBranches = msg.worktreeBranches || [];
            const newCurrent = msg.currentBranch || '';
            // If current branch changed, reset base to new current
            if (newCurrent !== currentBranch || !selectedBaseBranch) {
              currentBranch = newCurrent;
              selectedBaseBranch = currentBranch;
              baseBranchInput.value = selectedBaseBranch;
            }
            currentBranch = newCurrent;
            updateBaseBranchVisibility();
            // Re-render open dropdowns
            if (dropdown.classList.contains('show')) {
              showDropdown();
            }
            if (baseDropdown.classList.contains('show')) {
              showBaseDropdown();
            }
          } else if (msg.command === 'resetForm') {
            branchInput.value = '';
            descriptionEl.value = '';
            spawnBtn.textContent = 'Create Clone Only';
            selectedBaseBranch = currentBranch;
            baseBranchInput.value = selectedBaseBranch;
            updateBaseBranchVisibility();
            // Re-fetch branch list after spawn/kill
            vscode.postMessage({ command: 'getBranches' });
          }
        });

        // ---- Branch Name Dropdown ----
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
          overlay.classList.add('show');
        }

        function hideDropdown() {
          dropdown.classList.remove('show');
          overlay.classList.remove('show');
        }

        overlay.addEventListener('click', hideDropdown);

        // Typing in branch input filters dropdown in real-time
        branchInput.addEventListener('input', () => {
          updateBaseBranchVisibility();
          if (dropdown.classList.contains('show')) {
            renderBranchItems();
          }
        });

        // Clicking branch input opens dropdown
        branchInput.addEventListener('focus', () => {
          hideBaseDropdown(); // close other dropdown
          if (!dropdown.classList.contains('show')) {
            vscode.postMessage({ command: 'getBranches' });
            showDropdown();
          }
        });

        // Enter/Tab closes dropdown
        branchInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === 'Tab') {
            hideDropdown();
          }
        });

        // ---- Base Branch Dropdown ----
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
          baseOverlay.classList.add('show');
        }

        function hideBaseDropdown() {
          baseDropdown.classList.remove('show');
          baseOverlay.classList.remove('show');
        }

        baseOverlay.addEventListener('click', hideBaseDropdown);

        // Typing in base input filters dropdown in real-time
        baseBranchInput.addEventListener('input', () => {
          if (baseDropdown.classList.contains('show')) {
            renderBaseItems();
          }
        });

        // Clicking base input opens dropdown
        baseBranchInput.addEventListener('focus', () => {
          hideDropdown(); // close other dropdown
          if (!baseDropdown.classList.contains('show')) {
            vscode.postMessage({ command: 'getBranches' });
            showBaseDropdown();
          }
        });

        // Enter/Tab closes dropdown
        baseBranchInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === 'Tab') {
            hideBaseDropdown();
          }
        });

        // ---- Spawn Button ----
        const spawnBtn = document.getElementById('spawnBtn');
        const descriptionEl = document.getElementById('description');

        descriptionEl.addEventListener('input', () => {
          spawnBtn.textContent = descriptionEl.value.trim() ? 'Spawn Agent' : 'Create Clone Only';
        });

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

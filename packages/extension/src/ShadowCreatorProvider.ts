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
            description: data.description 
          });
          break;
        case 'getBranches':
          vscode.commands.executeCommand('lumi-ops.getBranches');
          break;
      }
    });
  }

  public updateBranches(branches: string[]) {
    if (this._view) {
      this._view.webview.postMessage({ command: 'setBranches', branches });
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
        input, textarea {
          width: 100%;
          box-sizing: border-box;
          padding: 8px;
          background: var(--vscode-input-background);
          color: var(--vscode-input-foreground);
          border: 1px solid var(--vscode-input-border);
          border-radius: 2px;
        }
        .branch-row {
          display: flex;
          gap: 4px;
          align-items: stretch;
        }
        .branch-row input {
          flex: 1;
          min-width: 0;
        }
        .branch-browse-btn {
          flex-shrink: 0;
          padding: 6px 8px;
          background: var(--vscode-button-secondaryBackground, var(--vscode-button-background));
          color: var(--vscode-button-secondaryForeground, var(--vscode-button-foreground));
          border: 1px solid var(--vscode-input-border);
          border-radius: 2px;
          cursor: pointer;
          font-size: 14px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .branch-browse-btn:hover {
          background: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-hoverBackground));
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
          border-radius: 2px;
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
          <div class="branch-row">
            <input type="text" id="branch" placeholder="feature/new-task">
            <button class="branch-browse-btn" id="browseBtn" title="Browse existing branches">▾</button>
          </div>
          <div class="dropdown-overlay" id="overlay"></div>
          <div class="branch-dropdown" id="branchDropdown"></div>
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

        const branchInput = document.getElementById('branch');
        const browseBtn = document.getElementById('browseBtn');
        const dropdown = document.getElementById('branchDropdown');
        const overlay = document.getElementById('overlay');

        // Request branches on load
        vscode.postMessage({ command: 'getBranches' });

        // Listen for messages from extension
        window.addEventListener('message', event => {
          const msg = event.data;
          if (msg.command === 'setBranches') {
            branches = msg.branches || [];
          } else if (msg.command === 'resetForm') {
            branchInput.value = '';
            descriptionEl.value = '';
            spawnBtn.textContent = 'Create Clone Only';
            // Re-fetch branches after spawn/kill
            vscode.postMessage({ command: 'getBranches' });
          }
        });

        function showDropdown() {
          dropdown.innerHTML = '';
          const filter = branchInput.value.toLowerCase();
          const filtered = branches.filter(b => b.toLowerCase().includes(filter));

          if (filtered.length === 0) {
            dropdown.innerHTML = '<div class="branch-dropdown-empty">No matching branches</div>';
          } else {
            filtered.forEach(b => {
              const item = document.createElement('div');
              item.className = 'branch-dropdown-item';
              item.textContent = b;
              item.addEventListener('click', () => {
                branchInput.value = b;
                hideDropdown();
              });
              dropdown.appendChild(item);
            });
          }
          dropdown.classList.add('show');
          overlay.classList.add('show');
        }

        function hideDropdown() {
          dropdown.classList.remove('show');
          overlay.classList.remove('show');
        }

        browseBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (dropdown.classList.contains('show')) {
            hideDropdown();
          } else {
            showDropdown();
          }
        });

        overlay.addEventListener('click', hideDropdown);

        // Filter dropdown as user types (if dropdown is open)
        branchInput.addEventListener('input', () => {
          if (dropdown.classList.contains('show')) {
            showDropdown();
          }
        });

        const spawnBtn = document.getElementById('spawnBtn');
        const descriptionEl = document.getElementById('description');

        // Dynamic button text based on description
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
              description: description
            });
          }
        });
      </script>
    </body>
    </html>`;
  }
}

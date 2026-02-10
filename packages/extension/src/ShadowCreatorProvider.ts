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
        case 'saveAsPrompt':
          vscode.commands.executeCommand('lumi-ops.saveAsPrompt', data.content);
          break;
        case 'getPrompts':
          vscode.commands.executeCommand('lumi-ops.getPrompts');
          break;
        case 'selectPrompt':
          vscode.commands.executeCommand('lumi-ops.selectPrompt', data.fileName);
          break;
      }
    });
  }

  public updateBranches(branches: { name: string; isRemote: boolean }[]) {
    if (this._view) {
      this._view.webview.postMessage({ command: 'setBranches', branches });
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

  public updatePrompts(prompts: { name: string; preview: string }[]) {
    if (this._view) {
      this._view.webview.postMessage({ command: 'setPrompts', prompts });
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
        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:5px;">
          <label for="description" style="margin-bottom:0;">Task Description</label>
          <div style="position:relative;">
            <button class="branch-browse-btn" id="promptBrowseBtn" title="Select prompt template" style="padding:3px 6px; font-size:11px;">📋 Template ▾</button>
            <div class="branch-dropdown" id="promptDropdown" style="right:0; left:auto; min-width:200px;"></div>
          </div>
        </div>
        <div id="promptSource" style="display:none; font-size:11px; color:var(--vscode-descriptionForeground); margin-bottom:4px;">📎 Loaded from: <span id="promptSourceName"></span></div>
        <textarea id="description" rows="5" placeholder="Describe the objective for the AI Agent..."></textarea>
        <button id="saveAsTemplateBtn" type="button" style="margin-top:6px; padding:4px 8px; font-size:11px; background:var(--vscode-button-secondaryBackground, var(--vscode-button-background)); color:var(--vscode-button-secondaryForeground, var(--vscode-button-foreground)); border:1px solid var(--vscode-input-border); border-radius:2px; cursor:pointer;">💾 Save as Template</button>
      </div>

      <button id="spawnBtn">Create Clone Only</button>

      <script>
        const vscode = acquireVsCodeApi();
        let branches = [];
        let prompts = [];

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
          } else if (msg.command === 'setPrompts') {
            prompts = msg.prompts || [];
          } else if (msg.command === 'resetForm') {
            branchInput.value = '';
            descriptionEl.value = '';
            spawnBtn.textContent = 'Create Clone Only';
            document.getElementById('promptSource').style.display = 'none';
            // Re-fetch branches after spawn/kill
            vscode.postMessage({ command: 'getBranches' });
          } else if (msg.command === 'loadPrompt') {
            descriptionEl.value = msg.content;
            spawnBtn.textContent = 'Spawn Agent';
            document.getElementById('promptSourceName').textContent = msg.name;
            document.getElementById('promptSource').style.display = 'block';
          }
        });

        function showDropdown() {
          dropdown.innerHTML = '';
          const filter = branchInput.value.toLowerCase();
          const localFiltered = branches.filter(b => !b.isRemote && b.name.toLowerCase().includes(filter));
          const remoteFiltered = branches.filter(b => b.isRemote && b.name.toLowerCase().includes(filter));

          if (localFiltered.length === 0 && remoteFiltered.length === 0) {
            dropdown.innerHTML = '<div class="branch-dropdown-empty">No matching branches</div>';
          } else {
            localFiltered.forEach(b => {
              const item = document.createElement('div');
              item.className = 'branch-dropdown-item';
              item.textContent = b.name;
              item.addEventListener('click', () => {
                branchInput.value = b.name;
                hideDropdown();
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
                });
                dropdown.appendChild(item);
              });
            }
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

        overlay.addEventListener('click', () => {
          hideDropdown();
          hidePromptDropdown();
        });

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

        // -- Prompt dropdown --
        const promptBrowseBtn = document.getElementById('promptBrowseBtn');
        const promptDropdown = document.getElementById('promptDropdown');

        function showPromptDropdown() {
          // Request fresh prompt list
          vscode.postMessage({ command: 'getPrompts' });
          // Render after a short delay to allow setPrompts message
          setTimeout(() => renderPromptDropdown(), 100);
        }

        function renderPromptDropdown() {
          promptDropdown.innerHTML = '';
          if (prompts.length === 0) {
            promptDropdown.innerHTML = '<div class="branch-dropdown-empty">No templates saved</div>';
          } else {
            prompts.forEach(p => {
              const item = document.createElement('div');
              item.className = 'branch-dropdown-item';
              item.innerHTML = '<strong>' + p.name.replace(/\.md$/, '') + '</strong>' +
                (p.preview ? '<br><span style="font-size:10px;color:var(--vscode-descriptionForeground);">' + p.preview + '</span>' : '');
              item.addEventListener('click', () => {
                vscode.postMessage({ command: 'selectPrompt', fileName: p.name });
                hidePromptDropdown();
              });
              promptDropdown.appendChild(item);
            });
          }
          promptDropdown.classList.add('show');
          overlay.classList.add('show');
        }

        function hidePromptDropdown() {
          promptDropdown.classList.remove('show');
        }

        promptBrowseBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          hideDropdown();
          if (promptDropdown.classList.contains('show')) {
            hidePromptDropdown();
            overlay.classList.remove('show');
          } else {
            showPromptDropdown();
          }
        });

        document.getElementById('saveAsTemplateBtn').addEventListener('click', () => {
          const content = descriptionEl.value.trim();
          if (content) {
            vscode.postMessage({ command: 'saveAsPrompt', content });
          }
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

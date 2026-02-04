import * as vscode from 'vscode';

export class ShadowCreatorProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'lumi-ops.creator';

  constructor(private readonly _extensionUri: vscode.Uri) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ) {
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
      }
    });
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
        button {
          width: 100%;
          padding: 8px;
          background: var(--vscode-button-background);
          color: var(--vscode-button-foreground);
          border: none;
          cursor: pointer;
          font-weight: bold;
        }
        button:hover {
          background: var(--vscode-button-hoverBackground);
        }
      </style>
    </head>
    <body>
      <div class="form-group">
        <label for="branch">Branch Name</label>
        <input type="text" id="branch" placeholder="feature/new-task">
      </div>
      
      <div class="form-group">
        <label for="description">Task Description</label>
        <textarea id="description" rows="5" placeholder="Describe the objective for the AI Agent..."></textarea>
      </div>

      <button id="spawnBtn">Spawn Agent</button>

      <script>
        const vscode = acquireVsCodeApi();
        
        document.getElementById('spawnBtn').addEventListener('click', () => {
          const branch = document.getElementById('branch').value;
          const description = document.getElementById('description').value;

          if (branch && description) {
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

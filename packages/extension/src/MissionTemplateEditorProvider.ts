import * as vscode from 'vscode';
import { parseMissionTemplate, serializeMissionTemplate } from './missionTemplateUtils';

/**
 * Custom text editor for Mission Template files (.prompts/_missions/*.md).
 * Renders a structured form with Task / Rules / Instructions fields
 * instead of raw markdown.
 *
 * NOTE: Scope switching (P/G) is NOT handled here — it's done from the
 * Prompt Library dropdown. CustomTextEditorProvider is bound to a file URI,
 * so renaming/moving the underlying file while the editor is open breaks it.
 */
export class MissionTemplateEditorProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = 'lumi-ops.missionTemplateEditor';

  constructor(private readonly extensionUri: vscode.Uri) {}

  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    // Initial render
    webviewPanel.webview.html = this.getHtml();
    this.syncDocumentToWebview(document, webviewPanel.webview);

    // Listen to document changes (external edits)
    const changeSubscription = vscode.workspace.onDidChangeTextDocument((e: vscode.TextDocumentChangeEvent) => {
      if (e.document.uri.toString() === document.uri.toString() && !isUpdatingFromWebview) {
        this.syncDocumentToWebview(document, webviewPanel.webview);
      }
    });

    webviewPanel.onDidDispose(() => {
      changeSubscription.dispose();
    });

    // Listen to webview messages
    let isUpdatingFromWebview = false;
    webviewPanel.webview.onDidReceiveMessage(async (msg: any) => {
      switch (msg.command) {
        case 'update': {
          const content = serializeMissionTemplate({ name: msg.name, task: msg.task, rules: msg.rules, instructions: msg.instructions });
          const edit = new vscode.WorkspaceEdit();
          edit.replace(
            document.uri,
            new vscode.Range(0, 0, document.lineCount, 0),
            content,
          );
          isUpdatingFromWebview = true;
          await vscode.workspace.applyEdit(edit);
          isUpdatingFromWebview = false;
          break;
        }
      }
    });
  }

  /** Parse the document and send structured fields to the webview. */
  private syncDocumentToWebview(document: vscode.TextDocument, webview: vscode.Webview) {
    const content = document.getText();
    const parsed = parseMissionTemplate(content);
    const fileName = document.uri.path.split('/').pop()?.replace(/\.md$/, '') || '';
    // Determine scope from file path (display-only)
    const scope = document.uri.fsPath.includes('/.lumi-ops/') ? 'global' : 'project';
    webview.postMessage({
      command: 'setFields',
      name: fileName,
      task: parsed.task,
      rules: parsed.rules,
      instructions: parsed.instructions,
      scope,
    });
  }



  /** Generate the webview HTML with the structured form. */
  private getHtml(): string {
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
          padding: 16px 20px;
          font-family: var(--vscode-font-family);
          font-size: var(--vscode-font-size, 13px);
          color: var(--vscode-foreground);
          display: flex;
          flex-direction: column;
          box-sizing: border-box;
        }

        /* -- Header row -- */
        .header-row {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 16px;
          flex-shrink: 0;
        }
        .header-title {
          font-size: 14px;
          font-weight: 600;
          flex: 1;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .header-title .icon {
          margin-right: 4px;
        }
        /* -- Form sections -- */
        .form-section {
          margin-bottom: 12px;
          display: flex;
          flex-direction: column;
        }
        .form-section:last-child {
          flex: 1;
          min-height: 0;
        }
        .form-section label {
          display: block;
          margin-bottom: 4px;
          font-size: 11px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.4px;
          color: var(--vscode-foreground);
        }
        .form-section .label-hint {
          font-weight: 400;
          text-transform: none;
          letter-spacing: normal;
          color: var(--vscode-descriptionForeground);
          font-size: 10px;
          margin-left: 4px;
        }
        textarea {
          width: 100%;
          box-sizing: border-box;
          padding: 6px 8px;
          font-size: 12px;
          font-family: var(--vscode-editor-font-family, monospace);
          background: var(--vscode-input-background);
          color: var(--vscode-input-foreground);
          border: 1px solid var(--vscode-input-border);
          border-radius: 3px;
          resize: vertical;
          min-height: 60px;
          line-height: 1.5;
        }
        textarea:focus {
          outline: 1px solid var(--vscode-focusBorder);
          border-color: var(--vscode-focusBorder);
        }
        .form-section:last-child textarea {
          flex: 1;
          resize: none;
        }
      </style>
    </head>
    <body>

      <!-- Header -->
      <div class="header-row">
        <span class="header-title">
          <span class="icon" style="margin-right: 4px;">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style="vertical-align: text-bottom;">
              <path fill-rule="evenodd" clip-rule="evenodd" d="M11 1.5H5.5L4 3v10l1.5 1.5H11l1.5-1.5V3L11 1.5zm.5 11l-.5.5H5.5l-.5-.5V3l.5-.5H11l.5.5v9.5z"/>
              <path d="M6 5h4v1H6V5zm4 2H6v1h4V7zm-4 2h4v1H6V9z"/>
            </svg>
          </span> Mission Template: <span id="templateName">&mdash;</span>
        </span>
      </div>

      <!-- Fields -->
      <div class="form-section">
        <label>Task <span class="label-hint">(What should the agent accomplish)</span></label>
        <textarea id="fieldTask" rows="3" placeholder="Leave empty — filled by spawn description"></textarea>
      </div>

      <div class="form-section">
        <label>Rules <span class="label-hint">(Guidelines the agent must follow)</span></label>
        <textarea id="fieldRules" rows="4" placeholder="e.g. Do not run tests, Use TypeScript strict mode..."></textarea>
      </div>

      <div class="form-section">
        <label>Instructions <span class="label-hint">(Step-by-step workflow after completion)</span></label>
        <textarea id="fieldInstructions" rows="6" placeholder="e.g. 1. Analyze the objective..."></textarea>
      </div>

      <script>
        const vscode = acquireVsCodeApi();
        let templateName = '';

        const nameEl = document.getElementById('templateName');
        const taskEl = document.getElementById('fieldTask');
        const rulesEl = document.getElementById('fieldRules');
        const instructionsEl = document.getElementById('fieldInstructions');

        // Debounced sync: push textarea changes to the document after 300ms
        let debounceTimer = null;
        function scheduleUpdate() {
          clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            vscode.postMessage({
              command: 'update',
              name: templateName,
              task: taskEl.value,
              rules: rulesEl.value,
              instructions: instructionsEl.value,
            });
          }, 300);
        }

        taskEl.addEventListener('input', scheduleUpdate);
        rulesEl.addEventListener('input', scheduleUpdate);
        instructionsEl.addEventListener('input', scheduleUpdate);

        window.addEventListener('message', (event) => {
          const msg = event.data;
          if (msg.command === 'setFields') {
            templateName = msg.name || '';
            nameEl.textContent = msg.name || '—';
            taskEl.value = msg.task || '';
            rulesEl.value = msg.rules || '';
            instructionsEl.value = msg.instructions || '';
          }
        });
      </script>
    </body>
    </html>`;
  }
}

import * as vscode from 'vscode';
import * as path from 'path';

export class PromptItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly fileName: string,
    public readonly firstLine: string
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'promptItem';
    this.description = firstLine.length > 60 ? firstLine.substring(0, 60) + '…' : firstLine;
    this.tooltip = new vscode.MarkdownString(`**${label}**\n\n${firstLine}`);
    this.iconPath = new vscode.ThemeIcon('file-text');
  }
}

export class PromptLibraryProvider implements vscode.TreeDataProvider<PromptItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<PromptItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private promptsDir: vscode.Uri;

  constructor(globalStorageUri: vscode.Uri) {
    this.promptsDir = vscode.Uri.joinPath(globalStorageUri, 'prompts');
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: PromptItem): vscode.TreeItem {
    return element;
  }

  async getChildren(): Promise<PromptItem[]> {
    await this.ensurePromptsDir();

    try {
      const entries = await vscode.workspace.fs.readDirectory(this.promptsDir);
      const items: PromptItem[] = [];

      for (const [name, type] of entries) {
        if (type === vscode.FileType.File && name.endsWith('.md')) {
          const label = name.replace(/\.md$/, '');
          const firstLine = await this.getFirstLine(name);
          items.push(new PromptItem(label, name, firstLine));
        }
      }

      items.sort((a, b) => a.label.localeCompare(b.label));
      return items;
    } catch {
      return [];
    }
  }

  async getPromptContent(fileName: string): Promise<string> {
    const fileUri = vscode.Uri.joinPath(this.promptsDir, fileName);
    const data = await vscode.workspace.fs.readFile(fileUri);
    return Buffer.from(data).toString('utf-8');
  }

  async deletePrompt(fileName: string): Promise<void> {
    const fileUri = vscode.Uri.joinPath(this.promptsDir, fileName);
    await vscode.workspace.fs.delete(fileUri);
    this.refresh();
  }

  async importPrompt(sourcePath: vscode.Uri): Promise<void> {
    await this.ensurePromptsDir();
    const fileName = path.basename(sourcePath.fsPath);
    const destUri = vscode.Uri.joinPath(this.promptsDir, fileName);
    await vscode.workspace.fs.copy(sourcePath, destUri, { overwrite: true });
    this.refresh();
  }

  async savePrompt(name: string, content: string): Promise<void> {
    await this.ensurePromptsDir();
    const fileName = name.endsWith('.md') ? name : `${name}.md`;
    const fileUri = vscode.Uri.joinPath(this.promptsDir, fileName);
    await vscode.workspace.fs.writeFile(fileUri, Buffer.from(content, 'utf-8'));
    this.refresh();
  }

  getPromptFileUri(fileName: string): vscode.Uri {
    return vscode.Uri.joinPath(this.promptsDir, fileName);
  }

  private async ensurePromptsDir(): Promise<void> {
    try {
      await vscode.workspace.fs.stat(this.promptsDir);
    } catch {
      await vscode.workspace.fs.createDirectory(this.promptsDir);
    }
  }

  private async getFirstLine(fileName: string): Promise<string> {
    try {
      const content = await this.getPromptContent(fileName);
      const firstLine = content.split('\n').find(l => l.trim().length > 0) || '';
      // Strip markdown heading prefixes for cleaner display
      return firstLine.replace(/^#+\s*/, '').trim();
    } catch {
      return '';
    }
  }
}

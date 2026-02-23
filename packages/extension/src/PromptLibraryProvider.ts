import * as vscode from 'vscode';
import * as path from 'path';
import { LUMI_OPS_HOME } from '@lumi-ops/cli';

export type PromptScope = 'global' | 'project';

export interface PromptInfo {
  name: string;      // display name (no .md)
  fileName: string;  // e.g. "phase-1-auth.md"
  preview: string;   // first non-empty line
  scope: PromptScope;
}

/**
 * Dual-scope prompt storage service.
 * - Global:  ~/.lumi-ops/.prompts/
 * - Project: <repoRoot>/.prompts/
 */
export class PromptLibraryProvider {
  private globalDir: vscode.Uri;
  private projectDir: vscode.Uri | null = null;

  constructor() {
    this.globalDir = vscode.Uri.file(path.join(LUMI_OPS_HOME, '.prompts'));
  }

  /** Set project root so we can resolve prompt directory */
  setProjectRoot(rootUri: vscode.Uri) {
    this.projectDir = vscode.Uri.file(path.join(rootUri.fsPath, '.prompts'));
  }

  /** Get the directory URI for a given scope. */
  private getDir(scope: PromptScope): vscode.Uri {
    if (scope === 'project') {
      if (!this.projectDir) { throw new Error('No project root set'); }
      return this.projectDir;
    }
    return this.globalDir;
  }

  /** List prompts from one or both scopes. */
  async listPrompts(scopes: PromptScope[]): Promise<PromptInfo[]> {
    const items: PromptInfo[] = [];
    for (const scope of scopes) {
      try {
        const dir = this.getDir(scope);
        await this.ensureDir(dir);
        const entries = await vscode.workspace.fs.readDirectory(dir);
        for (const [name, type] of entries) {
          if ((type & vscode.FileType.File) !== 0 && name.endsWith('.md')) {
            const label = name.replace(/\.md$/, '');
            const preview = await this.getFirstLine(dir, name);
            items.push({ name: label, fileName: name, preview, scope });
          }
        }
      } catch {
        // scope unavailable — skip
      }
    }
    items.sort((a, b) => a.name.localeCompare(b.name));
    return items;
  }

  /** Read full content of a prompt file. */
  async getPromptContent(fileName: string, scope: PromptScope): Promise<string> {
    const fileUri = vscode.Uri.joinPath(this.getDir(scope), fileName);
    const data = await vscode.workspace.fs.readFile(fileUri);
    return Buffer.from(data).toString('utf-8');
  }

  /** Delete a prompt file. */
  async deletePrompt(fileName: string, scope: PromptScope): Promise<void> {
    const fileUri = vscode.Uri.joinPath(this.getDir(scope), fileName);
    await vscode.workspace.fs.delete(fileUri);
  }

  /** Import a single file into the given scope. */
  async importPrompt(sourcePath: vscode.Uri, scope: PromptScope = 'project'): Promise<void> {
    const dir = this.getDir(scope);
    await this.ensureDir(dir);
    const fileName = path.basename(sourcePath.fsPath);
    const destUri = vscode.Uri.joinPath(dir, fileName);
    await vscode.workspace.fs.copy(sourcePath, destUri, { overwrite: true });
  }

  /** Import all .md files from a folder. Returns count. */
  async importFolder(folderUri: vscode.Uri, scope: PromptScope = 'project'): Promise<number> {
    const dir = this.getDir(scope);
    await this.ensureDir(dir);
    const entries = await vscode.workspace.fs.readDirectory(folderUri);
    let count = 0;
    for (const [name, type] of entries) {
      if ((type & vscode.FileType.File) !== 0 && name.endsWith('.md')) {
        const sourceUri = vscode.Uri.joinPath(folderUri, name);
        const destUri = vscode.Uri.joinPath(dir, name);
        await vscode.workspace.fs.copy(sourceUri, destUri, { overwrite: true });
        count++;
      }
    }
    return count;
  }

  /** Save (create or overwrite) a prompt. */
  async savePrompt(name: string, content: string, scope: PromptScope = 'project'): Promise<void> {
    const dir = this.getDir(scope);
    await this.ensureDir(dir);
    const fileName = name.endsWith('.md') ? name : `${name}.md`;
    const fileUri = vscode.Uri.joinPath(dir, fileName);
    await vscode.workspace.fs.writeFile(fileUri, Buffer.from(content, 'utf-8'));
  }

  /** Move a prompt between scopes (copy + delete). Safe against duplicate moves from other windows. */
  async movePrompt(fileName: string, fromScope: PromptScope, toScope: PromptScope): Promise<void> {
    const fromDir = this.getDir(fromScope);
    const toDir = this.getDir(toScope);
    await this.ensureDir(toDir);
    const srcUri = vscode.Uri.joinPath(fromDir, fileName);
    const destUri = vscode.Uri.joinPath(toDir, fileName);

    // Check if source still exists (may have been moved by another window already)
    let sourceExists = true;
    try { await vscode.workspace.fs.stat(srcUri); } catch { sourceExists = false; }

    if (!sourceExists) {
      // Source is gone — check if it already landed at the destination
      try {
        await vscode.workspace.fs.stat(destUri);
        return; // Already moved, nothing to do
      } catch {
        throw new Error(`"${fileName}" no longer exists in either scope.`);
      }
    }

    await vscode.workspace.fs.copy(srcUri, destUri, { overwrite: true });
    await vscode.workspace.fs.delete(srcUri);
  }

  /** Get the URI for a prompt file. */
  getPromptFileUri(fileName: string, scope: PromptScope): vscode.Uri {
    return vscode.Uri.joinPath(this.getDir(scope), fileName);
  }

  private async ensureDir(dir: vscode.Uri): Promise<void> {
    try {
      await vscode.workspace.fs.stat(dir);
    } catch {
      await vscode.workspace.fs.createDirectory(dir);
    }
  }

  private async getFirstLine(dir: vscode.Uri, fileName: string): Promise<string> {
    try {
      const fileUri = vscode.Uri.joinPath(dir, fileName);
      const data = await vscode.workspace.fs.readFile(fileUri);
      const content = Buffer.from(data).toString('utf-8');
      const firstLine = content.split('\n').find(l => l.trim().length > 0) || '';
      return firstLine.replace(/^#+\s*/, '').trim();
    } catch {
      return '';
    }
  }
}

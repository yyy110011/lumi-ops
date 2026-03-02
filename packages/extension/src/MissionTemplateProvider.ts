import * as vscode from 'vscode';
import * as path from 'path';
import { LUMI_OPS_HOME, DEFAULT_MISSION_TEMPLATE } from '@lumi-ops/cli';
import { parseMissionTemplate, serializeMissionTemplate } from './missionTemplateUtils';

export type MissionScope = 'global' | 'project';

export interface MissionTemplate {
  name: string;       // display name (no .md)
  fileName: string;   // e.g. "my-template.md"
  task: string;       // Task section content
  rules: string;      // Rules section content
  instructions: string; // Instructions section content
  scope: MissionScope;
}

export interface MissionTemplateInfo {
  name: string;
  fileName: string;
  scope: MissionScope;
}

const MISSIONS_DIR = '_missions';

/**
 * Dual-scope mission template storage service.
 * - Global:  ~/.lumi-ops/.prompts/_missions/
 * - Project: <repoRoot>/.prompts/_missions/
 */
export class MissionTemplateProvider {
  private globalDir: vscode.Uri;
  private projectDir: vscode.Uri | null = null;

  constructor() {
    this.globalDir = vscode.Uri.file(path.join(LUMI_OPS_HOME, '.prompts', MISSIONS_DIR));
  }

  /** Set project root so we can resolve mission template directory */
  setProjectRoot(rootUri: vscode.Uri) {
    this.projectDir = vscode.Uri.file(path.join(rootUri.fsPath, '.prompts', MISSIONS_DIR));
  }

  /** Get the directory URI for a given scope. */
  private getDir(scope: MissionScope): vscode.Uri {
    if (scope === 'project') {
      if (!this.projectDir) { throw new Error('No project root set'); }
      return this.projectDir;
    }
    return this.globalDir;
  }

  /** List all mission templates from both scopes. Project scope first. */
  async listTemplates(): Promise<MissionTemplateInfo[]> {
    const items: MissionTemplateInfo[] = [];
    for (const scope of ['project', 'global'] as MissionScope[]) {
      try {
        const dir = this.getDir(scope);
        await this.ensureDir(dir);
        const entries = await vscode.workspace.fs.readDirectory(dir);
        for (const [name, type] of entries) {
          if ((type & vscode.FileType.File) !== 0 && name.endsWith('.md')) {
            const label = name.replace(/\.md$/, '');
            items.push({ name: label, fileName: name, scope });
          }
        }
      } catch {
        // scope unavailable — skip
      }
    }
    return items;
  }

  /** Read and parse a mission template file. */
  async getTemplate(fileName: string, scope: MissionScope): Promise<MissionTemplate> {
    const fileUri = vscode.Uri.joinPath(this.getDir(scope), fileName);
    const data = await vscode.workspace.fs.readFile(fileUri);
    const content = Buffer.from(data).toString('utf-8');
    const parsed = parseMissionTemplate(content);
    return { ...parsed, fileName, scope };
  }

  /**
   * Validate the active template name against existing templates.
   * Returns 'default' if the configured name doesn't exist in any scope.
   */
  async validateActiveTemplateName(): Promise<string> {
    const config = vscode.workspace.getConfiguration('lumi-ops');
    const raw = config.get<string>('activeMissionTemplate') || 'default';
    if (raw === 'default') { return 'default'; }

    const templates = await this.listTemplates();
    return templates.some(t => t.name === raw) ? raw : 'default';
  }

  /** Get the active mission template (from settings), falling back to default. */
  async getActiveTemplate(): Promise<MissionTemplate> {
    const { name, scope } = await this.getActiveTemplateName();

    if (name === 'default' || !name) {
      return {
        ...DEFAULT_MISSION_TEMPLATE,
        fileName: '',
        scope: 'global',
      };
    }

    // If scope is known, load directly
    if (scope) {
      try {
        return await this.getTemplate(`${name}.md`, scope);
      } catch {
        // File missing — fall through to default
      }
    }

    // Fallback to default if configured template is missing
    return {
      ...DEFAULT_MISSION_TEMPLATE,
      fileName: '',
      scope: 'global',
    };
  }

  /** Set the active mission template in workspace settings. */
  async setActiveTemplate(name: string, scope?: MissionScope): Promise<void> {
    const config = vscode.workspace.getConfiguration('lumi-ops');
    const value = (name === 'default' || !scope) ? name : `${name}:${scope}`;
    await config.update('activeMissionTemplate', value, vscode.ConfigurationTarget.Workspace);
  }

  /** Fork the default template into a new file. Returns the file URI. */
  async forkDefault(name: string, scope: MissionScope): Promise<vscode.Uri> {
    const dir = this.getDir(scope);
    await this.ensureDir(dir);
    const fileName = name.endsWith('.md') ? name : `${name}.md`;
    const fileUri = vscode.Uri.joinPath(dir, fileName);

    const content = serializeMissionTemplate({
      ...DEFAULT_MISSION_TEMPLATE,
      name: name.replace(/\.md$/, ''),
    });
    await vscode.workspace.fs.writeFile(fileUri, Buffer.from(content, 'utf-8'));
    return fileUri;
  }

  /** Save a mission template. */
  async saveTemplate(template: MissionTemplate): Promise<void> {
    const dir = this.getDir(template.scope);
    await this.ensureDir(dir);
    const fileUri = vscode.Uri.joinPath(dir, template.fileName);
    const content = serializeMissionTemplate(template);
    await vscode.workspace.fs.writeFile(fileUri, Buffer.from(content, 'utf-8'));
  }

  /** Delete a mission template. */
  async deleteTemplate(fileName: string, scope: MissionScope): Promise<void> {
    const fileUri = vscode.Uri.joinPath(this.getDir(scope), fileName);
    await vscode.workspace.fs.delete(fileUri);
  }

  /** Get the URI for a mission template file. */
  getTemplateFileUri(fileName: string, scope: MissionScope): vscode.Uri {
    return vscode.Uri.joinPath(this.getDir(scope), fileName);
  }

  /** Copy a template to the other scope (non-destructive). Returns whether a conflict exists. */
  async copyToScope(fileName: string, fromScope: MissionScope, toScope: MissionScope): Promise<{ conflict: boolean }> {
    const fromDir = this.getDir(fromScope);
    const toDir = this.getDir(toScope);
    await this.ensureDir(toDir);
    const srcUri = vscode.Uri.joinPath(fromDir, fileName);
    const destUri = vscode.Uri.joinPath(toDir, fileName);

    // Check if target already exists
    let conflict = false;
    try { await vscode.workspace.fs.stat(destUri); conflict = true; } catch { /* no conflict */ }

    if (conflict) {
      return { conflict: true };
    }

    await vscode.workspace.fs.copy(srcUri, destUri, { overwrite: false });
    return { conflict: false };
  }

  /** Force-copy a template to the other scope (overwrite). */
  async copyToScopeOverwrite(fileName: string, fromScope: MissionScope, toScope: MissionScope): Promise<void> {
    const fromDir = this.getDir(fromScope);
    const toDir = this.getDir(toScope);
    await this.ensureDir(toDir);
    const srcUri = vscode.Uri.joinPath(fromDir, fileName);
    const destUri = vscode.Uri.joinPath(toDir, fileName);
    await vscode.workspace.fs.copy(srcUri, destUri, { overwrite: true });
  }

  /** Copy a template to the other scope with a new name. */
  async copyToScopeRenamed(fileName: string, newFileName: string, fromScope: MissionScope, toScope: MissionScope): Promise<void> {
    const fromDir = this.getDir(fromScope);
    const toDir = this.getDir(toScope);
    await this.ensureDir(toDir);
    const srcUri = vscode.Uri.joinPath(fromDir, fileName);
    const destUri = vscode.Uri.joinPath(toDir, newFileName);
    await vscode.workspace.fs.copy(srcUri, destUri, { overwrite: false });
  }

  /** Get the active template name and scope (for display). Parses "name:scope" format, validates existence. */
  async getActiveTemplateName(): Promise<{ name: string; scope: MissionScope | null }> {
    const config = vscode.workspace.getConfiguration('lumi-ops');
    const raw = config.get<string>('activeMissionTemplate') || 'default';
    if (raw === 'default') return { name: 'default', scope: null };

    let name = raw;
    let scope: MissionScope | null = null;
    const colonIdx = raw.lastIndexOf(':');
    if (colonIdx > 0) {
      const parsedName = raw.substring(0, colonIdx);
      const parsedScope = raw.substring(colonIdx + 1) as MissionScope;
      if (parsedScope === 'global' || parsedScope === 'project') {
        name = parsedName;
        scope = parsedScope;
      }
    }

    // Validate: check the template actually exists
    const templates = await this.listTemplates();
    const exists = templates.some(t => t.name === name && (scope === null || t.scope === scope));
    if (!exists) return { name: 'default', scope: null };

    return { name, scope };
  }



  private async ensureDir(dir: vscode.Uri): Promise<void> {
    try {
      await vscode.workspace.fs.stat(dir);
    } catch {
      await vscode.workspace.fs.createDirectory(dir);
    }
  }
}

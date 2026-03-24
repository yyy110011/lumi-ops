import * as vscode from 'vscode';
import { GitUtils } from '@lumi-ops/cli';
import { PromptScope } from '../PromptLibraryProvider';
import { CommandDeps } from './types';

export function registerPromptLibraryCommands(
  context: vscode.ExtensionContext,
  deps: CommandDeps,
): vscode.Disposable[] {
  const { rootPath, allRoots, promptLibraryProvider, promptLibraryViewProvider, statusBus } = deps;

  /** Send active clone branches to webview for ✦ indicators */
  async function notifyCloneBranches() {
    const roots = allRoots.length > 0 ? allRoots : (rootPath ? [rootPath] : []);
    if (roots.length === 0) return;
    try {
      const allBranches: string[] = [];
      for (const root of roots) {
        const git = new GitUtils(root);
        const worktreeEntries = await git.listWorktrees();
        const cloneBranches = worktreeEntries
          .map((entry: string) => {
            const match = entry.match(/branch refs\/heads\/(.+)/);
            return match ? match[1] : null;
          })
          .filter(Boolean) as string[];
        allBranches.push(...cloneBranches);
      }
      promptLibraryViewProvider.updateCloneBranches(allBranches);
    } catch {
      // ignore
    }
  }

  // Auto-refresh prompt library ✦ indicators on worktree changes
  const statusSub = statusBus.onDidChange(() => { notifyCloneBranches(); });

  const getPrompts = vscode.commands.registerCommand('lumi-ops._getPrompts', async (scopes?: PromptScope[]) => {
    try {
      const activeScopes = scopes || ['global', 'project'];
      const items = await promptLibraryProvider.listPrompts(activeScopes);
      promptLibraryViewProvider.updatePrompts(items);
    } catch {
      promptLibraryViewProvider.updatePrompts([]);
    }
  });

  const selectPrompt = vscode.commands.registerCommand('lumi-ops._selectPrompt', async (fileName: string, scope?: PromptScope) => {
    if (!fileName) return;
    try {
      const content = await promptLibraryProvider.getPromptContent(fileName, scope || 'project');
      const name = fileName.replace(/\.md$/, '');
      const branch = 'feat/' + name;
      const { creatorProvider } = deps;
      creatorProvider.loadPrompt(name, content);
      creatorProvider.setBranchName(branch);
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to load prompt: ${error.message}`);
    }
  });

  const createPromptInline = vscode.commands.registerCommand('lumi-ops._createPromptInline', async (name: string, scope?: PromptScope) => {
    if (!name) return;
    
    const targetScope = scope || 'project';
    const cleanName = name.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    const fileName = `${cleanName}.md`;
    const fileUri = promptLibraryProvider.getPromptFileUri(fileName, targetScope);
    
    try {
      await vscode.workspace.fs.stat(fileUri);
      vscode.window.showErrorMessage(`Prompt "${fileName}" already exists in ${targetScope} scope.`);
      return;
    } catch {
      // File does not exist, safe to create
    }

    try {
      await vscode.workspace.fs.writeFile(fileUri, new Uint8Array(0));
      vscode.commands.executeCommand('lumi-ops._getPrompts', undefined); // Refresh ui list
      const doc = await vscode.workspace.openTextDocument(fileUri);
      await vscode.window.showTextDocument(doc, { preview: false });
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to create prompt: ${error.message}`);
    }
  });

  const openPromptFile = vscode.commands.registerCommand('lumi-ops.openPromptFile', async (fileName: string, scope?: PromptScope) => {
    if (!fileName) return;
    try {
      const fileUri = promptLibraryProvider.getPromptFileUri(fileName, scope || 'project');
      const doc = await vscode.workspace.openTextDocument(fileUri);
      await vscode.window.showTextDocument(doc, { preview: false });
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to open prompt: ${error.message}`);
    }
  });

  const importFolder = vscode.commands.registerCommand('lumi-ops._importFolder', async (scope?: PromptScope) => {
    const targetScope = scope || 'project';
    const selections = await vscode.window.showOpenDialog({
      canSelectMany: true,
      canSelectFolders: true,
      canSelectFiles: true,
      filters: { 'Markdown': ['md'] },
      openLabel: 'Import'
    });
    if (!selections || selections.length === 0) return;

    let totalCount = 0;
    for (const uri of selections) {
      const stat = await vscode.workspace.fs.stat(uri);
      if ((stat.type & vscode.FileType.Directory) !== 0) {
        totalCount += await promptLibraryProvider.importFolder(uri, targetScope);
      } else {
        await promptLibraryProvider.importPrompt(uri, targetScope);
        totalCount++;
      }
    }
    vscode.window.showInformationMessage(`Imported ${totalCount} prompt(s) to ${targetScope}.`);
    vscode.commands.executeCommand('lumi-ops._getPrompts');
  });

  const addPrompt = vscode.commands.registerCommand('lumi-ops._addPrompt', async (scope?: PromptScope) => {
    const targetScope = scope || 'project';
    const name = await vscode.window.showInputBox({
      prompt: 'Prompt name',
      placeHolder: 'e.g. refactor-component'
    });
    if (!name) return;

    const content = await vscode.window.showInputBox({
      prompt: 'Prompt content (or leave empty to edit in file)',
      placeHolder: 'Describe the task objective...'
    });

    const fileName = name.endsWith('.md') ? name : `${name}.md`;
    await promptLibraryProvider.savePrompt(fileName, content || '', targetScope);
    vscode.commands.executeCommand('lumi-ops._getPrompts');

    if (!content) {
      const fileUri = promptLibraryProvider.getPromptFileUri(fileName, targetScope);
      const doc = await vscode.workspace.openTextDocument(fileUri);
      await vscode.window.showTextDocument(doc);
    } else {
      vscode.window.showInformationMessage(`Prompt "${name}" created in ${targetScope}.`);
    }
  });

  const deletePrompt = vscode.commands.registerCommand('lumi-ops._deletePrompt', async (fileName: string, scope?: PromptScope) => {
    if (!fileName) return;
    const targetScope = scope || 'project';
    const promptName = fileName.replace(/\.md$/, '');
    const suppress = context.globalState.get<boolean>('suppressDeleteConfirm', false);

    if (!suppress) {
      const confirm = await vscode.window.showWarningMessage(
        `Delete prompt "${promptName}" (${targetScope})?`,
        { modal: true },
        'Delete',
        "Delete & Don't Ask Again"
      );
      if (!confirm) return;
      if (confirm === "Delete & Don't Ask Again") {
        await context.globalState.update('suppressDeleteConfirm', true);
      }
    }

    await promptLibraryProvider.deletePrompt(fileName, targetScope);
    vscode.commands.executeCommand('lumi-ops._getPrompts');
  });

  const saveAsPrompt = vscode.commands.registerCommand('lumi-ops.saveAsPrompt', async (content?: string, scope?: PromptScope) => {
    if (!content) return;
    const targetScope = scope || 'project';
    const name = await vscode.window.showInputBox({
      prompt: 'Enter a name for this prompt template',
      placeHolder: 'e.g. my-agent-prompt'
    });
    if (name) {
      const fileName = name.endsWith('.md') ? name : `${name}.md`;
      await promptLibraryProvider.savePrompt(fileName, content, targetScope);
      vscode.window.showInformationMessage(`Prompt "${name}" saved to ${targetScope}.`);
      vscode.commands.executeCommand('lumi-ops._getPrompts');
    }
  });

  const copyPromptScope = vscode.commands.registerCommand('lumi-ops._copyPromptScope', async (fileName: string, fromScope: PromptScope, toScope: PromptScope) => {
    if (!fileName || !fromScope || !toScope) return;
    try {
      const { conflict } = await promptLibraryProvider.copyPromptToScope(fileName, fromScope, toScope);
      if (conflict) {
        const choice = await vscode.window.showQuickPick(
          ['Overwrite', 'Rename', 'Cancel'],
          { placeHolder: `A prompt with this name already exists in ${toScope}. Overwrite or Rename?` }
        );
        if (choice === 'Overwrite') {
          await promptLibraryProvider.copyPromptToScopeOverwrite(fileName, fromScope, toScope);
        } else if (choice === 'Rename') {
          const newName = await vscode.window.showInputBox({
            prompt: 'Enter new name for the copied prompt',
            value: fileName.replace(/\.md$/, '') + '-copy',
            validateInput: (v: string) => (!v?.trim() ? 'Name cannot be empty' : null),
          });
          if (newName) {
            const newFileName = newName.endsWith('.md') ? newName : `${newName}.md`;
            await promptLibraryProvider.copyPromptToScopeRenamed(fileName, newFileName, fromScope, toScope);
          }
        }
        // Cancel — do nothing
      }
      vscode.commands.executeCommand('lumi-ops._getPrompts');
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to copy prompt: ${error.message}`);
    }
  });

  const editPrompt = vscode.commands.registerCommand('lumi-ops._editPrompt', async (fileName: string, scope?: PromptScope) => {
    if (!fileName) return;
    const targetScope = scope || 'project';
    try {
      const fileUri = promptLibraryProvider.getPromptFileUri(fileName, targetScope);
      const doc = await vscode.workspace.openTextDocument(fileUri);
      await vscode.window.showTextDocument(doc);
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to open prompt: ${error.message}`);
    }
  });

  const getCloneBranches = vscode.commands.registerCommand('lumi-ops._getCloneBranches', async () => {
    await notifyCloneBranches();
  });

  return [
    statusSub,
    getPrompts,
    selectPrompt,
    createPromptInline,
    openPromptFile,
    importFolder,
    addPrompt,
    deletePrompt,
    saveAsPrompt,
    copyPromptScope,
    editPrompt,
    getCloneBranches,
  ];
}

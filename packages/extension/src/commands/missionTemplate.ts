import * as vscode from 'vscode';
import { MissionTemplateEditorProvider } from '../MissionTemplateEditorProvider';
import { CommandDeps } from './types';

export function registerMissionTemplateCommands(
  context: vscode.ExtensionContext,
  deps: CommandDeps,
): vscode.Disposable[] {
  const { rootPath, promptLibraryViewProvider, missionTemplateProvider } = deps;

  /** Refresh the mission template row in the prompt library webview. */
  async function notifyMissionTemplates() {
    try {
      const templates = await missionTemplateProvider.listTemplates();
      const active = await missionTemplateProvider.getActiveTemplateName();
      // Validate: active template must exist in the expected scope
      let activeKey = active.name === 'default' ? 'default' : `${active.name}:${active.scope}`;
      if (active.name !== 'default') {
        const match = templates.some(t => t.name === active.name && (active.scope === null || t.scope === active.scope));
        if (!match) {
          activeKey = 'default';
        }
      }
      promptLibraryViewProvider.updateMissionTemplate(activeKey, templates);
    } catch {
      promptLibraryViewProvider.updateMissionTemplate('default', []);
    }
  }

  const getMissionTemplates = vscode.commands.registerCommand('lumi-ops._getMissionTemplates', async () => {
    await notifyMissionTemplates();
  });

  const switchMission = vscode.commands.registerCommand('lumi-ops._switchMission', async (name: string, scope?: string) => {
    if (!name) return;
    await missionTemplateProvider.setActiveTemplate(name, scope as any);
    await notifyMissionTemplates();
  });

  const editMission = vscode.commands.registerCommand('lumi-ops._editMission', async () => {
    const active = await missionTemplateProvider.getActiveTemplateName();
    if (active.name === 'default') {
      vscode.window.showInformationMessage('Default mission template cannot be edited. Use "+" to fork it first.');
      return;
    }
    // Find the template file and open it (the custom editor will handle rendering)
    const templates = await missionTemplateProvider.listTemplates();
    const match = templates.find(t => t.name === active.name && (active.scope === null || t.scope === active.scope));
    if (match) {
      const fileUri = missionTemplateProvider.getTemplateFileUri(match.fileName, match.scope as any);
      await vscode.commands.executeCommand('vscode.openWith', fileUri, MissionTemplateEditorProvider.viewType);
    } else {
      vscode.window.showErrorMessage(`Mission template "${active.name}" not found.`);
    }
  });

  const forkMission = vscode.commands.registerCommand('lumi-ops._forkMission', async () => {
    const name = await vscode.window.showInputBox({
      prompt: 'Name for your new mission template',
      placeHolder: 'e.g. my-workflow',
      validateInput: (value: string) => {
        if (!value || !value.trim()) return 'Name cannot be empty';
        if (!/^[a-zA-Z0-9_-]+$/.test(value.trim())) return 'Only letters, numbers, hyphens, and underscores';
        return null;
      }
    });
    if (!name) return;

    const scope = rootPath ? 'project' : 'global';
    try {
      const fileUri = await missionTemplateProvider.forkDefault(name.trim(), scope);
      await missionTemplateProvider.setActiveTemplate(name.trim(), scope);
      await notifyMissionTemplates();
      // Open the new template with custom editor
      await vscode.commands.executeCommand('vscode.openWith', fileUri, MissionTemplateEditorProvider.viewType);
      vscode.window.showInformationMessage(`Mission template "${name}" created and activated.`);
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to create mission template: ${error.message}`);
    }
  });

  // Copy mission template to other scope from dropdown
  const copyMissionScope = vscode.commands.registerCommand('lumi-ops._copyMissionScope', async (templateName: string, fromScope: string, toScope: string) => {
    if (!templateName || !fromScope || !toScope) return;
    try {
      const { conflict } = await missionTemplateProvider.copyToScope(`${templateName}.md`, fromScope as any, toScope as any);
      if (conflict) {
        const choice = await vscode.window.showQuickPick(
          ['Overwrite', 'Rename', 'Cancel'],
          { placeHolder: `A template with this name already exists in ${toScope}. Overwrite or Rename?` }
        );
        if (choice === 'Overwrite') {
          await missionTemplateProvider.copyToScopeOverwrite(`${templateName}.md`, fromScope as any, toScope as any);
        } else if (choice === 'Rename') {
          const newName = await vscode.window.showInputBox({
            prompt: 'Enter new name for the copied template',
            value: templateName + '-copy',
            validateInput: (v: string) => (!v?.trim() ? 'Name cannot be empty' : null),
          });
          if (newName) {
            const newFileName = newName.endsWith('.md') ? newName : `${newName}.md`;
            await missionTemplateProvider.copyToScopeRenamed(`${templateName}.md`, newFileName, fromScope as any, toScope as any);
          }
        }
      }
      await notifyMissionTemplates();
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to copy template: ${error.message}`);
    }
  });

  // Edit a specific mission template by name+scope
  const editMissionByName = vscode.commands.registerCommand('lumi-ops._editMissionByName', async (name: string, scope: string) => {
    if (!name || !scope) return;
    try {
      const fileUri = missionTemplateProvider.getTemplateFileUri(`${name}.md`, scope as any);
      await vscode.commands.executeCommand('vscode.openWith', fileUri, MissionTemplateEditorProvider.viewType);
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to open template: ${error.message}`);
    }
  });

  // Delete a mission template
  const deleteMission = vscode.commands.registerCommand('lumi-ops._deleteMission', async (name: string, scope: string) => {
    if (!name || !scope) return;
    const confirm = await vscode.window.showWarningMessage(
      `Delete mission template "${name}" (${scope})?`, { modal: true }, 'Delete'
    );
    if (confirm !== 'Delete') return;
    try {
      await missionTemplateProvider.deleteTemplate(`${name}.md`, scope as any);
      // If deleting the active template, reset to default
      const active = await missionTemplateProvider.getActiveTemplateName();
      if (active.name === name && (active.scope === null || active.scope === scope)) {
        await missionTemplateProvider.setActiveTemplate('default');
      }
      await notifyMissionTemplates();
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to delete template: ${error.message}`);
    }
  });

  return [
    getMissionTemplates,
    switchMission,
    editMission,
    forkMission,
    copyMissionScope,
    editMissionByName,
    deleteMission,
  ];
}

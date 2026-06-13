import * as vscode from 'vscode';
import * as path from 'path';
import { getClonesDir, LUMI_OPS_HOME, hasLegacyClones, migrateLegacyClones, migrateMetadataToLumiDir } from '@lumi-ops/cli';

/**
 * Run all one-time migrations during extension activation.
 * Each migration is best-effort and will not block activation on failure.
 */
export async function runMigrations(context: vscode.ExtensionContext, rootPath: string | undefined): Promise<void> {
  await migrateLegacyWorktrees(rootPath);
  await migrateMetadataLocation(rootPath);
  await migrateGlobalPrompts(context);
  await migrateProjectPrompts(rootPath);
}

/**
 * Move the centralized metadata file out of the transient `.worktrees/`
 * container into the durable `<repoRoot>/.lumi/` storage dir. Runs after the
 * legacy `.shadow-clones` → `.worktrees` migration (two-hop) and before the
 * sidebar first reads metadata. Best-effort.
 */
async function migrateMetadataLocation(rootPath: string | undefined): Promise<void> {
  if (!rootPath) return;
  try {
    await migrateMetadataToLumiDir(rootPath);
  } catch {
    // Best-effort — don't block activation
  }
}

/**
 * Move legacy .shadow-clones/ worktrees to <repoRoot>.worktrees/
 */
async function migrateLegacyWorktrees(rootPath: string | undefined): Promise<void> {
  if (!rootPath || !hasLegacyClones(rootPath)) return;
  try {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Lumi-Ops: Migrating worktrees…' },
      () => migrateLegacyClones(rootPath)
    );
  } catch {
    // Best-effort — don't block activation
  }
}

/**
 * Move global prompts from VS Code globalStorageUri/prompts/ to ~/.lumi-ops/.prompts/
 */
async function migrateGlobalPrompts(context: vscode.ExtensionContext): Promise<void> {
  try {
    const legacyDir = vscode.Uri.joinPath(context.globalStorageUri, 'prompts');
    const entries = await vscode.workspace.fs.readDirectory(legacyDir);
    if (entries.length === 0) return;

    const newDir = vscode.Uri.file(path.join(LUMI_OPS_HOME, '.prompts'));
    try { await vscode.workspace.fs.createDirectory(newDir); } catch {}

    for (const [name, type] of entries) {
      if ((type & vscode.FileType.File) !== 0) {
        const src = vscode.Uri.joinPath(legacyDir, name);
        const dst = vscode.Uri.joinPath(newDir, name);
        try { await vscode.workspace.fs.stat(dst); } catch {
          await vscode.workspace.fs.copy(src, dst);
        }
      }
    }
    await vscode.workspace.fs.delete(legacyDir, { recursive: true });
  } catch {
    // No legacy global prompts or already migrated
  }
}

/**
 * Move project prompts from <repoRoot>.worktrees/.prompts/ to <repoRoot>/.prompts/
 */
async function migrateProjectPrompts(rootPath: string | undefined): Promise<void> {
  if (!rootPath) return;
  try {
    // Legacy project prompts lived inside the `.worktrees/` container.
    const legacyDir = vscode.Uri.file(path.join(getClonesDir(rootPath), '.prompts'));
    const entries = await vscode.workspace.fs.readDirectory(legacyDir);
    if (entries.length === 0) return;

    const newDir = vscode.Uri.file(path.join(rootPath, '.prompts'));
    try { await vscode.workspace.fs.createDirectory(newDir); } catch {}

    for (const [name, type] of entries) {
      if ((type & vscode.FileType.File) !== 0) {
        const src = vscode.Uri.joinPath(legacyDir, name);
        const dst = vscode.Uri.joinPath(newDir, name);
        try { await vscode.workspace.fs.stat(dst); } catch {
          await vscode.workspace.fs.copy(src, dst);
        }
      }
    }
    await vscode.workspace.fs.delete(legacyDir, { recursive: true });
  } catch {
    // No legacy project prompts or already migrated
  }
}

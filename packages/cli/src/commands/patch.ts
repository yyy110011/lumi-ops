import * as fs from 'fs-extra';
import * as path from 'path';
import * as crypto from 'crypto';
import chalk from 'chalk';

// ─── Constants ───────────────────────────────────────────────────────────────
const PATCH_MARKER = '/*LUMI:autostart*/';
const BACKUP_SUFFIX = '.lumi-backup';
const DEFAULT_MESSAGE = 'Please read @MISSION.md and start working on the objective described in it.';
const WORKBENCH_FILE = 'vs/workbench/workbench.desktop.main.js';

const DEFAULT_PATHS: Record<string, string> = {
  darwin: '/Applications/Antigravity.app/Contents/Resources/app/out',
  win32: path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Antigravity', 'resources', 'app', 'out'),
  linux: '/opt/Antigravity/resources/app/out',
};

// ─── Structural Pattern Matching ─────────────────────────────────────────────

/**
 * Structural regex to find `sendMessageToChatPanel` by its code shape.
 *
 * The pattern matches:
 *   sendMessageToChatPanel(<p>){const <v>=[<es>(<proto>,{chunk:{case:"text",value:<p>}})];this.openPanel(),this.<emitter>.fire({actionType:"sendMessage",payload:<v>.map(<n>=><fie>(<proto>,<n>))})}<nextMethod>
 *
 * Property names survive minification, so this is version-resilient.
 */
const SEND_MESSAGE_PATTERN = /sendMessageToChatPanel\((\w+)\)\{const (\w+)=\[(\w+)\((\w+),\{chunk:\{case:"text",value:\1\}\}\)\];this\.openPanel\(\),this\.(\w+)\.fire\(\{actionType:"sendMessage",payload:\2\.map\((\w+)=>/;

/**
 * Pattern to find the DI registration: li(<serviceId>, <className>, 1)
 * We search for this AFTER finding sendMessageToChatPanel to locate the class name.
 */
const DI_REGISTRATION_PATTERN = /li\((\w+),(\w+),1\)/;

/**
 * Pattern to find the workspace service accessor: this.<ws>.getWorkspace().folders
 * We search within the same class body.
 */
const WORKSPACE_SERVICE_PATTERN = /this\.(\w+)\.getWorkspace\(\)\.folders/;

// ─── Core Logic ──────────────────────────────────────────────────────────────

interface MatchResult {
  /** The offset of sendMessageToChatPanel in the source */
  sendMessageOffset: number;
  /** The class variable name (e.g., "sEn") */
  className: string;
  /** The DI service ID variable (e.g., "Npe") */
  serviceId: string;
  /** The workspace service property (e.g., "O") */
  workspaceProp: string;
  /** The event emitter property (e.g., "b") */
  emitterProp: string;
  /** The protobuf create function (e.g., "es") */
  protoCreate: string;
  /** The protobuf type constant (e.g., "uG") */
  protoType: string;
  /** The protobuf serialize function (e.g., "fie") */
  protoSerialize: string;
  /** Registration string offset for injection point */
  registrationOffset: number;
  /** Full registration string for anchoring */
  registrationString: string;
}

/**
 * Analyze the workbench bundle to find the injection point and extract
 * minified variable names needed for the patch.
 */
export function analyzeBundle(source: string): MatchResult {
  // Step 1: Find sendMessageToChatPanel by structural shape
  const sendMatch = SEND_MESSAGE_PATTERN.exec(source);
  if (!sendMatch) {
    throw new Error(
      'Could not find sendMessageToChatPanel in bundle.\n' +
      'The code structure may have changed in this Antigravity version.'
    );
  }

  const sendMessageOffset = sendMatch.index;
  const [, /* param */, /* listVar */, protoCreate, protoType, emitterProp, /* mapArg */] = sendMatch;

  // Extract the serialize function from the full match context
  const fullContext = source.substring(sendMessageOffset, sendMessageOffset + 400);
  const serializeMatch = fullContext.match(/\.map\(\w+=>(\w+)\(/);
  if (!serializeMatch) {
    throw new Error('Could not extract protobuf serialize function from sendMessageToChatPanel context.');
  }
  const protoSerialize = serializeMatch[1];

  // Step 2: Find DI registration after the method (li(<svcId>, <className>, 1))
  const afterMethod = source.substring(sendMessageOffset, sendMessageOffset + 5000);
  const regMatch = DI_REGISTRATION_PATTERN.exec(afterMethod);
  if (!regMatch) {
    throw new Error(
      'Could not find DI registration (li(...)) after sendMessageToChatPanel.\n' +
      'The service registration pattern may have changed.'
    );
  }

  const [registrationString, serviceId, className] = regMatch;
  const registrationOffset = sendMessageOffset + regMatch.index;

  // Step 3: Find workspace service property in the class body
  // Search backwards ~20KB for the class constructor
  const classStart = Math.max(0, sendMessageOffset - 20000);
  const classBody = source.substring(classStart, sendMessageOffset + 500);
  const wsMatch = WORKSPACE_SERVICE_PATTERN.exec(classBody);
  if (!wsMatch) {
    throw new Error(
      'Could not find workspace service property (this.<x>.getWorkspace().folders) in class body.\n' +
      'The workspace service integration may have changed.'
    );
  }
  const workspaceProp = wsMatch[1];

  return {
    sendMessageOffset,
    className,
    serviceId,
    workspaceProp,
    emitterProp,
    protoCreate,
    protoType,
    protoSerialize,
    registrationOffset,
    registrationString,
  };
}

/**
 * Generate the injection code that adds auto-start behavior.
 *
 * The injected code monkey-patches the class prototype so that the first call
 * to any method (triggered by Antigravity initializing the service) sets up
 * a delayed MISSION.md check.
 *
 * Alternatively, we use a simpler approach: wrap the sendMessageToChatPanel
 * on the prototype to perform a one-time init check.
 */
export function generatePatch(match: MatchResult, message: string): string {
  // We inject a self-invoking function right after li(Npe, sEn, 1);
  // It patches the class prototype's constructor to add a startup hook.
  //
  // The hook:
  //   1. Waits 5 seconds for everything to initialize
  //   2. Checks workspace folders for MISSION.md
  //   3. If found, calls sendMessageToChatPanel with the message
  //   4. Only fires once (guarded by a flag)

  const { className, workspaceProp } = match;
  const escapedMessage = message.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

  return `${PATCH_MARKER}(function(){` +
    `var _origCtor=${className}.prototype.constructor;` +
    `var _patched=!1;` +
    `var _origSend=${className}.prototype.sendMessageToChatPanel;` +
    // Override sendMessageToChatPanel to add a one-time startup check
    // on first access to the service (which happens at startup)
    `${className}.prototype.sendMessageToChatPanel=function(e){` +
      `_origSend.call(this,e);` +
      `if(!_patched){` +
        `_patched=!0;` +
        `var self=this;` +
        `setTimeout(function(){` +
          `try{` +
            `var folders=self.${workspaceProp}.getWorkspace().folders;` +
            `if(folders&&folders.length>0){` +
              `var rootUri=folders[0].uri;` +
              `var mUri=rootUri.with({path:rootUri.path+"/MISSION.md"});` +
              // Use the file service to stat MISSION.md — but we don't have it directly.
              // Simpler: use fetch or the Node fs module since we're in Electron.
              `require("fs").stat(mUri.fsPath,function(err){` +
                `if(!err){` +
                  `self.sendMessageToChatPanel('${escapedMessage}');` +
                `}` +
              `});` +
            `}` +
          `}catch(ex){console.error("[LUMI:autostart]",ex)}` +
        `},5000);` +
      `}` +
    `};` +
  `})();`;
}

// ─── Alternative simpler patch approach ──────────────────────────────────────
/**
 * A simpler injection that doesn't depend on the sendMessageToChatPanel method
 * being called first. Instead, it injects a setTimeout at module scope that
 * waits for the service to be available and then checks for MISSION.md.
 */
export function generateSimplePatch(match: MatchResult, message: string, autoSubmit = true): string {
  const { className, workspaceProp } = match;
  const escapedMessage = message.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

  // The injected code:
  // 1. Patches the class prototype's mb() method (called during constructor)
  // 2. On first instantiation, sets a delayed timer (8s)
  // 3. Checks if workspace root path contains ".worktrees/" (shadow clone indicator)
  // 4. If matched:
  //    autoSubmit=true  → calls sendMessageToChatPanel (sends message directly)
  //    autoSubmit=false → copies to clipboard, opens panel, focuses input

  const actionCode = autoSubmit
    ? // Auto-submit: send message directly
      `console.log("[LUMI:autostart] Shadow clone detected, auto-starting chat");` +
      `self.sendMessageToChatPanel('${escapedMessage}');`
    : // Manual: copy to clipboard + open + focus
      `console.log("[LUMI:autostart] Shadow clone detected, preparing chat input");` +
      `var ta=document.createElement("textarea");` +
      `ta.value='${escapedMessage}';` +
      `ta.style.position="fixed";ta.style.opacity="0";` +
      `document.body.appendChild(ta);ta.select();` +
      `document.execCommand("copy");document.body.removeChild(ta);` +
      `self.openPanel();` +
      `setTimeout(function(){` +
        `self.b.fire({actionType:"toggleFocus"});` +
        `console.log("[LUMI:autostart] Panel opened, press Cmd+V to paste prompt");` +
      `},1000);`;

  return `${PATCH_MARKER}(function(){` +
    `var _lumi_done=!1;` +
    `var _origInit=${className}.prototype.mb;` +
    `if(_origInit){` +
      `${className}.prototype.mb=function(){` +
        `_origInit.call(this);` +
        `if(_lumi_done)return;` +
        `_lumi_done=!0;` +
        `var self=this;` +
        `setTimeout(function(){` +
          `try{` +
            `var folders=self.${workspaceProp}.getWorkspace().folders;` +
            `if(!folders||!folders.length)return;` +
            `var rootPath=folders[0].uri.path||"";` +
            `if(rootPath.indexOf(".worktrees/")!==-1){` +
              actionCode +
            `}` +
          `}catch(ex){console.error("[LUMI:autostart] error:",ex)}` +
        `},8000);` +
      `};` +
    `}` +
  `})();`;
}

// ─── File Operations ─────────────────────────────────────────────────────────

export function detectAntigravityPath(): string | null {
  const platform = process.platform as string;
  const defaultPath = DEFAULT_PATHS[platform];
  if (!defaultPath) return null;

  try {
    fs.accessSync(path.join(defaultPath, WORKBENCH_FILE));
    return defaultPath;
  } catch {
    return null;
  }
}

function getWorkbenchPath(basePath: string): string {
  return path.join(basePath, WORKBENCH_FILE);
}

function getBackupPath(filePath: string): string {
  return filePath + BACKUP_SUFFIX;
}

function getProductJsonPath(basePath: string): string {
  // product.json is one level up from the out/ directory
  return path.join(basePath, '..', 'product.json');
}

/**
 * Recalculate the SHA-256 checksum of the workbench file and update product.json.
 * Antigravity checks these checksums on startup and shows a "corrupt installation"
 * warning if they don't match.
 */
async function updateProductChecksum(basePath: string): Promise<boolean> {
  const productPath = getProductJsonPath(basePath);
  const workbenchPath = getWorkbenchPath(basePath);

  try {
    // Read the patched/restored workbench file
    const content = await fs.readFile(workbenchPath);
    const hash = crypto.createHash('sha256').update(content).digest('base64').replace(/=+$/, '');

    // Read and update product.json
    const product = await fs.readJson(productPath);
    if (product.checksums && product.checksums[WORKBENCH_FILE]) {
      product.checksums[WORKBENCH_FILE] = hash;
      await fs.writeJson(productPath, product, { spaces: '\t' });
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

// ─── Commands ────────────────────────────────────────────────────────────────

export async function patchApply(options: { path?: string; message?: string; noSubmit?: boolean }): Promise<void> {
  const basePath = options.path || detectAntigravityPath();
  if (!basePath) {
    console.error(chalk.red(
      '❌ Could not auto-detect Antigravity installation.\n' +
      '   Use --path to specify: lumi-ops patch apply --path /path/to/antigravity/out'
    ));
    return;
  }

  const workbenchPath = getWorkbenchPath(basePath);
  const backupPath = getBackupPath(workbenchPath);
  const message = options.message || DEFAULT_MESSAGE;

  console.log(chalk.gray(`📂 Antigravity: ${basePath}`));

  // Read bundle
  let source: string;
  try {
    source = await fs.readFile(workbenchPath, 'utf-8');
  } catch (err: any) {
    console.error(chalk.red(`❌ Cannot read workbench bundle: ${err.message}`));
    return;
  }

  // Check for existing patch
  if (source.includes(PATCH_MARKER)) {
    console.log(chalk.yellow('⚠️  Already patched. Use "lumi-ops patch revert" first to re-apply.'));
    return;
  }

  // Analyze bundle
  let match: MatchResult;
  try {
    match = analyzeBundle(source);
  } catch (err: any) {
    console.error(chalk.red(`❌ Analysis failed: ${err.message}`));
    return;
  }

  console.log(chalk.gray(`  ✓ Found sendMessageToChatPanel at offset ${match.sendMessageOffset}`));
  console.log(chalk.gray(`    class=${match.className}, workspace=this.${match.workspaceProp}`));
  console.log(chalk.gray(`    service=${match.serviceId}, emitter=this.${match.emitterProp}`));

  // Create backup
  if (!await fs.pathExists(backupPath)) {
    await fs.copyFile(workbenchPath, backupPath);
    console.log(chalk.gray('  ✓ Created backup'));
  } else {
    console.log(chalk.gray('  ✓ Backup already exists'));
  }

  // Generate and inject patch
  const autoSubmit = !options.noSubmit;
  const patch = generateSimplePatch(match, message, autoSubmit);
  console.log(chalk.gray(`    mode=${autoSubmit ? 'auto-submit' : 'clipboard'}`));

  // Inject right after the DI registration: li(Npe, sEn, 1);
  const injectionPoint = match.registrationString;
  const injectionIndex = source.indexOf(injectionPoint, match.sendMessageOffset);
  if (injectionIndex === -1) {
    console.error(chalk.red('❌ Could not find injection point for patch.'));
    return;
  }

  const patched = source.substring(0, injectionIndex + injectionPoint.length + 1) +
    patch +
    source.substring(injectionIndex + injectionPoint.length + 1);

  // Write patched file
  await fs.writeFile(workbenchPath, patched, 'utf-8');

  // Update product.json checksum to prevent "corrupt installation" warning
  const checksumUpdated = await updateProductChecksum(basePath);
  if (checksumUpdated) {
    console.log(chalk.gray('  ✓ Updated product.json checksum'));
  }

  const bytesAdded = patch.length;
  console.log(chalk.green(`\n✅ Patched (+${bytesAdded} bytes). Restart Antigravity to activate.`));
}

export async function patchRevert(options: { path?: string }): Promise<void> {
  const basePath = options.path || detectAntigravityPath();
  if (!basePath) {
    console.error(chalk.red(
      '❌ Could not auto-detect Antigravity installation.\n' +
      '   Use --path to specify: lumi-ops patch revert --path /path/to/antigravity/out'
    ));
    return;
  }

  const workbenchPath = getWorkbenchPath(basePath);
  const backupPath = getBackupPath(workbenchPath);

  if (!await fs.pathExists(backupPath)) {
    console.error(chalk.red('❌ No backup found. Nothing to revert.'));
    return;
  }

  await fs.copyFile(backupPath, workbenchPath);
  await fs.remove(backupPath);

  // Restore original checksum in product.json
  await updateProductChecksum(basePath);

  console.log(chalk.green('✅ Reverted to original. Restart Antigravity to activate.'));
}

export async function patchStatus(options: { path?: string }): Promise<void> {
  const basePath = options.path || detectAntigravityPath();
  if (!basePath) {
    console.error(chalk.red(
      '❌ Could not auto-detect Antigravity installation.\n' +
      '   Use --path to specify: lumi-ops patch status --path /path/to/antigravity/out'
    ));
    return;
  }

  const workbenchPath = getWorkbenchPath(basePath);
  const backupPath = getBackupPath(workbenchPath);

  console.log(chalk.gray(`📂 Antigravity: ${basePath}`));

  let source: string;
  try {
    source = await fs.readFile(workbenchPath, 'utf-8');
  } catch (err: any) {
    console.error(chalk.red(`❌ Cannot read workbench bundle: ${err.message}`));
    return;
  }

  const isPatched = source.includes(PATCH_MARKER);
  const hasBackup = await fs.pathExists(backupPath);

  if (isPatched) {
    console.log(chalk.green('✅ Patched (auto-start active)'));
    if (hasBackup) {
      console.log(chalk.gray('   Backup available for revert'));
    }
  } else {
    console.log(chalk.yellow('⚠️  Not patched'));
    if (hasBackup) {
      console.log(chalk.gray('   ⚠️  Stale backup exists (Antigravity may have updated)'));
    }
  }

  // Try to analyze even if not patched, to confirm compatibility
  try {
    const match = analyzeBundle(source.includes(PATCH_MARKER) ?
      // If patched, strip the patch to analyze original patterns
      source.replace(new RegExp(`/\\*LUMI:autostart\\*/\\(function\\(\\)\\{[^]*?\\}\\)\\(\\);`), '') :
      source
    );
    console.log(chalk.gray(`   sendMessageToChatPanel found at offset ${match.sendMessageOffset}`));
    console.log(chalk.gray(`   Compatible with this Antigravity version`));
  } catch {
    console.log(chalk.red('   ⚠️  Could not verify compatibility with current version'));
  }
}

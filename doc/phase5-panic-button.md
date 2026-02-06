# Phase 5: Reverse Panic Button (Intervention)

## 🎯 Goal
Enable the Agent to "call for help" when it's stuck. The Extension watches for `blocked` status and proactively notifies the user with a one-click intervention option.

---

## 📂 Files to Modify

| File | Action |
|------|--------|
| `packages/extension/src/ShadowTreeProvider.ts` | **MODIFY** - Export status interface |
| `packages/extension/src/extension.ts` | **MODIFY** - Add status watcher and notification |
| `packages/cli/src/commands/spawn.ts` | **VERIFY** - Ensure `blocked` is valid status |

---

## 📋 Step-by-Step Implementation

### Step 1: Verify Status Protocol

Ensure the `LumiStatus` interface in `ShadowTreeProvider.ts` includes `blocked`:

```typescript
export interface LumiStatus {
  status: 'coding' | 'testing' | 'blocked' | 'done' | 'idle';
  message: string;
  session: string;
  startedAt?: string;
  driver?: string;
}
```

### Step 2: Create Status Watcher Class

In `extension.ts` or a new file `StatusWatcher.ts`:

```typescript
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { LumiStatus } from './ShadowTreeProvider';

interface AgentState {
  path: string;
  branch: string;
  lastStatus: string;
}

export class StatusWatcher {
  private watchers: Map<string, fs.FSWatcher> = new Map();
  private agentStates: Map<string, AgentState> = new Map();
  private disposables: vscode.Disposable[] = [];
  
  constructor(
    private workspaceRoot: string,
    private onBlockedCallback: (branch: string, message: string, worktreePath: string) => void
  ) {}
  
  start(): void {
    // Watch the .shadow-clones directory for new agents
    const shadowDir = path.join(this.workspaceRoot, '.shadow-clones');
    
    if (!fs.existsSync(shadowDir)) {
      return;
    }
    
    // Initial scan
    this.scanAndWatch(shadowDir);
    
    // Watch for new worktrees
    const dirWatcher = fs.watch(shadowDir, (event, filename) => {
      if (filename) {
        this.scanAndWatch(shadowDir);
      }
    });
    
    this.watchers.set(shadowDir, dirWatcher);
  }
  
  private scanAndWatch(shadowDir: string): void {
    const branches = fs.readdirSync(shadowDir);
    
    for (const branch of branches) {
      const branchPath = path.join(shadowDir, branch);
      const statusPath = path.join(branchPath, '.lumi-status.json');
      
      // Skip if not a directory
      if (!fs.statSync(branchPath).isDirectory()) continue;
      
      // Skip if already watching
      if (this.watchers.has(statusPath)) continue;
      
      // Initialize state
      this.agentStates.set(branch, {
        path: branchPath,
        branch,
        lastStatus: this.readStatus(statusPath)?.status || 'unknown'
      });
      
      // Watch status file
      if (fs.existsSync(statusPath)) {
        this.watchStatusFile(branch, statusPath, branchPath);
      }
    }
  }
  
  private watchStatusFile(branch: string, statusPath: string, branchPath: string): void {
    const watcher = fs.watch(statusPath, (event) => {
      if (event === 'change') {
        const status = this.readStatus(statusPath);
        const state = this.agentStates.get(branch);
        
        if (status && state) {
          // Check for transition TO blocked
          if (status.status === 'blocked' && state.lastStatus !== 'blocked') {
            this.onBlockedCallback(branch, status.message, branchPath);
          }
          
          // Update state
          state.lastStatus = status.status;
        }
      }
    });
    
    this.watchers.set(statusPath, watcher);
  }
  
  private readStatus(statusPath: string): LumiStatus | null {
    try {
      if (fs.existsSync(statusPath)) {
        return JSON.parse(fs.readFileSync(statusPath, 'utf-8'));
      }
    } catch (e) {
      // Ignore
    }
    return null;
  }
  
  dispose(): void {
    for (const watcher of this.watchers.values()) {
      watcher.close();
    }
    this.watchers.clear();
    this.agentStates.clear();
  }
}
```

### Step 3: Integrate Status Watcher in extension.ts

```typescript
import { StatusWatcher } from './StatusWatcher';

export async function activate(context: vscode.ExtensionContext) {
  // ... existing code ...
  
  // -- Status Watcher for Panic Button --
  if (rootPath) {
    const statusWatcher = new StatusWatcher(
      rootPath,
      async (branch, message, worktreePath) => {
        // Show error notification with action button
        const action = await vscode.window.showErrorMessage(
          `🚨 Agent "${branch}" is stuck: ${message}`,
          { modal: false },
          'Jump In'
        );
        
        if (action === 'Jump In') {
          // Simultaneously open window AND attach terminal
          const clone = { branch, path: worktreePath, isShadow: true };
          
          // 1. Open new VS Code window with worktree
          const uri = vscode.Uri.file(worktreePath);
          vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: true });
          
          // 2. Read status to get session name and attach
          const statusPath = path.join(worktreePath, '.lumi-status.json');
          try {
            const status = JSON.parse(fs.readFileSync(statusPath, 'utf-8'));
            if (status.session) {
              const terminal = vscode.window.createTerminal({
                name: `🤖 ${status.session}`,
                shellPath: '/bin/zsh',
                shellArgs: ['-c', `tmux attach -t ${status.session}`]
              });
              terminal.show();
            }
          } catch (e) {
            // Fallback: just open the window
          }
        }
      }
    );
    
    statusWatcher.start();
    
    context.subscriptions.push({
      dispose: () => statusWatcher.dispose()
    });
  }
}
```

### Step 4: Update Icon for Blocked Status

Ensure `ShadowTreeProvider.ts` has proper icon for blocked:

```typescript
private getIcon(): vscode.ThemeIcon {
  if (!this.status) {
    return new vscode.ThemeIcon(this.clone.isShadow ? 'git-branch' : 'repo');
  }
  
  switch (this.status.status) {
    case 'coding':
      return new vscode.ThemeIcon('sync~spin', new vscode.ThemeColor('charts.yellow'));
    case 'testing':
      return new vscode.ThemeIcon('beaker', new vscode.ThemeColor('charts.blue'));
    case 'blocked':
      // Red warning with animation effect
      return new vscode.ThemeIcon('alert', new vscode.ThemeColor('errorForeground'));
    case 'done':
      return new vscode.ThemeIcon('check', new vscode.ThemeColor('charts.green'));
    case 'idle':
    default:
      return new vscode.ThemeIcon('circle-outline');
  }
}
```

### Step 5: Add Manual "Jump In" Command

For cases where user sees blocked status in tree view:

```typescript
context.subscriptions.push(
  vscode.commands.registerCommand('lumi-ops.jumpIn', async (item: ShadowItem) => {
    if (!item) return;
    
    // Open window
    const uri = vscode.Uri.file(item.clone.path);
    vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: true });
    
    // Attach terminal if session exists
    if (item.status?.session) {
      const terminal = vscode.window.createTerminal({
        name: `🤖 ${item.status.session}`,
        shellPath: '/bin/zsh',
        shellArgs: ['-c', `tmux attach -t ${item.status.session}`]
      });
      terminal.show();
    }
  })
);
```

### Step 6: Update package.json

```json
{
  "contributes": {
    "commands": [
      {
        "command": "lumi-ops.jumpIn",
        "title": "Jump In (Open + Attach)",
        "icon": "$(debug-start)"
      }
    ],
    "menus": {
      "view/item/context": [
        {
          "command": "lumi-ops.jumpIn",
          "when": "view == lumi-ops.activeClones && viewItem == activeAgent",
          "group": "inline"
        }
      ]
    }
  }
}
```

---

## 🧪 How to Test

1. Create a shadow clone with background mode
2. Manually edit `.lumi-status.json` to set `"status": "blocked"`
3. Verify notification appears
4. Click "Jump In" and verify both window + terminal open

---

## ✅ Verification Checklist

- [ ] StatusWatcher starts when extension activates
- [ ] Notification appears when status changes to `blocked`
- [ ] "Jump In" button opens new VS Code window
- [ ] "Jump In" button attaches terminal to tmux session
- [ ] Tree item shows red alert icon for blocked agents
- [ ] Right-click "Jump In" command works from tree view
- [ ] No duplicate notifications for same blocked event

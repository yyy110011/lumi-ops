# Phase 2: VS Code Dashboard

## 🎯 Goal
Transform the sidebar from a static worktree list into a **live monitoring dashboard** that displays agent status and enables direct interaction with background agents.

---

## 📂 Files to Modify

| File | Action |
|------|--------|
| `packages/extension/src/ShadowTreeProvider.ts` | **MODIFY** - Add status reading and dynamic icons |
| `packages/extension/src/extension.ts` | **MODIFY** - Register attach command, add polling |
| `packages/extension/package.json` | **MODIFY** - Add new command contributions |

---

## 📋 Technical Requirements

### 1. Status File Schema

Each worktree may contain a `.lumi-status.json` file:

```typescript
interface LumiStatus {
  status: 'coding' | 'testing' | 'blocked' | 'done' | 'idle';
  message: string;
  session: string;        // tmux session name
  startedAt?: string;     // ISO-8601 timestamp
  driver?: string;        // driver command used
}
```

### 2. Update ShadowTreeProvider

#### 2.1 Read Status in `getChildren`

```typescript
import * as fs from 'fs-extra';

interface LumiStatus {
  status: 'coding' | 'testing' | 'blocked' | 'done' | 'idle';
  message: string;
  session: string;
}

async getChildren(element?: ShadowItem): Promise<ShadowItem[]> {
  // ... existing logic to get clones ...
  
  const clones = await this.getShadowClones();
  
  // Read status for each clone
  const itemsWithStatus = await Promise.all(
    clones.map(async (clone) => {
      const statusPath = path.join(clone.path, '.lumi-status.json');
      let status: LumiStatus | undefined;
      
      try {
        if (await fs.pathExists(statusPath)) {
          status = await fs.readJson(statusPath);
        }
      } catch (e) {
        // Ignore read errors
      }
      
      return new ShadowItem(
        clone.branch,
        vscode.TreeItemCollapsibleState.None,
        clone,
        status  // Pass status to ShadowItem
      );
    })
  );
  
  return itemsWithStatus;
}
```

#### 2.2 Update ShadowItem Class

```typescript
class ShadowItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly clone: ShadowClone,
    public readonly status?: LumiStatus  // NEW
  ) {
    super(label, collapsibleState);
    
    this.tooltip = this.status 
      ? `${this.clone.path}\n\nStatus: ${this.status.status}\n${this.status.message}`
      : this.clone.path;
    
    this.description = this.getDescription();
    this.contextValue = this.getContextValue();
    this.iconPath = this.getIcon();
    
    // Only set command if no active session (don't override attach behavior)
    if (!this.status?.session) {
      this.command = {
        command: 'lumi-ops.open',
        title: 'Open Clone',
        arguments: [this.clone]
      };
    }
  }
  
  private getDescription(): string {
    if (this.status) {
      return `[${this.status.status.toUpperCase()}] ${this.status.message}`;
    }
    return this.clone.isShadow ? 'Shadow Clone' : 'Main Repository';
  }
  
  private getContextValue(): string {
    if (this.status?.session) {
      return 'activeAgent';  // Has context menu for attach
    }
    return this.clone.isShadow ? 'shadowClone' : 'coreRepo';
  }
  
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
        return new vscode.ThemeIcon('warning', new vscode.ThemeColor('charts.red'));
      case 'done':
        return new vscode.ThemeIcon('check', new vscode.ThemeColor('charts.green'));
      case 'idle':
      default:
        return new vscode.ThemeIcon('circle-outline');
    }
  }
}
```

### 3. Add Attach Command

In `extension.ts`:

```typescript
// Register attach command
const attachCmd = vscode.commands.registerCommand('lumi-ops.attach', async (item: ShadowItem) => {
  if (!item.status?.session) {
    vscode.window.showWarningMessage('No active tmux session for this clone');
    return;
  }
  
  const terminal = vscode.window.createTerminal({
    name: `🤖 ${item.status.session}`,
    shellPath: '/bin/zsh',
    shellArgs: ['-c', `tmux attach -t ${item.status.session}`]
  });
  
  terminal.show();
});

context.subscriptions.push(attachCmd);
```

### 4. Add Polling for Live Updates

In `extension.ts`:

```typescript
// Poll every 5 seconds for status updates
const pollInterval = setInterval(() => {
  shadowTreeProvider.refresh();
}, 5000);

// Clean up on deactivate
context.subscriptions.push({
  dispose: () => clearInterval(pollInterval)
});
```

### 5. Update package.json

Add command contribution:

```json
{
  "contributes": {
    "commands": [
      {
        "command": "lumi-ops.attach",
        "title": "Attach to Agent",
        "icon": "$(terminal)"
      }
    ],
    "menus": {
      "view/item/context": [
        {
          "command": "lumi-ops.attach",
          "when": "viewItem == activeAgent",
          "group": "inline"
        }
      ]
    }
  }
}
```

### 6. Add Kill Command (Optional Enhancement)

```typescript
const killCmd = vscode.commands.registerCommand('lumi-ops.kill', async (item: ShadowItem) => {
  if (!item.status?.session) {
    vscode.window.showWarningMessage('No active session to kill');
    return;
  }
  
  const confirm = await vscode.window.showWarningMessage(
    `Kill agent session "${item.status.session}"?`,
    { modal: true },
    'Kill'
  );
  
  if (confirm === 'Kill') {
    try {
      execSync(`tmux kill-session -t ${item.status.session}`);
      
      // Update status file
      const statusPath = path.join(item.clone.path, '.lumi-status.json');
      await fs.writeJson(statusPath, { ...item.status, status: 'idle', message: 'Session terminated' });
      
      shadowTreeProvider.refresh();
      vscode.window.showInformationMessage(`Killed session: ${item.status.session}`);
    } catch (e) {
      vscode.window.showErrorMessage(`Failed to kill session: ${e}`);
    }
  }
});
```

---

## ✅ Verification Checklist

- [ ] Sidebar shows status icons for worktrees with `.lumi-status.json`
- [ ] Spinning icon appears for `status: 'coding'`
- [ ] Warning icon appears for `status: 'blocked'`
- [ ] Check icon appears for `status: 'done'`
- [ ] Right-click on active agent shows "Attach to Agent" menu
- [ ] Clicking "Attach" opens integrated terminal with tmux session
- [ ] Dashboard auto-refreshes every 5 seconds
- [ ] Tooltips show detailed status information

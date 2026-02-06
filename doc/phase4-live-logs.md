# Phase 4: Live Agent Logs (Observability)

## 🎯 Goal
Allow users to see the agent's "thought process" directly from VS Code without needing to attach to the tmux terminal. This improves observability and reduces context-switching.

---

## 📂 Files to Modify

| File | Action |
|------|--------|
| `packages/extension/src/ShadowTreeProvider.ts` | **MODIFY** - Add log reading utility |
| `packages/extension/src/extension.ts` | **MODIFY** - Register showLogs command |
| `packages/extension/package.json` | **MODIFY** - Add command contribution |

---

## 📋 Step-by-Step Implementation

### Step 1: Add Log Reading Utility to ShadowTreeProvider

In `ShadowTreeProvider.ts`, add a utility function to read log snippets:

```typescript
import * as fs from 'fs';
import * as path from 'path';

// Add this helper function inside the class or as a module function
function getLogSnippet(worktreePath: string, lines: number = 50): string | null {
  const logPath = path.join(worktreePath, 'agent.log');
  
  try {
    if (!fs.existsSync(logPath)) {
      return null;
    }
    
    const content = fs.readFileSync(logPath, 'utf-8');
    const allLines = content.split('\n');
    const lastLines = allLines.slice(-lines).join('\n');
    
    return lastLines || null;
  } catch (e) {
    return null;
  }
}
```

### Step 2: Enhance ShadowItem Tooltip with Log Preview

Update the `ShadowItem` class to include log snippets in the tooltip:

```typescript
class ShadowItem extends vscode.TreeItem {
  public readonly logPath: string;
  
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly clone: ShadowClone,
    public readonly status?: LumiStatus
  ) {
    super(label, collapsibleState);
    
    this.logPath = path.join(clone.path, 'agent.log');
    this.tooltip = this.getTooltip();
    // ... rest of constructor
  }
  
  private getTooltip(): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.isTrusted = true;
    
    // Basic info
    md.appendMarkdown(`**Path:** \`${this.clone.path}\`\n\n`);
    
    if (this.status) {
      md.appendMarkdown(`**Status:** ${this.status.status}\n\n`);
      md.appendMarkdown(`**Message:** ${this.status.message}\n\n`);
      if (this.status.session) {
        md.appendMarkdown(`**Session:** \`${this.status.session}\`\n\n`);
      }
    }
    
    // Log preview (last 10 lines for tooltip)
    const logSnippet = getLogSnippet(this.clone.path, 10);
    if (logSnippet) {
      md.appendMarkdown(`---\n**Recent Log:**\n\`\`\`\n${logSnippet}\n\`\`\``);
    }
    
    return md;
  }
}
```

### Step 3: Register showLogs Command

In `extension.ts`, add the command to view full logs:

```typescript
// -- Show Agent Logs Command --
context.subscriptions.push(
  vscode.commands.registerCommand('lumi-ops.showLogs', async (item: ShadowItem) => {
    const logPath = path.join(item.clone.path, 'agent.log');
    
    // Check if log file exists
    if (!fs.existsSync(logPath)) {
      vscode.window.showWarningMessage(`No agent.log found for ${item.label}`);
      return;
    }
    
    // Option 1: Open as read-only document
    const uri = vscode.Uri.file(logPath);
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, {
      preview: true,
      preserveFocus: false
    });
    
    // Optional: Create auto-refreshing OutputChannel instead
    // const channel = vscode.window.createOutputChannel(`Agent: ${item.label}`);
    // channel.append(fs.readFileSync(logPath, 'utf-8'));
    // channel.show();
  })
);
```

### Step 4: Add Output Channel Alternative (Optional Enhancement)

For live-updating logs, use an OutputChannel with file watching:

```typescript
// Store active log watchers
const logWatchers = new Map<string, fs.FSWatcher>();

context.subscriptions.push(
  vscode.commands.registerCommand('lumi-ops.watchLogs', async (item: ShadowItem) => {
    const logPath = path.join(item.clone.path, 'agent.log');
    const channelName = `🤖 ${item.label}`;
    
    // Create or reuse output channel
    const channel = vscode.window.createOutputChannel(channelName);
    channel.show();
    
    // Initial content
    if (fs.existsSync(logPath)) {
      channel.append(fs.readFileSync(logPath, 'utf-8'));
    }
    
    // Watch for changes
    if (logWatchers.has(logPath)) {
      logWatchers.get(logPath)?.close();
    }
    
    const watcher = fs.watch(logPath, (event) => {
      if (event === 'change') {
        // Re-read and update (simple approach)
        channel.clear();
        channel.append(fs.readFileSync(logPath, 'utf-8'));
      }
    });
    
    logWatchers.set(logPath, watcher);
    
    // Cleanup on channel dispose
    channel.onDidChangeLogLevel(() => {
      watcher.close();
      logWatchers.delete(logPath);
    });
  })
);
```

### Step 5: Update package.json

Add command contributions:

```json
{
  "contributes": {
    "commands": [
      {
        "command": "lumi-ops.showLogs",
        "title": "View Agent Logs",
        "icon": "$(output)"
      },
      {
        "command": "lumi-ops.watchLogs",
        "title": "Watch Agent Logs (Live)",
        "icon": "$(eye)"
      }
    ],
    "menus": {
      "view/item/context": [
        {
          "command": "lumi-ops.showLogs",
          "when": "view == lumi-ops.activeClones",
          "group": "navigation@0"
        },
        {
          "command": "lumi-ops.watchLogs",
          "when": "view == lumi-ops.activeClones && viewItem == activeAgent",
          "group": "navigation@1"
        }
      ]
    }
  }
}
```

---

## ✅ Verification Checklist

- [ ] Hovering over a tree item shows log preview in tooltip
- [ ] Right-click menu shows "View Agent Logs" option
- [ ] Clicking "View Agent Logs" opens the log file in editor
- [ ] (Optional) "Watch Agent Logs" opens OutputChannel with live updates
- [ ] No errors when `agent.log` doesn't exist
- [ ] Log content displays correctly with proper formatting

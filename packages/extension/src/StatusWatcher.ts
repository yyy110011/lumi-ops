import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { LumiStatus } from './ShadowTreeProvider';

interface AgentState {
  path: string;
  branch: string;
  lastStatus: string;
}

/**
 * Watches agent status files for "blocked" state transitions.
 * When an agent becomes blocked, triggers a callback so the extension
 * can notify the user and offer intervention.
 */
export class StatusWatcher {
  private watchers: Map<string, fs.FSWatcher> = new Map();
  private agentStates: Map<string, AgentState> = new Map();
  
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
    try {
      const dirWatcher = fs.watch(shadowDir, (event, filename) => {
        if (filename) {
          this.scanAndWatch(shadowDir);
        }
      });
      
      this.watchers.set(shadowDir, dirWatcher);
    } catch (e) {
      console.error('Failed to watch shadow-clones directory:', e);
    }
  }
  
  private scanAndWatch(shadowDir: string): void {
    let branches: string[];
    
    try {
      branches = fs.readdirSync(shadowDir);
    } catch (e) {
      return;
    }
    
    for (const branch of branches) {
      const branchPath = path.join(shadowDir, branch);
      const statusPath = path.join(branchPath, '.lumi-status.json');
      
      // Skip if not a directory
      try {
        if (!fs.statSync(branchPath).isDirectory()) continue;
      } catch (e) {
        continue;
      }
      
      // Skip if already watching
      if (this.watchers.has(statusPath)) continue;
      
      // Initialize state
      this.agentStates.set(branch, {
        path: branchPath,
        branch,
        lastStatus: this.readStatus(statusPath)?.status || 'unknown'
      });
      
      // Watch status file if it exists
      if (fs.existsSync(statusPath)) {
        this.watchStatusFile(branch, statusPath, branchPath);
      }
    }
  }
  
  private watchStatusFile(branch: string, statusPath: string, branchPath: string): void {
    try {
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
    } catch (e) {
      console.error(`Failed to watch status file for ${branch}:`, e);
    }
  }
  
  private readStatus(statusPath: string): LumiStatus | null {
    try {
      if (fs.existsSync(statusPath)) {
        return JSON.parse(fs.readFileSync(statusPath, 'utf-8'));
      }
    } catch (e) {
      // Ignore parse errors
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

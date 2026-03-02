import * as vscode from 'vscode';

/**
 * Centralized event bus for worktree / review-status changes.
 *
 * Primarily driven by `fs.watch` on metadata files for cross-window sync.
 * All subscribers (sidebar, Worktree Manager, prompt library) listen to
 * this bus to re-read the latest state from disk.
 */
export class StatusEventBus {
  private readonly _emitter = new vscode.EventEmitter<string>();

  /** Subscribe to status changes. Returns a Disposable. */
  readonly onDidChange: vscode.Event<string> = this._emitter.event;

  /** Fire a change event. Pass branch name or '*' for broad refresh. */
  fire(branch: string = '*'): void {
    this._emitter.fire(branch);
  }

  dispose(): void {
    this._emitter.dispose();
  }
}

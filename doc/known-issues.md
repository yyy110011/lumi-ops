# Known Issues

## 1. Symlink Root Path — "Return to Root" Opens New Window

**Status:** Open
**Severity:** Minor (UX)
**Since:** v0.3.x

### Description

When the user opens a project via a **symlinked path** (e.g. `~/projects/my-app` → `/real/path/to/my-app`), spawning a shadow clone and then clicking the "Return to Root" (home) button opens a **new window** instead of refocusing the existing one.

### Root Cause

`returnToRoot` uses `vscode.openFolder()` with the **real (resolved) path**, but the original window was opened with the **symlink path**. VS Code treats these as different folders and opens a new window.

### Workaround

Manually switch back to the original window.

### Potential Fix

Store the **original workspace path** (as provided by `vscode.workspace.workspaceFolders`) instead of the resolved real path, and use that for `returnToRoot`. Alternatively, detect if the original path is a symlink and preserve it throughout the extension lifecycle.

### References

- Related past fix: symlink resolution in `ShadowTreeProvider` (v0.3.1)

---
description: Step-by-step guide to add a new VS Code extension command
---
1. Define command in `packages/extension/package.json` → `contributes.commands` array
2. Add menu binding in `contributes.menus` if the command needs to appear in context menus or title bars
3. Register handler in `packages/extension/src/extension.ts` via `vscode.commands.registerCommand()`
4. If the command needs a new config setting, add it in `contributes.configuration.properties`
// turbo
5. Build Extension: `cd /Users/ryan/project_in_progress/lumi-ops/packages/extension && npm run package`
6. Test: Press F5 in VS Code to launch Extension Development Host and verify the command works

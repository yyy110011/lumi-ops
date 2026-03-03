---
description: Package extension as VSIX for local testing (CI handles actual publishing via git tag)
---
> NOTE: This workflow is for local VSIX packaging only. 
> Actual publishing to Marketplace is handled by CI when you push a git tag (e.g. `git tag v0.3.10 && git push origin v0.3.10`).
> Do NOT manually bump version in package.json — CI handles this.

// turbo-all
1. Build CLI (dependency): `cd /Users/ryan/project_in_progress/lumi-ops/packages/cli && npm run build`
2. Package Extension as VSIX: `cd /Users/ryan/project_in_progress/lumi-ops/packages/extension && npx @vscode/vsce package --no-dependencies`
3. Verify VSIX was created: `ls -la /Users/ryan/project_in_progress/lumi-ops/packages/extension/*.vsix`

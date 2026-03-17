import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as path from 'path';
import * as fs from 'fs';
import { GitUtils, parseWorktrees } from '@lumi-ops/cli';
import type { ShadowClone } from '@lumi-ops/cli';
import { extractTitle } from './utils.js';
import { serverState, ensureRootDir, readMetadata, promptDir, listPromptFiles } from './state.js';

// ---------------------------------------------------------------------------
// Helpers (module-private)
// ---------------------------------------------------------------------------



/** Helper to read a .lumi/ file from a clone's worktree. */
async function readCloneLumiFile(branch: string, filename: string) {
  const git = new GitUtils(serverState.rootDir);
  const rawEntries = await git.listWorktrees();
  const clones = parseWorktrees(rawEntries, serverState.rootDir);
  const decodedBranch = decodeURIComponent(branch);
  const clone = clones.find(c => c.branch === decodedBranch);
  if (!clone) {
    return { contents: [{ uri: `lumi://clones/${branch}/${filename}`, text: `Error: no worktree found for branch "${decodedBranch}".` }] };
  }
  try {
    const content = await fs.promises.readFile(path.join(clone.path, '.lumi', filename), 'utf-8');
    return { contents: [{ uri: `lumi://clones/${branch}/${filename}`, text: content }] };
  } catch {
    return { contents: [{ uri: `lumi://clones/${branch}/${filename}`, text: `File not found: .lumi/${filename}` }] };
  }
}

/** Helper to list clones that have a specific .lumi/ file. */
async function listClonesWithLumiFile(filename: string, resourceSuffix: string) {
  const git = new GitUtils(serverState.rootDir);
  const rawEntries = await git.listWorktrees();
  const clones = parseWorktrees(rawEntries, serverState.rootDir);
  return {
    resources: clones
      .filter(c => c.isShadow && fs.existsSync(path.join(c.path, '.lumi', filename)))
      .map(c => ({
        uri: `lumi://clones/${encodeURIComponent(c.branch)}/${resourceSuffix}`,
        name: `${c.branch} — ${filename}`,
      })),
  };
}

// ---------------------------------------------------------------------------
// Register all MCP Resources
// ---------------------------------------------------------------------------

export function registerResources(server: McpServer, version: string): void {

  // ---------------------------------------------------------------------------
  // Resource 1: lumi://clones (Clone List)
  // ---------------------------------------------------------------------------

  server.resource('clone-list', 'lumi://clones', async (uri) => {
    const rootErr = ensureRootDir();
    if (rootErr) {
      return { contents: [{ uri: uri.href, text: JSON.stringify({ error: 'No project root configured. Use set_project_root first.' }) }] };
    }
    try {
      const git = new GitUtils(serverState.rootDir);
      const rawEntries = await git.listWorktrees();
      const clones = parseWorktrees(rawEntries, serverState.rootDir);
      const metadata = await readMetadata();

      // Enrich clones with metadata + hasReport (slim: title instead of full description)
      const enriched = clones.map((c) => {
        const meta = metadata[c.dirName];
        const hasReport = fs.existsSync(path.join(c.path, '.lumi', 'MISSION_COMPLETE.md'));
        const base: ShadowClone & { hasReport: boolean; title: string } = {
          ...c,
          hasReport,
          title: extractTitle(meta?.description),
        };
        if (meta) {
          return {
            ...base,
            baseBranch: meta.baseBranch || c.baseBranch,
            reviewStatus: meta.reviewStatus,
          };
        }
        return base;
      });

      return {
        contents: [{ uri: uri.href, text: JSON.stringify({ repository: serverState.rootDir, clones: enriched }, null, 2) }],
      };
    } catch (error: any) {
      return {
        contents: [{ uri: uri.href, text: JSON.stringify({ error: `Error listing clones: ${error.message}` }) }],
      };
    }
  });

  // ---------------------------------------------------------------------------
  // Resource 2-4: Per-clone file Resources
  // ---------------------------------------------------------------------------

  server.resource(
    'clone-mission',
    new ResourceTemplate('lumi://clones/{branch}/mission', {
      list: async () => listClonesWithLumiFile('MISSION.md', 'mission'),
    }),
    async (uri, { branch }) => readCloneLumiFile(branch as string, 'MISSION.md'),
  );

  server.resource(
    'clone-report',
    new ResourceTemplate('lumi://clones/{branch}/report', {
      list: async () => listClonesWithLumiFile('MISSION_COMPLETE.md', 'report'),
    }),
    async (uri, { branch }) => readCloneLumiFile(branch as string, 'MISSION_COMPLETE.md'),
  );

  server.resource(
    'clone-feedback',
    new ResourceTemplate('lumi://clones/{branch}/feedback', {
      list: async () => listClonesWithLumiFile('REVIEW_FEEDBACK.md', 'feedback'),
    }),
    async (uri, { branch }) => readCloneLumiFile(branch as string, 'REVIEW_FEEDBACK.md'),
  );

  // ---------------------------------------------------------------------------
  // Resource 5: lumi://prompts/{scope}/{name} (Prompt Content)
  // ---------------------------------------------------------------------------

  server.resource(
    'prompt-content',
    new ResourceTemplate('lumi://prompts/{scope}/{name}', {
      list: async () => {
        const resources: { uri: string; name: string }[] = [];
        for (const scope of ['global', 'project'] as const) {
          const dir = promptDir(scope);
          const files = await listPromptFiles(dir);
          for (const f of files) {
            const name = f.replace(/\.md$/, '');
            resources.push({
              uri: `lumi://prompts/${scope}/${encodeURIComponent(name)}`,
              name: `[${scope}] ${name}`,
            });
          }
          // Also list _generated/ prompts
          const genDir = path.join(dir, '_generated');
          const genFiles = await listPromptFiles(genDir);
          for (const f of genFiles) {
            const name = f.replace(/\.md$/, '');
            resources.push({
              uri: `lumi://prompts/${scope}/${encodeURIComponent('_generated/' + name)}`,
              name: `[${scope}] _generated/${name}`,
            });
          }
        }
        return { resources };
      },
    }),
    async (uri, { scope, name }) => {
      if (scope !== 'global' && scope !== 'project') {
        return {
          contents: [{
            uri: uri.href,
            text: `Error: invalid scope "${scope}". Must be "global" or "project".`,
          }],
        };
      }
      const decodedName = decodeURIComponent(name as string);
      const filePath = path.join(promptDir(scope), `${decodedName}.md`);
      try {
        const content = await fs.promises.readFile(filePath, 'utf-8');
        return {
          contents: [{
            uri: uri.href,
            text: content,
          }],
        };
      } catch {
        return {
          contents: [{
            uri: uri.href,
            text: `Error: prompt "${decodedName}" not found in ${scope} scope.`,
          }],
        };
      }
    },
  );

  // ---------------------------------------------------------------------------
  // Resource 6: lumi://config (Config)
  // ---------------------------------------------------------------------------

  server.resource('config', 'lumi://config', async (uri) => {
    return {
      contents: [{
        uri: uri.href,
        text: JSON.stringify({
          rootDir: serverState.rootDir,
          rootDetectionMethod: serverState.rootDetectionMethod,
          version,
        }, null, 2),
      }],
    };
  });
}

/**
 * Prompt and project management tools: list_prompts, save_prompt,
 * set_project_root, list_repos.
 * Extracted from index.ts — logic preserved exactly.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import * as path from 'path';
import * as fs from 'fs';
import { getLumiOpsHome } from '@lumi-ops/cli';
import { toKebabCase } from '../utils.js';
import { resolveMainRepoRoot } from '../utils.js';
import { serverState, promptDir, listPromptFiles } from '../state.js';

export function registerPromptOpsTools(server: McpServer): void {
  // ---------------------------------------------------------------------------
  // Tool 1: list_prompts
  // ---------------------------------------------------------------------------

  server.tool(
    'list_prompts',
    'List available prompts from global and/or project scope. Use before spawn_clone to discover reusable task prompts. Pairs with save_prompt for creating new prompts and spawn_clone\'s `prompt` param to attach one during spawn.',
    {
      scope: z
        .enum(['global', 'project', 'all'])
        .default('all')
        .describe('Which scope to list prompts from'),
    },
    { readOnlyHint: true },
    async ({ scope }) => {
      const prompts: { name: string; scope: string; fileName: string; generated: boolean }[] = [];

      const collectFromScope = async (s: 'global' | 'project') => {
        const dir = promptDir(s);
        // Collect top-level prompts
        const files = await listPromptFiles(dir);
        for (const f of files) {
          prompts.push({ name: f.replace(/\.md$/, ''), scope: s, fileName: f, generated: false });
        }
        // Collect _generated/ prompts
        const genDir = path.join(dir, '_generated');
        const genFiles = await listPromptFiles(genDir);
        for (const f of genFiles) {
          prompts.push({ name: f.replace(/\.md$/, ''), scope: s, fileName: `_generated/${f}`, generated: true });
        }
      };

      if (scope === 'all' || scope === 'global') await collectFromScope('global');
      if (scope === 'all' || scope === 'project') await collectFromScope('project');

      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ prompts }, null, 2) }],
      };
    },
  );

  // ---------------------------------------------------------------------------
  // Tool 2: save_prompt
  // ---------------------------------------------------------------------------

  server.tool(
    'save_prompt',
    'Create or overwrite a prompt file. Use to persist reusable task descriptions that can be attached to clones via spawn_clone\'s `prompt` param. Set `generated: true` for agent-authored prompts — these are saved to `_generated/` and auto-cleaned when the clone is killed.',
    {
      name: z.string().describe('Prompt name (without .md extension)'),
      content: z.string().describe('Markdown content of the prompt'),
      scope: z
        .enum(['global', 'project'])
        .default('project')
        .describe('Scope to save the prompt in'),
      generated: z
        .boolean()
        .default(false)
        .optional()
        .describe('If true, save to _generated/ subdirectory (agent-authored, auto-cleaned on kill)'),
    },
    { idempotentHint: true },
    async ({ name, content, scope, generated }) => {
      const sanitized = toKebabCase(name);
      if (!sanitized) {
        return {
          content: [{ type: 'text' as const, text: 'Error: invalid prompt name after sanitization.' }],
          isError: true,
        };
      }

      const baseDir = promptDir(scope);
      const dir = generated ? path.join(baseDir, '_generated') : baseDir;
      await fs.promises.mkdir(dir, { recursive: true });
      const filePath = path.join(dir, `${sanitized}.md`);
      await fs.promises.writeFile(filePath, content);

      const fileName = generated ? `_generated/${sanitized}.md` : `${sanitized}.md`;
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ fileName, scope, path: filePath, generated: !!generated }, null, 2),
          },
        ],
      };
    },
  );

  // ---------------------------------------------------------------------------
  // Tool 2b: set_project_root
  // ---------------------------------------------------------------------------

  server.tool(
    'set_project_root',
    'Set the Git project root directory for all lumi-ops operations. This is a recovery tool — call it when git operations fail or the server detected the wrong repository. Root is normally auto-detected via MCP Roots Protocol, LUMI_OPS_ROOT env var, or cwd.',
    {
      path: z.string().describe('Absolute path to the project root directory'),
    },
    { idempotentHint: true },
    async ({ path: newPath }) => {
      try {
        const resolved = resolveMainRepoRoot(newPath);
        serverState.rootDir = resolved;
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify({ status: 'ok', rootDir: resolved }, null, 2) },
          ],
        };
      } catch {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error: '${newPath}' is not a valid git repository. Please provide a path inside a git repo.`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ---------------------------------------------------------------------------
  // Tool 11: list_repos
  // ---------------------------------------------------------------------------

  server.tool(
    'list_repos',
    'List all Git repositories registered with Lumi-Ops. Returns repo names and root paths from the global registry. Use this to discover available repositories before calling set_project_root to switch context.',
    { readOnlyHint: true },
    async () => {
      try {
        const registryPath = path.join(getLumiOpsHome(), '.registry.json');
        let registry: Record<string, string> = {};
        try {
          const raw = await fs.promises.readFile(registryPath, 'utf-8');
          registry = JSON.parse(raw);
        } catch {
          // Registry doesn't exist or is invalid — return empty list
        }

        const repos = Object.entries(registry).map(([name, repoPath]) => ({
          name,
          path: repoPath,
          isCurrent: repoPath === serverState.rootDir,
        }));

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ currentRepo: serverState.rootDir, repos }, null, 2),
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [{ type: 'text' as const, text: `Error listing repos: ${error.message}` }],
          isError: true,
        };
      }
    },
  );
}

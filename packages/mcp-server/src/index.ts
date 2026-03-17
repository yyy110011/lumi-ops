declare const __VERSION__: string;

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { RootsListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';

import { serverState, detectRootDirFromCwd } from './state.js';
import { extractRootFromRootsResponse } from './utils.js';
import { registerCloneOpsTools } from './tools/clone-ops.js';
import { registerPromptOpsTools } from './tools/prompt-ops.js';
import { registerReviewOpsTools } from './tools/review-ops.js';
import { registerPrompts } from './prompts.js';
import { registerResources } from './resources.js';

// ---------------------------------------------------------------------------
// Initialise shared state
// ---------------------------------------------------------------------------

serverState.rootDir = process.env.LUMI_OPS_ROOT || detectRootDirFromCwd();
if (process.env.LUMI_OPS_ROOT) {
  serverState.rootDetectionMethod = 'env_var';
}

// ---------------------------------------------------------------------------
// Server Setup
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: 'lumi-ops',
  version: __VERSION__,
});

// ---------------------------------------------------------------------------
// Register all tools, resources, and prompts from modules
// ---------------------------------------------------------------------------

registerCloneOpsTools(server);
registerPromptOpsTools(server);
registerReviewOpsTools(server);
registerPrompts(server);
registerResources(server, __VERSION__);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

/**
 * Attempt to update rootDir from an MCP roots/list response.
 * Returns true if rootDir was updated.
 */
async function updateRootFromRoots(): Promise<boolean> {
  try {
    const result = await server.server.listRoots();
    const newRoot = extractRootFromRootsResponse(result.roots);
    if (newRoot) {
      serverState.rootDir = newRoot;
      serverState.rootDetectionMethod = 'roots_protocol';
      console.error(`[lumi-ops] Root updated via: roots protocol → ${serverState.rootDir}`);
      return true;
    }
  } catch {
    // Client doesn't support roots — that's fine, fall back silently
  }
  return false;
}

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Attempt to get workspace root from client via MCP roots protocol
  const clientCapabilities = server.server.getClientCapabilities();
  if (clientCapabilities?.roots) {
    const updated = await updateRootFromRoots();

    // Subscribe to dynamic root changes
    if (clientCapabilities.roots.listChanged) {
      server.server.setNotificationHandler(RootsListChangedNotificationSchema, async () => {
        await updateRootFromRoots();
      });
    }

    if (!updated) {
      console.error(`[lumi-ops] Root detected via: ${serverState.rootDetectionMethod} → ${serverState.rootDir}`);
    }
  } else {
    console.error(`[lumi-ops] Root detected via: ${serverState.rootDetectionMethod} → ${serverState.rootDir}`);
  }

  console.error('Lumi-Ops MCP server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

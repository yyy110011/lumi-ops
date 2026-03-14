import { describe, it, expect } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

/**
 * SDK Regression Test — Empty Annotations Bug
 *
 * The MCP SDK v1.27.1's `isZodRawShapeCompat()` treats empty `{}` as a valid
 * Zod raw shape. When `server.tool(name, desc, schema, {}, callback)` is called,
 * the SDK misidentifies `{}` as a second inputSchema, and the actual callback
 * function gets discarded. As a result, `_registeredTools[name].handler` ends
 * up being `{}` (an object) instead of the callback function.
 *
 * This test uses the REAL McpServer (no mocks) to verify that our tool
 * registration patterns produce valid function handlers.
 */

describe('SDK regression: empty annotations bug', () => {
  it('Pattern A — 4-arg (no annotations) should register a function handler', () => {
    const server = new McpServer({ name: 'test-a', version: '0.0.1' });

    server.tool(
      'test_tool_a',
      'A tool with no annotations',
      { input: z.string() },
      async () => ({ content: [{ type: 'text' as const, text: 'ok' }] }),
    );

    const registered = (server as any)._registeredTools['test_tool_a'];
    expect(registered).toBeDefined();
    expect(typeof registered.handler).toBe('function');
  });

  it('Pattern B — 5-arg with non-empty annotations should register a function handler', () => {
    const server = new McpServer({ name: 'test-b', version: '0.0.1' });

    server.tool(
      'test_tool_b',
      'A tool with real annotations',
      { input: z.string() },
      { readOnlyHint: true },
      async () => ({ content: [{ type: 'text' as const, text: 'ok' }] }),
    );

    const registered = (server as any)._registeredTools['test_tool_b'];
    expect(registered).toBeDefined();
    expect(typeof registered.handler).toBe('function');
  });

  it('Pattern C — 5-arg with EMPTY {} annotations should demonstrate the bug (handler is not a function)', () => {
    const server = new McpServer({ name: 'test-c', version: '0.0.1' });

    server.tool(
      'test_tool_c',
      'A tool with empty annotations',
      { input: z.string() },
      {},
      async () => ({ content: [{ type: 'text' as const, text: 'ok' }] }),
    );

    const registered = (server as any)._registeredTools['test_tool_c'];
    expect(registered).toBeDefined();

    // This is the bug: the handler should be a function, but the SDK assigned
    // `{}` to it instead. We assert this to document the known SDK behavior.
    // If the SDK ever fixes this, the assertion below will fail — at that point
    // we can safely update this test to expect 'function' and re-enable empty
    // annotations if desired.
    expect(typeof registered.handler).not.toBe('function');
    expect(typeof registered.handler).toBe('object');
  });

  it('our production pattern (4-arg, no annotations) should produce callable handlers', async () => {
    const server = new McpServer({ name: 'test-prod', version: '0.0.1' });

    // Register multiple tools using the exact pattern we use in production
    const toolNames = ['spawn_clone', 'kill_clone', 'list_clones', 'merge_clone'];
    for (const name of toolNames) {
      server.tool(
        name,
        `Description for ${name}`,
        { branch: z.string() },
        async () => ({ content: [{ type: 'text' as const, text: `${name} executed` }] }),
      );
    }

    // Verify ALL handlers are functions
    for (const name of toolNames) {
      const registered = (server as any)._registeredTools[name];
      expect(registered, `Tool "${name}" should be registered`).toBeDefined();
      expect(
        typeof registered.handler,
        `Tool "${name}" handler should be a function, got ${typeof registered.handler}`,
      ).toBe('function');
    }
  });
});

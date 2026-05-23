/**
 * Cross-transport parity for @expose'd methods.
 *
 * Codex review v1.29 follow-up: the original v1.29 work proved @expose
 * dispatch over POST /api/<kebab> (HTTP) and tools/call over the
 * streamable-HTTP transport. This test pins the third surface — STDIO
 * MCP — so a method tagged @expose still works when invoked by a
 * Claude Desktop-shaped client that spawned the photon as a subprocess.
 * If the dispatcher ever bypasses the @expose'd handler on stdio, this
 * test fires before the regression hits a real client.
 *
 * Skipped under CI=true unless RUN_E2E=1 (spawns a real photon process).
 */

import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const CLI = path.join(REPO, 'dist', 'cli.js');
const FIXTURE = path.join(REPO, 'examples', 'todo-app', 'todo-app.photon.ts');
const SKIP = process.env.CI === 'true' && process.env.RUN_E2E !== '1';

function findTool(tools: Array<{ name: string }>, base: string): string {
  const t = tools.find(
    (x) => x.name === base || x.name.endsWith('.' + base) || x.name.endsWith('/' + base)
  );
  if (!t) throw new Error(`tool ${base} not in catalog: ${tools.map((x) => x.name).join(', ')}`);
  return t.name;
}

describe.skipIf(SKIP)('cross-transport parity for @expose', () => {
  it('@expose public methods reach tools/call over stdio MCP', async () => {
    const transport = new StdioClientTransport({
      command: 'node',
      args: [CLI, 'mcp', '--transport', 'stdio', FIXTURE],
      env: process.env as Record<string, string>,
    });
    const client = new Client(
      { name: 'expose-stdio-parity', version: '1.0.0' },
      { capabilities: {} }
    );
    try {
      await client.connect(transport);
      const list = await client.listTools();

      // The four @expose public methods on the reference photon must all
      // appear in the MCP tool catalog (parity rule: @expose binds an
      // HTTP route AND keeps the method as an MCP tool).
      const names = list.tools.map((t) => t.name);
      for (const expected of ['addTask', 'listTasks', 'removeTask', 'search']) {
        expect(
          names.some(
            (n) => n === expected || n.endsWith('.' + expected) || n.endsWith('/' + expected)
          ),
          `${expected} should appear in stdio MCP tools/list`
        ).toBe(true);
      }

      // The HTTP route handler (`feed` carries @get /api/feed.rss) must
      // NOT bleed into the MCP surface — it's HTTP-only.
      expect(names.some((n) => n === 'feed' || n.endsWith('.feed') || n.endsWith('/feed'))).toBe(
        false
      );

      // tools/call against an @expose'd method runs the same handler the
      // HTTP /api/add-task path runs. Any divergence (e.g., the loader
      // re-routing only one transport) shows up as a structuredContent
      // mismatch versus the HTTP smoke in reference-photon-three-contexts.
      const result = await client.callTool({
        name: findTool(list.tools, 'addTask'),
        arguments: { title: 'cross-transport probe' },
      });
      const content = result.structuredContent as { id: string; title: string } | undefined;
      const fallback = Array.isArray(result.content)
        ? JSON.parse(((result.content[0] ?? {}) as { text?: string }).text ?? 'null')
        : null;
      const task = content ?? fallback;
      expect(task?.title).toBe('cross-transport probe');
    } finally {
      await client.close().catch(() => undefined);
    }
  }, 20_000);
});

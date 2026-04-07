#!/usr/bin/env npx tsx
/**
 * Minimal ping-pong MCP channel server.
 *
 * Declares claude/channel capability and pushes a channel notification
 * every time the "ping" tool is called. Also pushes a periodic heartbeat
 * every 10 seconds to test unsolicited push.
 *
 * Usage:
 *   Add to .mcp.json:
 *   {
 *     "mcpServers": {
 *       "ping-pong": {
 *         "command": "npx",
 *         "args": ["tsx", "tests/fixtures/ping-pong-channel.ts"]
 *       }
 *     }
 *   }
 *
 *   Then start Claude Code with:
 *   claude --dangerously-load-development-channels server:ping-pong
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

let counter = 0;

const server = new Server(
  { name: 'ping-pong', version: '1.0.0' },
  {
    capabilities: {
      tools: {},
      experimental: {
        'claude/channel': {},
      },
    },
    instructions:
      'Ping-pong test channel. Messages arrive as <channel source="ping-pong">. Use the pong tool to reply.',
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'ping',
      description: 'Send a ping — the server will push a pong back via channel notification',
      inputSchema: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'Optional message to echo back' },
        },
      },
    },
    {
      name: 'pong',
      description: 'Reply to a channel message',
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string' },
        },
        required: ['text'],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const args = (req.params.arguments ?? {}) as Record<string, unknown>;

  switch (req.params.name) {
    case 'ping': {
      counter++;
      const msg = (args.message as string) || 'pong';

      // Push a channel notification (this is what Claude Code sees as <channel>)
      server.notification({
        method: 'notifications/claude/channel',
        params: {
          content: `pong #${counter}: ${msg}`,
          meta: {
            source: 'ping-tool',
            counter: String(counter),
          },
        },
      });

      return { content: [{ type: 'text', text: `pinged! pong #${counter} sent via channel` }] };
    }

    case 'pong': {
      return { content: [{ type: 'text', text: `replied: ${args.text}` }] };
    }

    default:
      return {
        content: [{ type: 'text', text: `unknown tool: ${req.params.name}` }],
        isError: true,
      };
  }
});

await server.connect(new StdioServerTransport());

// Push a heartbeat every 30 seconds to test unsolicited channel push
setInterval(() => {
  counter++;
  server
    .notification({
      method: 'notifications/claude/channel',
      params: {
        content: `heartbeat #${counter}`,
        meta: {
          source: 'heartbeat',
          counter: String(counter),
        },
      },
    })
    .catch(() => {});
}, 30_000);

process.stderr.write('ping-pong channel: ready\n');

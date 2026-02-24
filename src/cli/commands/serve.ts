/**
 * Serve CLI Command
 *
 * Start local multi-tenant MCP hosting for development
 */

import type { Command } from 'commander';
import * as net from 'net';
import { getErrorMessage } from '../../shared/error-handler.js';
import { logger } from '../../shared/logger.js';
import { validateOrThrow, inRange, isPositive, isInteger } from '../../shared/validation.js';

// ══════════════════════════════════════════════════════════════════════════════
// PRIVATE HELPERS
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Check if a port is available
 */
function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close();
      resolve(true);
    });
    // Listen on all interfaces (same as http.createServer default)
    server.listen(port);
  });
}

/**
 * Find an available port starting from the given port
 */
async function findAvailablePort(startPort: number, maxAttempts: number = 10): Promise<number> {
  // Validate port range
  validateOrThrow(startPort, [
    inRange('start port', 1, 65535),
    isInteger('start port'),
    isPositive('start port'),
  ]);

  for (let i = 0; i < maxAttempts; i++) {
    const port = startPort + i;
    if (port > 65535) {
      throw new Error(`Port ${port} exceeds maximum port number (65535)`);
    }
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(
    `No available port found between ${startPort} and ${startPort + maxAttempts - 1}`
  );
}

/**
 * Register the `serve` command (multi-tenant MCP hosting)
 */
export function registerServeCommand(program: Command, defaultDir: string): void {
  program
    .command('serve', { hidden: true })
    .option('-p, --port <number>', 'Port to run on', '4000')
    .option('-d, --debug', 'Enable debug logging')
    .description('Start local multi-tenant MCP hosting for development')
    .action(async (options: any) => {
      try {
        const port = parseInt(options.port, 10);
        const availablePort = await findAvailablePort(port);

        if (availablePort !== port) {
          console.error(`⚠️  Port ${port} is in use, using ${availablePort} instead\n`);
        }

        // Import and start LocalServ
        const { createLocalServ, getTestToken } = await import('../../serv/local.js');
        const { serv, tenant, user } = createLocalServ({
          port: availablePort,
          baseUrl: `http://localhost:${availablePort}`,
          debug: options.debug,
        });

        // Get a test token
        const token = await getTestToken(serv, tenant, user);

        console.error(`
⚡ Photon Serve (Multi-tenant Development)

   URL:     http://localhost:${availablePort}
   Tenant:  ${tenant.slug} (${tenant.name})
   User:    ${user.email}

   Test Token:
   ${token}

   MCP Endpoint:
   http://localhost:${availablePort}/tenant/${tenant.slug}/mcp

   Well-Known:
   http://localhost:${availablePort}/.well-known/oauth-protected-resource

Press Ctrl+C to stop
`);

        // Simple HTTP server
        const http = await import('http');
        const server = http.createServer(async (req, res) => {
          const url = req.url || '/';
          const method = req.method || 'GET';
          const headers: Record<string, string> = {};
          for (const [key, value] of Object.entries(req.headers)) {
            if (typeof value === 'string') headers[key] = value;
          }

          // Read body if present
          let body = '';
          if (method === 'POST') {
            body = await new Promise((resolve) => {
              let data = '';
              req.on('data', (chunk) => (data += chunk));
              req.on('end', () => resolve(data));
            });
          }

          const result = await serv.handleRequest(method, url, headers, body);

          res.writeHead(result.status, result.headers);
          res.end(result.body);
        });

        server.listen(availablePort);

        // Handle shutdown
        const shutdown = async () => {
          console.error('\nShutting down Photon Serve...');
          await serv.shutdown();
          server.close();
          process.exit(0);
        };

        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);
      } catch (error) {
        logger.error(`Error: ${getErrorMessage(error)}`);
        process.exit(1);
      }
    });
}

/**
 * MCP CLI Command
 *
 * Run a .photon.ts file as an MCP server (the core Photon runtime command)
 */

import type { Command } from 'commander';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { SchemaExtractor, ConstructorParam } from '@portel/photon-core';
import {
  getErrorMessage,
  ExitCode,
  exitWithError,
  handleError,
} from '../../shared/error-handler.js';
import { LoggerOptions, normalizeLogLevel, logger } from '../../shared/logger.js';
import { createReadline, promptText } from '../../shared/cli-utils.js';
import { printError, printWarning, printInfo, printSuccess } from '../../cli-formatter.js';
import { printHeader } from '../../cli-formatter.js';
import { resolvePhotonPath } from '../../path-resolver.js';
import { getDefaultContext } from '../../context.js';
import { getBundledPhotonPath, DEFAULT_BUNDLED_PHOTONS } from '../../shared-utils.js';
import { toEnvVarName } from '../../shared/config-docs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ══════════════════════════════════════════════════════════════════════════════
// PRIVATE HELPERS
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Parse extended photon name format
 *
 * Supports:
 * - "rss-feed" → { name: "rss-feed" }
 * - "alice/custom-photons:rss-feed" → { name: "rss-feed", marketplaceSource: "alice/custom-photons" }
 *
 * Rule: colon splits only when left side contains `/` (a marketplace source)
 * and right side is a simple name (no `/`).
 */
export function parsePhotonSpec(spec: string): { name: string; marketplaceSource?: string } {
  const colonIndex = spec.indexOf(':');
  if (colonIndex > 0) {
    const left = spec.slice(0, colonIndex);
    const right = spec.slice(colonIndex + 1);
    // Left must contain `/` (marketplace source) and right must be a simple name
    if (left.includes('/') && right && !right.includes('/')) {
      return { name: right, marketplaceSource: left };
    }
  }
  return { name: spec };
}

/**
 * Resolve photon path - checks bundled first, then user directory
 */
async function resolvePhotonPathWithBundled(
  name: string,
  workingDir: string
): Promise<string | null> {
  const bundledPath = getBundledPhotonPath(name, __dirname);
  if (bundledPath) {
    return bundledPath;
  }
  return resolvePhotonPath(name, workingDir);
}

function getLogOptionsFromCommand(command: Command | null | undefined): LoggerOptions {
  const root = command?.parent?.opts?.() ?? {};
  try {
    const level = normalizeLogLevel(root.logLevel);
    return {
      level,
      json: Boolean(root.jsonLogs),
    };
  } catch (error) {
    handleError(error, { exitOnError: true });
    throw error;
  }
}

function cliHeading(title: string): void {
  console.log('');
  printHeader(title);
}

function cliSpacer(): void {
  console.log('');
}

function cliHint(message: string): void {
  printWarning(message);
}

/**
 * Get OS-specific MCP client config path
 */
function getConfigPath(): string {
  const platform = process.platform;
  const home = os.homedir();
  if (platform === 'darwin') {
    return path.join(home, 'Library/Application Support/Claude/claude_desktop_config.json');
  } else if (platform === 'win32') {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    return path.join(appData, 'Claude', 'claude_desktop_config.json');
  } else {
    return path.join(home, '.config/Claude/claude_desktop_config.json');
  }
}

function formatDefaultValue(value: any): string {
  if (typeof value === 'string') {
    if (value.includes('homedir()')) {
      return value.replace(
        /(?:path\.)?join\(homedir\(\),\s*['"]([^'"]+)['"]\)/g,
        (_, folderName) => {
          return path.join(os.homedir(), folderName);
        }
      );
    }
    if (value.includes('process.cwd()')) {
      return process.cwd();
    }
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return String(value);
}

async function extractConstructorParams(filePath: string): Promise<ConstructorParam[]> {
  try {
    const source = await fs.readFile(filePath, 'utf-8');
    const extractor = new SchemaExtractor();
    return extractor.extractConstructorParams(source);
  } catch (error) {
    printError(`Failed to extract constructor params: ${getErrorMessage(error)}`);
    return [];
  }
}

/**
 * Validate configuration for an MCP
 */
async function validateConfiguration(filePath: string, mcpName: string): Promise<void> {
  cliHeading(`🔍 Validating configuration for: ${mcpName}`);
  cliSpacer();

  const params = await extractConstructorParams(filePath);

  if (params.length === 0) {
    printSuccess('No configuration required for this MCP.');
    return;
  }

  let hasErrors = false;
  const results: Array<{ name: string; envVar: string; status: string; value?: string }> = [];

  for (const param of params) {
    const envVarName = toEnvVarName(mcpName, param.name);
    const envValue = process.env[envVarName];
    const isRequired = !param.isOptional && !param.hasDefault;

    if (isRequired && !envValue) {
      hasErrors = true;
      results.push({
        name: param.name,
        envVar: envVarName,
        status: '❌ Missing (required)',
      });
    } else if (envValue) {
      results.push({
        name: param.name,
        envVar: envVarName,
        status: '✅ Set',
        value: envValue.length > 20 ? `${envValue.substring(0, 17)}...` : envValue,
      });
    } else {
      results.push({
        name: param.name,
        envVar: envVarName,
        status: '⚪ Optional',
        value: param.hasDefault ? `default: ${formatDefaultValue(param.defaultValue)}` : undefined,
      });
    }
  }

  printHeader('Configuration status');
  results.forEach((r) => {
    printInfo(`  ${r.status} ${r.envVar}`);
    if (r.value) {
      printInfo(`     Value: ${r.value}`);
    }
  });
  cliSpacer();

  if (hasErrors) {
    exitWithError('Validation failed: Missing required environment variables', {
      exitCode: ExitCode.CONFIG_ERROR,
      suggestion: `Run 'photon mcp ${mcpName} --config' to see the configuration template`,
    });
  } else {
    printSuccess('Configuration valid!');
    cliHint(`Run: photon mcp ${mcpName}`);
  }
}

/**
 * Show configuration template for an MCP
 */
async function showConfigTemplate(
  filePath: string,
  mcpName: string,
  workingDir: string = getDefaultContext().baseDir
): Promise<void> {
  cliHeading(`📋 Configuration template for: ${mcpName}`);
  cliSpacer();

  const params = await extractConstructorParams(filePath);

  if (params.length === 0) {
    printSuccess('No configuration required for this MCP.');
    return;
  }

  printHeader('Environment variables');
  params.forEach((param) => {
    const envVarName = toEnvVarName(mcpName, param.name);
    const isRequired = !param.isOptional && !param.hasDefault;
    const status = isRequired ? '[REQUIRED]' : '[OPTIONAL]';

    printInfo(`  ${envVarName} ${status}`);
    printInfo(`    Type: ${param.type}`);
    if (param.hasDefault) {
      printInfo(`    Default: ${formatDefaultValue(param.defaultValue)}`);
    }
    cliSpacer();
  });

  printHeader('Claude Desktop configuration');

  const envExample: Record<string, string> = {};
  params.forEach((param) => {
    const envVarName = toEnvVarName(mcpName, param.name);
    if (!param.isOptional && !param.hasDefault) {
      envExample[envVarName] = `<your-${param.name}>`;
    }
  });

  if (process.env.PHOTON_DIR) {
    envExample.PHOTON_DIR = workingDir;
  }
  const config = {
    mcpServers: {
      [mcpName]: {
        command: 'npx',
        args: ['@portel/photon', 'mcp', mcpName],
        env: envExample,
      },
    },
  };

  console.log(JSON.stringify(config, null, 2));
  cliSpacer();
  cliHint(`Add this to: ${getConfigPath()}`);
  cliHint(`Validate with: photon mcp ${mcpName} --validate`);
}

// ══════════════════════════════════════════════════════════════════════════════
// COMMAND
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Register the mcp command
 *
 * MCP Runtime: run a .photon.ts file as MCP server
 */
export function registerMCPCommand(program: Command): void {
  program
    .command('mcp', { hidden: true })
    .argument('<name>', 'MCP name (without .photon.ts extension)')
    .description('Run a Photon as MCP server')
    .option('--dev', 'Enable development mode with hot reload')
    .option('--validate', 'Validate configuration without running server')
    .option('--config', 'Show configuration template and exit')
    .option('--transport <type>', 'Transport type: stdio (default) or sse', 'stdio')
    .option('--port <number>', 'Port for SSE transport (default: 3000)', '3000')
    .action(async (rawName: string, options: any, command: Command) => {
      try {
        // Parse extended name format (e.g., "alice/repo:rss-feed")
        const { name, marketplaceSource } = parsePhotonSpec(rawName);

        // Get working directory from global options
        const workingDir = getDefaultContext().baseDir;
        const logOptions = getLogOptionsFromCommand(command);

        // Resolve file path - check bundled photons first, then user directory
        let filePath = await resolvePhotonPathWithBundled(name, workingDir);

        // Auto-install from marketplace if not found locally
        let unresolvedPhoton: import('../../server.js').UnresolvedPhoton | undefined;

        if (!filePath) {
          const { MarketplaceManager } = await import('../../marketplace-manager.js');
          const manager = new MarketplaceManager();
          await manager.initialize();

          // If marketplace source given, add it (persistent, idempotent)
          if (marketplaceSource) {
            const { marketplace: addedMp, added } = await manager.add(marketplaceSource);
            if (added) {
              console.error(`Added marketplace: ${addedMp.name}`);
              await manager.updateMarketplaceCache(addedMp.name);
            }
          }

          // Check for conflicts (multiple sources)
          const conflict = await manager.checkConflict(name);

          if (conflict.sources.length === 0) {
            // Not found anywhere
            exitWithError(`MCP not found: ${name}`, {
              exitCode: ExitCode.NOT_FOUND,
              searchedIn: workingDir,
              suggestion: DEFAULT_BUNDLED_PHOTONS.includes(name)
                ? `'${name}' is a bundled photon but could not be found`
                : marketplaceSource
                  ? `Photon '${name}' not found in ${marketplaceSource}`
                  : "Use 'photon search <name>' to find it or 'photon marketplace add <source>' to add a marketplace",
            });
          } else if (conflict.sources.length === 1 || !conflict.hasConflict) {
            // Single source — auto-download
            const source = conflict.sources[0];
            console.error(`Installing ${name} from ${source.marketplace.name}...`);

            const result = await manager.fetchMCP(name);
            if (!result) {
              exitWithError(`Failed to download: ${name}`, {
                exitCode: ExitCode.ERROR,
                suggestion: 'Check your internet connection and marketplace configuration',
              });
            }

            // Write file + save metadata + download assets (canonical install path)
            const { photonPath: targetPath } = await manager.installPhoton(
              result,
              name,
              workingDir
            );

            console.error(`Installed ${name}`);
            filePath = targetPath;
          } else {
            // Multiple sources — defer to server for elicitation
            unresolvedPhoton = {
              name,
              workingDir,
              sources: conflict.sources,
              recommendation: conflict.recommendation,
            };
          }
        }

        // Handle --validate flag (requires resolved filePath)
        if (options.validate) {
          if (!filePath) {
            exitWithError(
              `Cannot validate: ${name} has multiple sources. Install it first with 'photon add ${name}'.`,
              {
                exitCode: ExitCode.CONFIG_ERROR,
              }
            );
          }
          await validateConfiguration(filePath, name);
          return;
        }

        // Handle --config flag
        if (options.config) {
          if (!filePath) {
            exitWithError(
              `Cannot show config: ${name} has multiple sources. Install it first with 'photon add ${name}'.`,
              {
                exitCode: ExitCode.CONFIG_ERROR,
              }
            );
          }
          await showConfigTemplate(filePath, name, workingDir);
          return;
        }

        // Validate transport option
        const transport = options.transport as 'stdio' | 'sse';
        if (transport !== 'stdio' && transport !== 'sse') {
          exitWithError(`Invalid transport: ${options.transport}`, {
            exitCode: ExitCode.INVALID_ARGUMENT,
            suggestion: 'Valid options: stdio, sse',
          });
        }

        // Set PHOTON_NAME for daemon broker pub/sub to work
        // This ensures channel messages go to the correct daemon socket
        process.env.PHOTON_NAME = name;

        const { PhotonServer } = await import('../../server.js');
        const { FileWatcher } = await import('../../watcher.js');

        // Start MCP server
        const server = new PhotonServer({
          filePath: filePath || '', // empty when unresolved — server handles it
          devMode: options.dev,
          transport,
          port: parseInt(options.port, 10),
          logOptions: { ...logOptions, scope: transport },
          unresolvedPhoton,
          workingDir,
        });

        // Handle shutdown signals
        const shutdown = async () => {
          console.error('\nShutting down...');
          await server.stop();
          process.exit(0);
        };

        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);

        // Start the server
        await server.start();

        // Start file watcher in dev mode (only if resolved)
        if (options.dev && filePath) {
          const watcher = new FileWatcher(server, filePath, server.createScopedLogger('watcher'));
          watcher.start();

          // Clean up watcher on shutdown
          process.on('SIGINT', async () => {
            await watcher.stop();
          });
          process.on('SIGTERM', async () => {
            await watcher.stop();
          });
        }
      } catch (error) {
        logger.error(`Error: ${getErrorMessage(error)}`);
        process.exit(1);
      }
    });
}

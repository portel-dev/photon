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
  isNodeError,
} from '../../shared/error-handler.js';
import { LoggerOptions, normalizeLogLevel, logger } from '../../shared/logger.js';
import { printError, printWarning, printInfo, printSuccess } from '../../cli-formatter.js';
import { printHeader } from '../../cli-formatter.js';
import { getDefaultContext, resolvePhotonFromAllSources } from '../../context.js';
import { getBundledPhotonPath, DEFAULT_BUNDLED_PHOTONS, detectRunner } from '../../shared-utils.js';
import { toEnvVarName } from '../../shared/config-docs.js';
import { DEFAULT_PHOTON_DIR } from '@portel/photon-core';

/**
 * Return a `PHOTON_DIR` value to persist in the generated MCP client config,
 * or `null` when the global default applies (and writing it would be noise).
 *
 * Claude/Cursor/other clients don't inherit the shell that ran `photon mcp
 * install`, so any non-default photon location has to be baked into the env
 * block. Otherwise the client spawns `photon mcp <name>` with no PHOTON_DIR,
 * resolves baseDir to `~/.photon`, and can't find a workspace-scaffolded photon.
 */
function resolveInstalledPhotonDir(workingDir: string, filePath: string): string | null {
  const resolvedWorking = path.resolve(workingDir);
  const resolvedHome = path.resolve(DEFAULT_PHOTON_DIR);
  if (resolvedWorking !== resolvedHome) return resolvedWorking;
  // workingDir is the global default but the file itself lives elsewhere —
  // e.g. a scaffold under ~/myproj/foo/foo.photon.ts that the resolver found
  // via an explicit path. Walk up from the file to find the nearest dir that
  // contains it so the client can spawn with the right baseDir.
  const resolvedFile = path.resolve(filePath);
  if (isBundledPhotonPath(resolvedFile)) {
    // Bundled photons live inside our package install (node_modules, npx cache,
    // global install). Treating that as PHOTON_DIR would point .data, cache,
    // and config at a read-only location. Skip — bundled photons run fine
    // against the default ~/.photon baseDir.
    return null;
  }
  if (!resolvedFile.startsWith(resolvedHome + path.sep) && resolvedFile !== resolvedHome) {
    // Walk up from the file looking for a workspace marker (.marketplace,
    // photon.config.json, or package.json). Stops at the file's parent if
    // nothing matches — better to land at the immediate dir than to write
    // PHOTON_DIR pointing at $HOME or /. Avoids the nested-photon trap
    // where dirname(`/repo/team/foo.photon.ts`) yields `/repo/team`
    // instead of the actual workspace root `/repo`.
    return findWorkspaceRoot(path.dirname(resolvedFile));
  }
  return null;
}

/**
 * Walk up from `start` looking for a directory that smells like a workspace
 * root: contains `.marketplace/`, `photon.config.json`, or `package.json`.
 * Falls back to `start` if no marker is found before reaching the filesystem
 * root or the user's home directory.
 */
function findWorkspaceRoot(start: string): string {
  const home = path.resolve(os.homedir());
  let current = start;
  while (true) {
    if (
      existsSyncSafe(path.join(current, '.marketplace')) ||
      existsSyncSafe(path.join(current, 'photon.config.json')) ||
      existsSyncSafe(path.join(current, 'package.json'))
    ) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current || parent === home || parent === path.dirname(home)) break;
    current = parent;
  }
  return start;
}

function existsSyncSafe(p: string): boolean {
  try {
    // Lazy import: keep the dep graph small for tests that mock `fs`.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('fs').existsSync(p);
  } catch {
    return false;
  }
}

/**
 * Heuristic: a photon path is "bundled" when it's served from inside our
 * package install — node_modules tree, npx cache, or globally-installed
 * photon dist. None of those should be persisted as PHOTON_DIR.
 */
function isBundledPhotonPath(absPath: string): boolean {
  const sep = path.sep;
  return (
    absPath.includes(`${sep}node_modules${sep}`) ||
    absPath.includes(`${sep}.npm${sep}_npx${sep}`) ||
    absPath.includes(`${sep}.bun${sep}install${sep}`) ||
    absPath.includes(`${sep}@portel${sep}photon${sep}`)
  );
}

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
 * Resolve photon path - checks bundled first, then all discovery sources
 * (local workspace > ~/.photon > null)
 */
async function resolvePhotonPathWithBundled(
  name: string,
  _workingDir: string
): Promise<string | null> {
  const bundledPath = getBundledPhotonPath(name, __dirname);
  if (bundledPath) {
    return bundledPath;
  }
  return resolvePhotonFromAllSources(name);
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
      docsAnchor: 'missing-environment-variables',
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

  // Persist PHOTON_DIR when the install originated from a non-default workspace
  // so the client can spawn `photon mcp <name>` against the right baseDir.
  // Relying on `process.env.PHOTON_DIR` here misses the case where cwd auto-
  // detected a workspace OR the user scaffolded a photon outside ~/.photon
  // without explicitly exporting the env var.
  const resolvedPhotonDir = resolveInstalledPhotonDir(workingDir, filePath);
  if (resolvedPhotonDir) {
    envExample.PHOTON_DIR = resolvedPhotonDir;
  }
  const config = {
    mcpServers: {
      [mcpName]: {
        command: detectRunner(),
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

export type SupportedClient = 'claude';

export const SUPPORTED_CLIENTS: SupportedClient[] = ['claude'];
const CLIENT_NAMES: Record<SupportedClient, string> = {
  claude: 'Claude Desktop',
};

/**
 * Register `<name>` in the target MCP client's config file.
 *
 * Reads the existing JSON config, merges the server entry under mcpServers,
 * writes atomically through a temp file, and preserves a `.bak` backup.
 * Creates the config from scratch if it doesn't exist yet.
 */
export async function installToClient(
  name: string,
  filePath: string,
  client: SupportedClient,
  workingDir: string
): Promise<void> {
  // The SupportedClient union is the source of truth — when it expands to
  // include `cursor` / `claude-code`, add per-client branching here.
  const configPath = getConfigPath();
  const clientName = CLIENT_NAMES[client];

  // Build the MCP server entry (same shape as showConfigTemplate emits)
  const params = await extractConstructorParams(filePath);
  const env: Record<string, string> = {};
  for (const param of params) {
    const envVarName = toEnvVarName(name, param.name);
    const defaultDisplay =
      param.defaultValue !== undefined
        ? formatDefaultValue(param.defaultValue)
        : `<your-${param.name}>`;
    env[envVarName] = defaultDisplay;
  }
  // See resolveInstalledPhotonDir above — we need to capture non-default
  // workspaces even when the shell running `install` didn't export PHOTON_DIR.
  const resolvedPhotonDir = resolveInstalledPhotonDir(workingDir, filePath);
  if (resolvedPhotonDir) {
    env.PHOTON_DIR = resolvedPhotonDir;
  }

  const serverEntry: Record<string, unknown> = {
    command: detectRunner(),
    args: ['@portel/photon', 'mcp', name],
    ...(Object.keys(env).length > 0 && { env }),
  };

  // Read existing config (if any) and merge
  let config: { mcpServers?: Record<string, unknown>; [key: string]: unknown } = {};
  let configExisted = false;
  try {
    const raw = await fs.readFile(configPath, 'utf-8');
    configExisted = true;
    try {
      config = JSON.parse(raw);
    } catch {
      exitWithError(`Cannot parse existing ${clientName} config as JSON`, {
        exitCode: ExitCode.CONFIG_ERROR,
        suggestion: `Fix the JSON at ${configPath} or move it aside and re-run install`,
      });
    }
    if (typeof config !== 'object' || config === null || Array.isArray(config)) {
      exitWithError(`Existing ${clientName} config is not a JSON object`, {
        exitCode: ExitCode.CONFIG_ERROR,
        suggestion: `Fix the JSON at ${configPath} or move it aside and re-run install`,
      });
    }
  } catch (err) {
    if (configExisted || !isNodeError(err, 'ENOENT')) {
      throw err;
    }
    // ENOENT — fresh config.
  }

  if (!config.mcpServers || typeof config.mcpServers !== 'object') {
    config.mcpServers = {};
  }
  const existing = config.mcpServers;
  const replaced = Object.prototype.hasOwnProperty.call(existing, name);
  existing[name] = serverEntry;

  // Ensure parent directory exists.
  await fs.mkdir(path.dirname(configPath), { recursive: true });

  // Backup existing config before rewriting.
  if (configExisted) {
    const backupPath = `${configPath}.bak`;
    try {
      await fs.copyFile(configPath, backupPath);
    } catch (err) {
      printWarning(`Could not write backup to ${backupPath}: ${getErrorMessage(err)}`);
    }
  }

  // Atomic write: temp file next to target, then rename.
  const tmpPath = `${configPath}.tmp-${process.pid}`;
  const payload = JSON.stringify(config, null, 2) + '\n';
  await fs.writeFile(tmpPath, payload, 'utf-8');
  await fs.rename(tmpPath, configPath);

  printSuccess(
    replaced
      ? `Updated '${name}' in ${clientName} at ${configPath}`
      : `Registered '${name}' in ${clientName} at ${configPath}`
  );
  if (configExisted) {
    printInfo(`Backup: ${configPath}.bak`);
  }
  printInfo(`Restart ${clientName} to pick up the change.`);
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
  const mcp = program
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
        const { announceContext } = await import('../../shared/announce-context.js');
        announceContext({ action: 'Serving MCP', photon: name, target: workingDir });

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
              docsAnchor: 'mcp-not-found-in-marketplace',
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

        // Run data migration (fast no-op if already done)
        try {
          const { runDataMigration } = await import('../../data-migration.js');
          await runDataMigration();
        } catch {
          // Non-critical
        }

        // Check for @channel tag — enables channel capabilities (e.g. @channel claude)
        let channelMode = false;
        let channelTargets: string[] = [];
        let channelInstructions: string | undefined;
        if (filePath) {
          try {
            const { PhotonDocExtractor } = await import('../../photon-doc-extractor.js');
            const extractor = new PhotonDocExtractor(filePath);
            const metadata = await extractor.extractFullMetadata();
            if (metadata.channel && metadata.channel.length > 0) {
              channelMode = true;
              channelTargets = metadata.channel;
              // Extract class-level JSDoc description for channel instructions
              // (metadata.description may pick up the first JSDoc in the file, not the class one)
              const source = await fs.readFile(filePath, 'utf-8');
              // Extract the JSDoc block immediately before the class declaration
              const allDocs = [...source.matchAll(/\/\*\*([\s\S]*?)\*\//g)];
              const classIdx = source.search(/(?:export\s+)?(?:default\s+)?class\s/);
              // Find the last JSDoc that ends before the class keyword
              const classDoc = allDocs
                .reverse()
                .find((m) => m.index !== undefined && m.index + m[0].length <= classIdx);
              if (classDoc) {
                const lines = classDoc[1]
                  .split('\n')
                  .map((l: string) => l.replace(/^\s*\*\s?/, '').trim())
                  .filter((l: string) => l && !l.startsWith('@') && !l.startsWith('#'));
                channelInstructions = lines.join(' ');
              }
              if (!channelInstructions) channelInstructions = metadata.description;
            }
          } catch {
            // Non-critical — proceed without channel mode
          }
        }

        // Start MCP server
        const server = new PhotonServer({
          filePath: filePath || '', // empty when unresolved — server handles it
          devMode: options.dev,
          transport,
          port: parseInt(options.port, 10),
          logOptions: { ...logOptions, scope: transport },
          unresolvedPhoton,
          workingDir,
          ...(channelMode
            ? {
                channelMode: true,
                channelName: path.basename(name).replace(/\.photon\.ts$/, ''),
                channelTargets,
                channelInstructions,
              }
            : {}),
        });

        // Handle shutdown signals
        let shuttingDown = false;
        const shutdown = async () => {
          if (shuttingDown) return;
          shuttingDown = true;
          console.error('\nShutting down...');
          // Hard exit if graceful shutdown takes too long
          const forceExit = setTimeout(() => process.exit(0), 3000);
          forceExit.unref();
          try {
            await server.stop();
          } catch {
            // Ignore cleanup errors
          }
          process.exit(0);
        };

        process.on('SIGINT', () => {
          void shutdown();
        });
        process.on('SIGTERM', () => {
          void shutdown();
        });

        // Start the server
        await server.start();

        // Start file watcher in dev mode (only if resolved)
        if (options.dev && filePath) {
          const watcher = new FileWatcher(server, filePath, server.createScopedLogger('watcher'));
          watcher.start();

          // Clean up watcher on shutdown
          process.on('SIGINT', () => {
            void watcher.stop();
          });
          process.on('SIGTERM', () => {
            void watcher.stop();
          });
        }
      } catch (error) {
        logger.error(`Error: ${getErrorMessage(error)}`);
        process.exit(1);
      }
    });

  // mcp install: register a photon in an MCP client's config (e.g. Claude Desktop)
  mcp
    .command('install')
    .argument('<name>', 'Photon name to register (without .photon.ts extension)')
    .description(
      `Register a photon in an MCP client's config (supported: ${SUPPORTED_CLIENTS.join(', ')})`
    )
    .option('--client <client>', `Target MCP client (${SUPPORTED_CLIENTS.join(', ')})`, 'claude')
    .action(async (name: string, options: { client?: string }) => {
      try {
        const client = (options.client ?? 'claude') as SupportedClient;
        if (!SUPPORTED_CLIENTS.includes(client)) {
          exitWithError(`Unsupported client: ${client}`, {
            exitCode: ExitCode.ERROR,
            suggestion: `Supported clients: ${SUPPORTED_CLIENTS.join(', ')}`,
          });
        }

        const workingDir = getDefaultContext().baseDir;
        const filePath = await resolvePhotonPathWithBundled(name, workingDir);

        if (!filePath) {
          exitWithError(`Photon '${name}' not found`, {
            exitCode: ExitCode.NOT_FOUND,
            searchedIn: workingDir,
            suggestion: `Create it first with: photon maker new ${name}\nOr install from a marketplace with: photon add ${name}`,
            docsAnchor: 'photon-not-found',
          });
        }

        await installToClient(name, filePath, client, workingDir);
      } catch (error) {
        logger.error(`Error: ${getErrorMessage(error)}`);
        process.exit(1);
      }
    });
}

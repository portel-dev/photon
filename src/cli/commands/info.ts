/**
 * Info CLI Command
 *
 * Show installed and available Photons with detailed information
 */

import type { Command } from 'commander';
import * as path from 'path';
import * as os from 'os';
import { getErrorMessage } from '../../shared/error-handler.js';
import { renderSection } from '../../shared/cli-sections.js';
import { toEnvVarName } from '../../shared/config-docs.js';
import { PHOTON_VERSION } from '../../version.js';
import { resolvePhotonPath, listPhotonMCPs } from '../../path-resolver.js';

// Helper to format default values for display
function formatDefaultValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  return JSON.stringify(value);
}

// Helper to extract constructor params from a photon file
async function extractConstructorParams(
  filePath: string
): Promise<Array<{ name: string; defaultValue?: unknown }>> {
  const fs = await import('fs/promises');
  const { SchemaExtractor } = await import('@portel/photon-core');
  const source = await fs.readFile(filePath, 'utf-8');
  const extractor = new SchemaExtractor();
  return extractor.extractConstructorParams(source);
}

// Helper to get global photon installation path
async function getGlobalPhotonPath(): Promise<string | null> {
  const { execSync } = await import('child_process');
  try {
    const npmRoot = execSync('npm root -g', { encoding: 'utf-8' }).trim();
    const photonBin = path.join(npmRoot, '@portel/photon/dist/cli.js');
    const { existsSync } = await import('fs');
    if (existsSync(photonBin)) {
      return `node ${photonBin}`;
    }
  } catch {
    // Ignore errors
  }
  return null;
}

// Helper to get OS-specific config path
function getConfigPath(): string {
  const platform = process.platform;
  const home = os.homedir();

  if (platform === 'darwin') {
    return path.join(home, 'Library/Application Support/Claude/claude_desktop_config.json');
  } else if (platform === 'win32') {
    // On Windows, use APPDATA if available, otherwise fall back to home/.config
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    return path.join(appData, 'Claude', 'claude_desktop_config.json');
  } else {
    return path.join(home, '.config', 'claude', 'claude_desktop_config.json');
  }
}

/**
 * Register info command
 */
export function registerInfoCommand(program: Command, defaultWorkingDir: string): void {
  program
    .command('info', { hidden: true })
    .argument('[name]', 'Photon name to show details for (shows all if omitted)')
    .option('--mcp', 'Output as MCP server configuration')
    .alias('list')
    .alias('ls')
    .description('Show installed and available Photons')
    .action(async (name: string | undefined, options: any, command: Command) => {
      try {
        const { formatOutput, printInfo, printError, printHeader, STATUS } =
          await import('../../cli-formatter.js');
        // Get working directory from global/parent options
        const parentOpts = command.parent?.opts() || {};
        const workingDir = parentOpts.dir || defaultWorkingDir;
        const asMcp = options.mcp || false;

        const mcps = await listPhotonMCPs(workingDir);

        // Initialize marketplace manager for all operations
        const { MarketplaceManager } = await import('../../marketplace-manager.js');
        const manager = new MarketplaceManager();
        await manager.initialize();

        // Show single Photon details
        if (name) {
          const filePath = await resolvePhotonPath(name, workingDir);
          const isInstalled = !!filePath;

          if (asMcp) {
            // MCP config only works for installed photons
            if (!isInstalled) {
              printError(`'${name}' is not installed`);
              printInfo(`Install with: photon add ${name}`);
              process.exit(1);
            }

            // Show as MCP config for single Photon
            const constructorParams = await extractConstructorParams(filePath);
            const env: Record<string, string> = {};
            for (const param of constructorParams) {
              const envVarName = toEnvVarName(name, param.name);
              const defaultDisplay =
                param.defaultValue !== undefined
                  ? formatDefaultValue(param.defaultValue)
                  : `<your-${param.name}>`;
              env[envVarName] = defaultDisplay;
            }

            // Check for global photon installation
            const globalPhotonPath = await getGlobalPhotonPath();
            const needsWorkingDir = workingDir !== defaultWorkingDir;

            const config = globalPhotonPath
              ? {
                  command: globalPhotonPath,
                  args: needsWorkingDir ? ['mcp', name, '--dir', workingDir] : ['mcp', name],
                  ...(Object.keys(env).length > 0 && { env }),
                }
              : {
                  command: 'npx',
                  args: needsWorkingDir
                    ? ['@portel/photon', 'mcp', name, '--dir', workingDir]
                    : ['@portel/photon', 'mcp', name],
                  ...(Object.keys(env).length > 0 && { env }),
                };

            // Get OS-specific config path
            const configPath = getConfigPath();
            console.log(`# Photon MCP Server Configuration: ${name}`);
            console.log(`# Add to mcpServers in: ${configPath}\n`);
            console.log(JSON.stringify({ [name]: config }, null, 2));
          } else {
            if (isInstalled) {
              const { PhotonDocExtractor } = await import('../../photon-doc-extractor.js');
              const extractor = new PhotonDocExtractor(filePath!);
              const photonMetadata = await extractor.extractFullMetadata();
              const fileName = `${name}.photon.ts`;
              const metadata = await manager.getPhotonInstallMetadata(fileName);
              const isModified = metadata
                ? await manager.isPhotonModified(filePath!, fileName)
                : false;

              const installDetails: string[] = [
                `Location: ${filePath}`,
                `Version: ${photonMetadata.version || PHOTON_VERSION}`,
                metadata ? `Source: ${metadata.marketplace}` : 'Source: local',
                metadata ? `Installed: ${new Date(metadata.installedAt).toLocaleString()}` : null,
                isModified ? 'Status: modified locally' : 'Status: clean',
              ].filter(Boolean) as string[];
              renderSection('Installation', installDetails);

              if (photonMetadata.description) {
                renderSection('Description', [photonMetadata.description]);
              }

              const tools = photonMetadata.tools || [];
              if (tools.length > 0) {
                console.log(`Tools: ${tools.length}`);
                renderSection(
                  'Methods',
                  tools.map((tool) => {
                    const desc = tool.description
                      ? tool.description.split(/\.(?:\s|$)|  |\n/)[0].trim()
                      : '';
                    return desc ? `${tool.name} — ${desc}` : tool.name;
                  })
                );
              }

              const usageLines =
                metadata && !isModified
                  ? [`photon mcp ${name}`, `Customize: photon mcp ${name} --dev`]
                  : [`photon mcp ${name} --dev`];
              renderSection('Usage', usageLines);
            } else {
              renderSection('Installation', [
                `Status: not installed in ${workingDir}`,
                `Install with: photon add ${name}`,
              ]);
            }

            // Show marketplace availability
            const searchResults = await manager.search(name);
            const sources = searchResults.get(name) || [];

            if (sources.length > 0) {
              const fileName = `${name}.photon.ts`;
              const installMetadata = await manager.getPhotonInstallMetadata(fileName);
              const marketplaceLines = sources.map((source) => {
                const version = source.metadata?.version || 'unknown';
                const mark =
                  installMetadata?.marketplace === source.marketplace.name ? ' (installed)' : '';
                return `${source.marketplace.name} · v${version}${mark}`;
              });
              renderSection('Marketplace sources', marketplaceLines);
            } else if (!isInstalled) {
              printError(`'${name}' not found locally or in any marketplace`);
              printInfo(`Tip: Use 'photon search <query>' to find similar MCPs`);
              process.exit(1);
            }
          }
          return;
        }

        // Show all Photons
        if (asMcp) {
          // MCP config mode for all Photons
          const allConfigs: Record<string, any> = {};

          // Check for global photon installation once
          const globalPhotonPath = await getGlobalPhotonPath();
          const needsWorkingDir = workingDir !== defaultWorkingDir;

          for (const mcpName of mcps) {
            const filePath = await resolvePhotonPath(mcpName, workingDir);
            if (!filePath) continue;

            const constructorParams = await extractConstructorParams(filePath);
            const env: Record<string, string> = {};
            for (const param of constructorParams) {
              const envVarName = toEnvVarName(mcpName, param.name);
              const defaultDisplay =
                param.defaultValue !== undefined
                  ? formatDefaultValue(param.defaultValue)
                  : `<your-${param.name}>`;
              env[envVarName] = defaultDisplay;
            }

            allConfigs[mcpName] = globalPhotonPath
              ? {
                  command: globalPhotonPath,
                  args: needsWorkingDir ? ['mcp', mcpName, '--dir', workingDir] : ['mcp', mcpName],
                  ...(Object.keys(env).length > 0 && { env }),
                }
              : {
                  command: 'npx',
                  args: needsWorkingDir
                    ? ['@portel/photon', 'mcp', mcpName, '--dir', workingDir]
                    : ['@portel/photon', 'mcp', mcpName],
                  ...(Object.keys(env).length > 0 && { env }),
                };
          }

          // Get OS-specific config path
          const configPath = getConfigPath();
          console.log(`# Photon MCP Server Configuration (${mcps.length} servers)`);
          console.log(`# Add to mcpServers in: ${configPath}\n`);
          console.log(JSON.stringify({ mcpServers: allConfigs }, null, 2));
          return;
        }

        // Normal list mode - show both installed and available

        // Show installed photons as table
        if (mcps.length > 0) {
          printHeader(`Installed · ${workingDir}`);

          const tableData: Array<{
            name: string;
            version: string;
            source: string;
            status: string;
          }> = [];

          for (const mcpName of mcps) {
            const fileName = `${mcpName}.photon.ts`;
            const filePath = path.join(workingDir, fileName);

            // Get installation metadata
            const metadata = await manager.getPhotonInstallMetadata(fileName);

            if (metadata) {
              // Has metadata - show version and status
              const isModified = await manager.isPhotonModified(filePath, fileName);
              tableData.push({
                name: mcpName,
                version: metadata.version,
                source: metadata.marketplace,
                status: isModified ? 'modified' : STATUS.OK,
              });
            } else {
              // No metadata - local or pre-metadata Photon
              tableData.push({
                name: mcpName,
                version: PHOTON_VERSION,
                source: 'local',
                status: STATUS.OK,
              });
            }
          }

          formatOutput(tableData, 'table');
          console.log('');
        } else {
          printHeader(`Installed · ${workingDir}`);
          printInfo('No photons installed');
          printInfo(`Install with: photon add <name>\n`);
        }

        // Show marketplace availability in tree format
        printHeader('Marketplace availability');

        const marketplaces = manager.getAll().filter((m) => m.enabled);
        const counts = await manager.getMarketplaceCounts();

        // Build marketplace tree
        const marketplaceTree: Record<string, any> = {};

        for (const marketplace of marketplaces) {
          const count = counts.get(marketplace.name) || 0;
          if (count > 0) {
            // Get a few sample photons from this marketplace
            const manifest = await (manager as any)['getCachedManifest'](marketplace.name);
            if (manifest && manifest.photons) {
              const samples = manifest.photons.slice(0, 3);
              const photonList: Record<string, string> = {};

              samples.forEach((photon: any) => {
                const installedMark = mcps.includes(photon.name) ? ' (installed)' : '';
                photonList[photon.name] = `v${photon.version}${installedMark}`;
              });

              if (count > 3) {
                photonList['...'] = `${count - 3} more`;
              }

              marketplaceTree[`${marketplace.name} (${marketplace.repo})`] = photonList;
            }
          } else {
            marketplaceTree[marketplace.name] = 'no manifest';
          }
        }

        formatOutput(marketplaceTree, 'tree');

        console.log('');
        printInfo(`Details: photon info <name>`);
        printInfo(`MCP config: photon info <name> --mcp`);
      } catch (error) {
        const { printError } = await import('../../cli-formatter.js');
        printError(getErrorMessage(error));
        process.exit(1);
      }
    });
}

/**
 * Doctor CLI Command
 *
 * Run diagnostics on the photon environment, ports, and per-photon configuration.
 */

import type { Command } from 'commander';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs/promises';
import * as net from 'net';
import { getErrorMessage } from '../../shared/error-handler.js';
import { toEnvVarName } from '../../shared/config-docs.js';
import { resolvePhotonPath, listPhotonMCPs } from '../../path-resolver.js';
import { getDefaultContext } from '../../context.js';

// ══════════════════════════════════════════════════════════════════════════════
// PRIVATE HELPERS
// ══════════════════════════════════════════════════════════════════════════════

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close();
      resolve(true);
    });
    server.listen(port);
  });
}

function formatDefaultValue(value: any): string {
  if (typeof value === 'string') {
    if (value.includes('homedir()')) {
      return value.replace(/(?:path\.)?join\(homedir\(\),\s*['"]([^'"]+)['"]\)/g, (_, folderName) =>
        path.join(os.homedir(), folderName)
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

async function extractConstructorParams(
  filePath: string
): Promise<
  Array<{ name: string; isOptional?: boolean; hasDefault?: boolean; defaultValue?: unknown }>
> {
  try {
    const source = await fs.readFile(filePath, 'utf-8');
    const { SchemaExtractor } = await import('@portel/photon-core');
    const extractor = new SchemaExtractor();
    return extractor.extractConstructorParams(source);
  } catch {
    return [];
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// COMMAND
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Register the `doctor` command.
 *
 * Runs environment diagnostics: Node version, npm, working directory, cache,
 * port availability, marketplace configuration, and optional per-photon checks.
 */
export function registerDoctorCommand(program: Command, defaultDir: string): void {
  program
    .command('doctor')
    .argument('[name]', 'Photon name to diagnose (checks environment if omitted)')
    .description('Run diagnostics on photon environment, ports, and configuration')
    .option('--port <number>', 'Port to check for availability', '3000')
    .action(async (name: string | undefined, options: any, command: Command) => {
      try {
        const { formatOutput, printHeader, printInfo, printSuccess, printWarning, STATUS } =
          await import('../../cli-formatter.js');
        const workingDir = command.parent?.opts().dir || defaultDir;
        const diagnostics: Record<string, any> = {};
        const suggestions: string[] = [];
        let issuesFound = 0;

        printHeader('Photon Doctor');
        printInfo('Running environment checks...\n');

        // Node runtime
        const nodeVersion = process.version;
        const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0]);
        diagnostics['Node.js'] = {
          version: nodeVersion,
          status: majorVersion >= 18 ? STATUS.OK : STATUS.ERROR,
        };
        if (majorVersion < 18) {
          issuesFound++;
          suggestions.push('Upgrade to Node.js 18+ (https://nodejs.org).');
        }

        // npm availability
        try {
          const { execSync } = await import('child_process');
          const npmVersion = execSync('npm --version', { encoding: 'utf-8' }).trim();
          diagnostics['Package manager'] = { npm: npmVersion, status: STATUS.OK };
        } catch {
          diagnostics['Package manager'] = { npm: 'not found', status: STATUS.ERROR };
          issuesFound++;
          suggestions.push('Install npm / npx so Photon can install dependencies.');
        }

        // Working directory health
        try {
          await fs.access(workingDir);
          const stats = await fs.stat(workingDir);
          if (stats.isDirectory()) {
            const mcps = await listPhotonMCPs(workingDir);
            diagnostics['Working directory'] = {
              path: workingDir,
              status: STATUS.OK,
              photons: mcps.length,
            };
          } else {
            diagnostics['Working directory'] = {
              path: workingDir,
              status: STATUS.ERROR,
              note: 'Not a directory',
            };
            issuesFound++;
            suggestions.push(`Fix working directory: rm ${workingDir} && mkdir -p ${workingDir}`);
          }
        } catch {
          diagnostics['Working directory'] = {
            path: workingDir,
            status: STATUS.WARN,
            note: 'Will be created on first use',
          };
        }

        // Cache directory insight
        const cacheDir = path.join(os.homedir(), '.cache', 'photon-mcp', 'compiled');
        try {
          await fs.access(cacheDir);
          const files = await fs.readdir(cacheDir);
          diagnostics['Cache directory'] = {
            path: cacheDir,
            status: STATUS.OK,
            cachedFiles: files.length,
          };
        } catch {
          diagnostics['Cache directory'] = {
            path: cacheDir,
            status: STATUS.UNKNOWN,
            note: 'Created on demand',
          };
        }

        // Port availability
        const port = parseInt(options.port, 10);
        const available = await isPortAvailable(port);
        diagnostics['Ports'] = {
          port,
          status: available ? STATUS.OK : STATUS.ERROR,
          note: available ? 'Available' : 'In use by another process',
        };
        if (!available) {
          issuesFound++;
          suggestions.push(
            `Port ${port} is busy. Run Photon with '--port ${port + 1}' or stop the conflicting service.`
          );
        }

        // Marketplace configuration
        try {
          const { MarketplaceManager } = await import('../../marketplace-manager.js');
          const manager = new MarketplaceManager();
          await manager.initialize();
          const enabled = manager.getAll().filter((m) => m.enabled);
          if (enabled.length === 0) {
            diagnostics['Marketplaces'] = {
              status: STATUS.WARN,
              note: 'No marketplaces configured. Add one with: photon marketplace add portel-dev/photons',
            };
            suggestions.push('Add at least one marketplace so you can install community photons.');
          } else {
            const conflicts = await manager.detectAllConflicts();
            diagnostics['Marketplaces'] = {
              status: conflicts.size > 0 ? STATUS.WARN : STATUS.OK,
              enabled: enabled.map((m) => m.name),
              conflicts: conflicts.size,
            };
            if (conflicts.size > 0) {
              issuesFound++;
              suggestions.push('Resolve duplicate photons with: photon marketplace resolve');
            }
          }
        } catch (error) {
          diagnostics['Marketplaces'] = { status: STATUS.ERROR, error: getErrorMessage(error) };
          suggestions.push(
            'Marketplace config failed to load. Run photon marketplace list to debug.'
          );
          issuesFound++;
        }

        // Photon-specific checks
        if (name) {
          const photonSection: Record<string, any> = {};
          const filePath = await resolvePhotonPath(name, workingDir);
          if (!filePath) {
            photonSection.status = STATUS.ERROR;
            photonSection.note = `Not installed in ${workingDir}`;
            suggestions.push(`Install ${name} with: photon add ${name}`);
            issuesFound++;
          } else {
            photonSection.status = STATUS.OK;
            photonSection.path = filePath;
            const params = await extractConstructorParams(filePath);
            if (params.length > 0) {
              photonSection.environment = params.map((param) => {
                const envVar = toEnvVarName(name, param.name);
                const value = process.env[envVar];
                const ok = Boolean(value) || param.isOptional || param.hasDefault;
                if (!ok) {
                  issuesFound++;
                  suggestions.push(`Set ${envVar} for ${name} (e.g. export ${envVar}=value).`);
                }
                return {
                  name: envVar,
                  status: ok ? STATUS.OK : STATUS.ERROR,
                  value: value
                    ? 'configured'
                    : param.hasDefault
                      ? `default: ${formatDefaultValue(param.defaultValue)}`
                      : 'missing',
                };
              });
            }

            const cachedFile = path.join(cacheDir, `${name}.js`);
            try {
              await fs.access(cachedFile);
              photonSection.cache = { status: STATUS.OK, note: 'Warm' };
            } catch {
              photonSection.cache = {
                status: STATUS.WARN,
                note: 'Not compiled yet (first run will compile)',
              };
            }
          }
          diagnostics[`Photon: ${name}`] = photonSection;
        }

        formatOutput(diagnostics, 'tree');

        if (suggestions.length > 0) {
          printHeader('Suggested fixes');
          suggestions.forEach((tip, idx) => console.log(` ${idx + 1}. ${tip}`));
        }

        if (issuesFound === 0 && suggestions.length === 0) {
          printSuccess('\nAll checks passed!');
        } else {
          printWarning(`\nDetected ${issuesFound || suggestions.length} potential issue(s).`);
        }
      } catch (error) {
        const { printError } = await import('../../cli-formatter.js');
        printError(getErrorMessage(error));
        process.exit(1);
      }
    });
}

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
import { detectPM } from '../../shared-utils.js';
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

/** Upper bound on tool count before we nudge the author to collapse. */
const TOOL_SPRAWL_THRESHOLD = 15;
/** Parameter-name patterns that almost always indicate a credential. */
const SECRET_NAME_REGEX =
  /^(api[_-]?key|password|passwd|pwd|secret|token|access[_-]?token|bearer)$/i;

async function extractToolCount(filePath: string): Promise<number> {
  try {
    const source = await fs.readFile(filePath, 'utf-8');
    const { SchemaExtractor } = await import('@portel/photon-core');
    const extractor = new SchemaExtractor();
    return extractor.extractFromSource(source).length;
  } catch {
    return 0;
  }
}

/**
 * Find constructor or method parameters whose name matches the secret regex.
 * Returns `{ paramName, location }` tuples. Location is either the literal
 * string "constructor" or the method name so the reporter can cite it.
 */
async function findSecretNamedParams(
  filePath: string
): Promise<Array<{ paramName: string; location: string }>> {
  try {
    const source = await fs.readFile(filePath, 'utf-8');
    const { SchemaExtractor } = await import('@portel/photon-core');
    const extractor = new SchemaExtractor();
    const hits: Array<{ paramName: string; location: string }> = [];

    for (const p of extractor.extractConstructorParams(source)) {
      if (SECRET_NAME_REGEX.test(p.name)) {
        hits.push({ paramName: p.name, location: 'constructor' });
      }
    }

    for (const tool of extractor.extractFromSource(source)) {
      for (const key of Object.keys(tool.inputSchema.properties || {})) {
        if (SECRET_NAME_REGEX.test(key)) {
          hits.push({ paramName: key, location: tool.name });
        }
      }
    }
    return hits;
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
export function registerDoctorCommand(program: Command): void {
  program
    .command('doctor')
    .argument('[name]', 'Photon name to diagnose (checks environment if omitted)')
    .description('Run diagnostics on photon environment, ports, and configuration')
    .option('--port <number>', 'Port to check for availability', '3000')
    .action(async (name: string | undefined, options: any, command: Command) => {
      try {
        const { formatOutput, printHeader, printInfo, printSuccess, printWarning, STATUS } =
          await import('../../cli-formatter.js');
        const workingDir = getDefaultContext().baseDir;
        const { announceContext } = await import('../../shared/announce-context.js');
        announceContext({ action: 'Diagnosing', photon: name, target: workingDir });
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

        // Package manager availability (bun or npm)
        try {
          const { execSync } = await import('child_process');
          const pm = detectPM();
          const pmVersion = execSync(`${pm} --version`, { encoding: 'utf-8' }).trim();
          diagnostics['Package manager'] = { [pm]: pmVersion, status: STATUS.OK };
        } catch {
          diagnostics['Package manager'] = { version: 'not found', status: STATUS.ERROR };
          issuesFound++;
          suggestions.push('Install npm or bun so Photon can install dependencies.');
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

            // Conflicts strictly between the two shipped built-in marketplaces
            // (portel-dev/photons and portel-dev/photon-examples) are expected —
            // examples intentionally mirrors a subset of canonical photons for
            // learning purposes. Those shouldn't scare first-time users.
            const BUILT_IN_NAMES = new Set(['photons', 'examples']);
            let userImpactingConflicts = 0;
            for (const sources of conflicts.values()) {
              const nonBuiltIn = sources.filter((s) => !BUILT_IN_NAMES.has(s.marketplace.name));
              if (nonBuiltIn.length > 0) {
                userImpactingConflicts++;
              }
            }

            diagnostics['Marketplaces'] = {
              status: userImpactingConflicts > 0 ? STATUS.WARN : STATUS.OK,
              enabled: enabled.map((m) => m.name),
              conflicts: userImpactingConflicts,
              ...(conflicts.size > userImpactingConflicts && {
                expectedOverlaps: conflicts.size - userImpactingConflicts,
              }),
            };
            if (userImpactingConflicts > 0) {
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

            // Tool sprawl: every exposed tool widens the attack surface.
            const toolCount = await extractToolCount(filePath);
            if (toolCount > TOOL_SPRAWL_THRESHOLD) {
              photonSection.toolCount = {
                status: STATUS.WARN,
                count: toolCount,
                threshold: TOOL_SPRAWL_THRESHOLD,
                note: `Exposes ${toolCount} tools — consider collapsing into fewer outcome-oriented tools`,
              };
              issuesFound++;
              suggestions.push(
                `${name} exposes ${toolCount} tools (> ${TOOL_SPRAWL_THRESHOLD}). Each tool is an attack surface; collapse fine-grained CRUD into outcome-oriented tools.`
              );
            } else {
              photonSection.toolCount = { status: STATUS.OK, count: toolCount };
            }

            // Secret-named parameters — nudge the author toward env injection.
            const secretHits = await findSecretNamedParams(filePath);
            if (secretHits.length > 0) {
              photonSection.secretParams = {
                status: STATUS.WARN,
                hits: secretHits.map((h) => `${h.location}.${h.paramName}`),
                note: 'Parameters with secret-like names should be injected via env vars, not accepted as free-form input.',
              };
              issuesFound++;
              for (const h of secretHits) {
                suggestions.push(
                  `${name}: "${h.paramName}" in ${h.location} looks like a credential — prefer env-injection (e.g. @env ${toEnvVarName(name, h.paramName)}) over a method parameter.`
                );
              }
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

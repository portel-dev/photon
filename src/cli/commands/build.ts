import { Command } from 'commander';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import ora from 'ora';
import chalk from 'chalk';
import { printError } from '../../cli-formatter.js';
import { fileURLToPath } from 'url';
import { SchemaExtractor } from '@portel/photon-core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** A resolved @photon dependency ready for bundling */
interface ResolvedDep {
  /** Variable name used in the constructor (e.g. "homeTodos") */
  name: string;
  /** Source identifier from @photon tag (e.g. "todo", "./helper.photon.ts") */
  source: string;
  /** Resolved absolute path to the .photon.ts file */
  filePath: string;
  /** Source code content */
  sourceCode: string;
}

/**
 * Recursively resolve all @photon dependencies starting from a root source file.
 * Returns a flat list of unique dependencies (by file path).
 */
function resolvePhotonDeps(
  sourceCode: string,
  sourceFilePath: string,
  baseDir: string,
  visited: Set<string> = new Set()
): ResolvedDep[] {
  const extractor = new SchemaExtractor();
  const deps = extractor.extractPhotonDependencies(sourceCode);
  const result: ResolvedDep[] = [];

  for (const dep of deps) {
    // Resolve the file path based on source type
    let resolvedPath: string | null = null;

    if (dep.sourceType === 'local') {
      // Relative or absolute path
      if (dep.source.startsWith('./') || dep.source.startsWith('../')) {
        resolvedPath = path.resolve(path.dirname(sourceFilePath), dep.source);
      } else {
        resolvedPath = path.resolve(dep.source);
      }
      // Ensure .photon.ts extension
      if (!resolvedPath.endsWith('.photon.ts') && !resolvedPath.endsWith('.ts')) {
        resolvedPath += '.photon.ts';
      }
    } else if (dep.sourceType === 'marketplace') {
      // Search common locations for marketplace photons
      const slug = dep.source
        .replace(/\.photon\.ts$/, '')
        .replace(/\.photon$/, '')
        .replace(/\.ts$/, '');
      const fileName = `${slug}.photon.ts`;
      const candidates = [
        path.resolve(path.dirname(sourceFilePath), fileName),
        path.resolve(path.dirname(sourceFilePath), 'photons', fileName),
        path.join(baseDir, fileName),
        path.join(baseDir, 'photons', fileName),
        path.join(baseDir, 'marketplace', fileName),
      ];
      for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
          resolvedPath = candidate;
          break;
        }
      }
    }

    if (!resolvedPath || !fs.existsSync(resolvedPath)) {
      // Can't resolve — will be warned about separately
      continue;
    }

    resolvedPath = fs.realpathSync(resolvedPath);

    if (visited.has(resolvedPath)) {
      continue; // Already processed (circular dep protection)
    }
    visited.add(resolvedPath);

    const depSource = fs.readFileSync(resolvedPath, 'utf-8');
    result.push({
      name: dep.name,
      source: dep.source,
      filePath: resolvedPath,
      sourceCode: depSource,
    });

    // Recurse into transitive dependencies
    const transitive = resolvePhotonDeps(depSource, resolvedPath, baseDir, visited);
    result.push(...transitive);
  }

  return result;
}

export function registerBuildCommand(program: Command) {
  program
    .command('build')
    .description('Compile a photon into a standalone executable binary')
    .argument('<file>', 'Path to the .photon.ts file')
    .option('-o, --outfile <name>', 'Name of the output binary')
    .option(
      '-t, --target <target>',
      'Bun compilation target (e.g. bun-linux-x64, bun-darwin-arm64, bun-windows-x64)'
    )
    .action(async (file: string, options: { outfile?: string; target?: string }) => {
      const spinner = ora(`Preparing standalone build for ${file}...`).start();
      const workingDir = process.cwd();
      const photonPath = path.resolve(workingDir, file);

      if (!fs.existsSync(photonPath)) {
        spinner.fail(`File not found: ${photonPath}`);
        process.exit(1);
      }

      // Check that bun is available
      try {
        const { execSync } = await import('child_process');
        execSync('bun --version', { stdio: 'ignore' });
      } catch {
        spinner.fail('Bun is required for compilation. Install it: https://bun.sh');
        process.exit(1);
      }

      // Read the source code to embed in the binary
      const sourceCode = fs.readFileSync(photonPath, 'utf-8');

      // Resolve @photon dependencies recursively
      const baseDir = path.join(process.env.HOME || '~', '.photon');
      const photonDeps = resolvePhotonDeps(sourceCode, photonPath, baseDir);

      if (photonDeps.length > 0) {
        spinner.info(
          `Bundling ${photonDeps.length} @photon dependenc${photonDeps.length === 1 ? 'y' : 'ies'}:`
        );
        for (const dep of photonDeps) {
          console.log(chalk.cyan(`  📦 ${dep.name} → ${path.basename(dep.filePath)}`));
        }
        console.log();
        spinner.start('Continuing build...');
      }

      // Detect unbundleable dependencies and warn
      const warnings: string[] = [];

      // Check all sources (main + deps) for @mcp and @cli tags
      const allSources = [sourceCode, ...photonDeps.map((d) => d.sourceCode)];
      for (const src of allSources) {
        for (const match of src.matchAll(/@mcp\s+(\S+)/g)) {
          warnings.push(
            `@mcp dependency "${match[1]}" — external MCP server, must be installed separately`
          );
        }
        for (const match of src.matchAll(/@cli\s+(\S+)/g)) {
          warnings.push(
            `@cli dependency "${match[1]}" — external CLI tool, must be available on target system`
          );
        }
      }

      // Check for unresolved @photon deps (ones we couldn't find on disk)
      const extractor = new SchemaExtractor();
      const declaredDeps = extractor.extractPhotonDependencies(sourceCode);
      for (const dep of declaredDeps) {
        const resolved = photonDeps.find((d) => d.name === dep.name);
        if (!resolved) {
          warnings.push(
            `@photon dependency "${dep.name}" (from ${dep.source}) — could not be resolved, must be available at runtime`
          );
        }
      }

      if (warnings.length > 0) {
        spinner.warn('External dependencies detected (not bundled):');
        for (const w of warnings) {
          console.log(chalk.yellow(`  ⚠ ${w}`));
        }
        console.log();
        spinner.start('Continuing build...');
      }

      // Generate a unique temporary entrypoint file
      const tempEntrypointName = `.photon-build-${Date.now()}.ts`;
      const tempEntrypointPath = path.join(workingDir, tempEntrypointName);

      // Determine outfile name
      let outfile = options.outfile;
      if (!outfile) {
        const basename = path.basename(file, '.photon.ts');
        outfile = basename.endsWith('.photon.js') ? path.basename(file, '.photon.js') : basename;
      }

      try {
        // Relative import path for the photon module
        let relativePhotonPath = path.relative(workingDir, photonPath);
        if (!relativePhotonPath.startsWith('.')) {
          relativePhotonPath = `./${relativePhotonPath}`;
        }

        // Escape source for embedding as a template literal
        const escapeForTemplateLiteral = (src: string) =>
          src.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');

        const escapedSource = escapeForTemplateLiteral(sourceCode);

        // Resolve the photon runtime package path for the entrypoint import.
        const photonPkgDir = path.resolve(__dirname, '..', '..'); // dist/ -> package root
        let photonImportPath = path.relative(workingDir, path.join(photonPkgDir, 'index.js'));
        if (!photonImportPath.startsWith('.')) {
          photonImportPath = `./${photonImportPath}`;
        }

        // Generate import statements for each @photon dependency
        const depImports: string[] = [];
        const depMapEntries: string[] = [];
        for (let i = 0; i < photonDeps.length; i++) {
          const dep = photonDeps[i];
          const varName = `__dep${i}`;
          let depImportPath = path.relative(workingDir, dep.filePath);
          if (!depImportPath.startsWith('.')) {
            depImportPath = `./${depImportPath}`;
          }
          depImports.push(`import * as ${varName} from '${depImportPath}';`);

          const escapedDepSource = escapeForTemplateLiteral(dep.sourceCode);
          depMapEntries.push(
            `  deps.set('${dep.name}', { module: ${varName}, source: \`${escapedDepSource}\`, filePath: ${JSON.stringify(dep.filePath)} });`
          );
          // Also register by source name for fallback matching
          if (dep.source !== dep.name) {
            depMapEntries.push(
              `  deps.set('${dep.source}', { module: ${varName}, source: \`${escapedDepSource}\`, filePath: ${JSON.stringify(dep.filePath)} });`
            );
          }
        }

        const depImportsBlock = depImports.length > 0 ? depImports.join('\n') + '\n' : '';
        const depMapBlock =
          depMapEntries.length > 0
            ? `\nfunction buildDependencyMap() {\n  const deps = new Map();\n${depMapEntries.join('\n')}\n  return deps;\n}\n`
            : '';
        const depMapArg =
          depMapEntries.length > 0 ? `\n    preloadedDependencies: buildDependencyMap(),` : '';

        // Build a symlink routing map for the entrypoint:
        // When invoked via a symlink named after a bundled dep, serve that dep instead.
        const symlinkEntries: string[] = [];
        for (let i = 0; i < photonDeps.length; i++) {
          const dep = photonDeps[i];
          const varName = `__dep${i}`;
          const escapedDepSource = escapeForTemplateLiteral(dep.sourceCode);
          // Extract the photon name from the file (e.g., "whatsapp" from "whatsapp.photon.ts")
          const depPhotonName = path.basename(dep.filePath, '.photon.ts').replace('.photon', '');
          symlinkEntries.push(
            `  '${depPhotonName}': { module: ${varName}, source: \`${escapedDepSource}\`, filePath: ${JSON.stringify(dep.filePath)} },`
          );
          // Also map by the dependency variable name if different
          if (dep.name !== depPhotonName) {
            symlinkEntries.push(
              `  '${dep.name}': { module: ${varName}, source: \`${escapedDepSource}\`, filePath: ${JSON.stringify(dep.filePath)} },`
            );
          }
        }
        const symlinkMapBlock =
          symlinkEntries.length > 0
            ? `\nconst BUNDLED_PHOTONS: Record<string, { module: any; source: string; filePath: string }> = {\n${symlinkEntries.join('\n')}\n};\n`
            : '\nconst BUNDLED_PHOTONS: Record<string, { module: any; source: string; filePath: string }> = {};\n';

        // Symlink routing logic: detect which photon to serve based on executable name
        const symlinkRoutingCode = `
  // Detect if invoked via a symlink to serve a bundled dependency.
  // Bun compiled binaries don't preserve argv[0] for symlinks, but
  // $_ (set by shells) contains the actual invocation path including symlink name.
  const __path = await import('path');
  const invokedAs = __path.default.basename(process.env._ || process.execPath);
  const bundled = BUNDLED_PHOTONS[invokedAs];
  const activeModule = bundled ? bundled.module : photonModule;
  const activeSource = bundled ? bundled.source : EMBEDDED_SOURCE;
  const activeFilePath = bundled ? bundled.filePath : ${JSON.stringify(photonPath)};
`;

        const entrypointCode = `import { PhotonServer, EmbeddedRuntime } from '${photonImportPath}';
import * as photonModule from '${relativePhotonPath}';
${depImportsBlock}
const EMBEDDED_SOURCE = \`${escapedSource}\`;
${depMapBlock}${symlinkMapBlock}
async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'mcp';

  let port: number | undefined;
  if (command === 'sse') {
    port = args[1] ? parseInt(args[1], 10) : undefined;
  }
${symlinkRoutingCode}
  // Start embedded runtime (in-process broker + scheduler)
  const runtime = new EmbeddedRuntime();
  runtime.start();

  const server = new PhotonServer({
    filePath: activeFilePath,
    transport: command === 'sse' ? 'sse' : 'stdio',
    port,
    preloadedModule: activeModule,
    embeddedSource: activeSource,${depMapArg}
  });

  await server.start();

  // Register @scheduled/@cron jobs from the loaded photon
  if (server.getLoadedPhoton()) {
    runtime.registerScheduledJobs(server.getLoadedPhoton()!, server.getLoader());
  }
}

main().catch(err => {
  console.error('Fatal error:', err.message || err);
  process.exit(1);
});
`;

        fs.writeFileSync(tempEntrypointPath, entrypointCode, 'utf-8');
        spinner.text = 'Compiling executable with Bun...';

        // Prepare bun build arguments
        const buildArgs = ['build', tempEntrypointPath, '--compile', '--outfile', outfile];
        if (options.target) {
          buildArgs.push('--target', options.target);
        }

        const buildProcess = spawn('bun', buildArgs, {
          cwd: workingDir,
          stdio: 'pipe',
        });

        let stdoutData = '';
        let stderrData = '';

        buildProcess.stdout.on('data', (data) => {
          stdoutData += data.toString();
        });

        buildProcess.stderr.on('data', (data) => {
          stderrData += data.toString();
        });

        await new Promise<void>((resolve, reject) => {
          buildProcess.on('close', (code) => {
            if (code === 0) {
              resolve();
            } else {
              reject(
                new Error(
                  `Bun compilation failed with exit code ${code}\n\n${stderrData || stdoutData}`
                )
              );
            }
          });
          buildProcess.on('error', reject);
        });

        // Get file size for display
        const stat = fs.statSync(outfile);
        const sizeMB = (stat.size / 1024 / 1024).toFixed(1);

        spinner.succeed(`Compiled: ${chalk.green(chalk.bold(outfile))} (${sizeMB} MB)`);

        // Create symlinks for bundled @photon dependencies
        if (photonDeps.length > 0) {
          const outDir = path.dirname(path.resolve(outfile));
          const outBase = path.resolve(outfile);
          const createdLinks: string[] = [];
          const seenNames = new Set<string>();

          for (const dep of photonDeps) {
            const depName = path.basename(dep.filePath, '.photon.ts').replace('.photon', '');
            if (seenNames.has(depName) || depName === path.basename(outfile)) continue;
            seenNames.add(depName);

            const linkPath = path.join(outDir, depName);
            try {
              if (fs.existsSync(linkPath)) fs.unlinkSync(linkPath);
              fs.symlinkSync(outBase, linkPath);
              createdLinks.push(depName);
            } catch {
              // Symlink creation may fail on some filesystems — non-fatal
            }
          }

          if (createdLinks.length > 0) {
            console.log(
              `\n${chalk.dim('Symlinks (each serves the bundled photon as its own MCP server):')}`
            );
            for (const name of createdLinks) {
              console.log(`  ${chalk.cyan(name)} → ${outfile}`);
            }
          }
        }

        console.log(`\nUsage:`);
        console.log(`  ./${outfile}         MCP server (stdio)`);
        console.log(`  ./${outfile} sse     MCP server (HTTP/SSE)`);
      } catch (err) {
        spinner.fail('Build failed');
        printError(err instanceof Error ? err.message : String(err));
        process.exit(1);
      } finally {
        // Clean up the temporary entrypoint file
        if (fs.existsSync(tempEntrypointPath)) {
          fs.unlinkSync(tempEntrypointPath);
        }
      }
    });
}

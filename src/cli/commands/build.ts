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
    .option('--with-app', 'Embed Beam frontend for PWA app support')
    .action(
      async (file: string, options: { outfile?: string; target?: string; withApp?: boolean }) => {
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

          // Embed frontend assets if --with-app
          let beamBundleConst = "const BEAM_BUNDLE = '';";
          let beamIndexHtmlConst = "const BEAM_INDEX_HTML = '';";
          if (options.withApp) {
            const distDir = path.resolve(__dirname, '..', '..');
            const bundlePath = path.join(distDir, 'beam.bundle.js');
            const indexPath = path.join(distDir, 'auto-ui', 'frontend', 'index.html');

            if (!fs.existsSync(bundlePath) || !fs.existsSync(indexPath)) {
              spinner.fail('Frontend assets not found. Run npm run build:beam first.');
              process.exit(1);
            }

            const bundleJs = fs.readFileSync(bundlePath, 'utf-8');
            const indexHtml = fs.readFileSync(indexPath, 'utf-8');
            beamBundleConst = `const BEAM_BUNDLE = \`${escapeForTemplateLiteral(bundleJs)}\`;`;
            beamIndexHtmlConst = `const BEAM_INDEX_HTML = \`${escapeForTemplateLiteral(indexHtml)}\`;`;
            spinner.info('Embedding Beam frontend assets for PWA support');
            spinner.start('Continuing build...');
          }

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

          // Build the depMap argument for CLI mode
          const cliDepMapArg = depMapEntries.length > 0 ? ', buildDependencyMap()' : '';

          const entrypointCode = `import { PhotonServer, PhotonLoader, EmbeddedRuntime, SchemaExtractor } from '${photonImportPath}';
import * as photonModule from '${relativePhotonPath}';
${depImportsBlock}
const EMBEDDED_SOURCE = \`${escapedSource}\`;
const PHOTON_NAME = '${path.basename(outfile)}';
${beamBundleConst}
${beamIndexHtmlConst}
${depMapBlock}${symlinkMapBlock}
async function runSetup(withShell: boolean) {
  const __fs = await import('fs');
  const __path = await import('path');
  const __os = await import('os');
  const binDir = __path.default.dirname(process.execPath);
  const binName = __path.default.basename(process.execPath);
  const homeDir = __os.default.homedir();

  // Create data directory
  const dataDir = __path.default.join(homeDir, '.photon', PHOTON_NAME);
  __fs.default.mkdirSync(dataDir, { recursive: true });
  console.log('  Data dir: ' + dataDir);

  // Create symlinks for bundled photon dependencies
  const created: string[] = [];
  const seen = new Set<string>();
  for (const [name] of Object.entries(BUNDLED_PHOTONS)) {
    if (seen.has(name) || name === binName) continue;
    seen.add(name);
    const linkPath = __path.default.join(binDir, name);
    try {
      if (__fs.default.existsSync(linkPath)) __fs.default.unlinkSync(linkPath);
      __fs.default.symlinkSync(process.execPath, linkPath);
      created.push(name);
    } catch {}
  }
  if (created.length > 0) {
    console.log('  Symlinks:');
    for (const name of created) console.log('    ' + name + ' -> ' + binName);
  }

  // Shell integration
  if (withShell) {
    const marker = '# photon:' + PHOTON_NAME;
    const alias = marker + '\\nfunction ' + PHOTON_NAME + '() { "' + process.execPath + '" "$@"; }\\n';
    const rcFile = process.env.SHELL?.includes('zsh')
      ? __path.default.join(homeDir, '.zshrc')
      : __path.default.join(homeDir, '.bashrc');
    const rcContent = __fs.default.existsSync(rcFile) ? __fs.default.readFileSync(rcFile, 'utf-8') : '';
    if (!rcContent.includes(marker)) {
      __fs.default.appendFileSync(rcFile, '\\n' + alias);
      console.log('  Shell alias added to ' + rcFile);
    } else {
      console.log('  Shell alias already present in ' + rcFile);
    }
  }
  console.log('\\nSetup complete.');
}

async function generateAppLaunchers(cmdArgs: string[]) {
  if (BEAM_BUNDLE === '') {
    console.error('Error: This binary was not built with --with-app. Rebuild with: photon build <file> --with-app');
    process.exit(1);
  }
  const __fs = await import('fs');
  const __path = await import('path');
  const __os = await import('os');

  let port = 3000;
  let outputDir = process.cwd();
  for (let i = 0; i < cmdArgs.length; i++) {
    if (cmdArgs[i] === '--port' && cmdArgs[i+1]) port = parseInt(cmdArgs[i+1], 10);
    if (cmdArgs[i] === '--output' && cmdArgs[i+1]) outputDir = __path.default.resolve(cmdArgs[i+1]);
  }

  const binaryPath = process.execPath;
  const appName = PHOTON_NAME;
  const platform = __os.default.platform();

  __fs.default.mkdirSync(outputDir, { recursive: true });

  if (platform === 'darwin') {
    // macOS .app bundle
    const appBundle = __path.default.join(outputDir, appName + '.app');
    const contentsDir = __path.default.join(appBundle, 'Contents');
    const macosDir = __path.default.join(contentsDir, 'MacOS');
    __fs.default.mkdirSync(macosDir, { recursive: true });

    const launchScript = \`#!/bin/bash
"\${binaryPath}" sse \${port} &
PID=$!
sleep 1
open "http://localhost:\${port}/app/\${appName}"
wait $PID
\`;
    const launchPath = __path.default.join(macosDir, 'launch');
    __fs.default.writeFileSync(launchPath, launchScript, { mode: 0o755 });

    const plist = \`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleExecutable</key><string>launch</string>
  <key>CFBundleName</key><string>\${appName}</string>
  <key>CFBundleIdentifier</key><string>com.photon.\${appName}</string>
  <key>CFBundleVersion</key><string>1.0</string>
</dict></plist>\`;
    __fs.default.writeFileSync(__path.default.join(contentsDir, 'Info.plist'), plist);
    console.log('  macOS: ' + appBundle);
  }

  // Linux .sh + .desktop
  const shPath = __path.default.join(outputDir, appName + '.sh');
  __fs.default.writeFileSync(shPath, \`#!/bin/bash
"\${binaryPath}" sse \${port} &
PID=$!
sleep 1
xdg-open "http://localhost:\${port}/app/\${appName}" 2>/dev/null || open "http://localhost:\${port}/app/\${appName}" 2>/dev/null
wait $PID
\`, { mode: 0o755 });
  console.log('  Launcher: ' + shPath);

  const desktopPath = __path.default.join(outputDir, appName + '.desktop');
  __fs.default.writeFileSync(desktopPath, \`[Desktop Entry]
Name=\${appName}
Exec=\${shPath}
Type=Application
Terminal=false
\`);
  console.log('  Desktop: ' + desktopPath);

  // Windows .bat
  const batPath = __path.default.join(outputDir, appName + '.bat');
  __fs.default.writeFileSync(batPath, \`@echo off
start "" "\${binaryPath}" sse \${port}
timeout /t 2 >nul
start http://localhost:\${port}/app/\${appName}
\`);
  console.log('  Windows: ' + batPath);

  console.log('\\nApp launchers created. They start the SSE server and open the PWA in your browser.');
}

function printUsage() {
  console.log('');
  console.log('Usage: ' + PHOTON_NAME + ' [command] [options]');
  console.log('');
  console.log('Commands:');
  console.log('  <method> [args]     Run a method directly (CLI mode)');
  console.log('  mcp                 Start MCP server (stdio transport)');
  console.log('  sse [port]          Start MCP server (HTTP/SSE transport)');
  console.log('  beam [port]         Start Beam web UI (SSE + browser)');
  console.log('  setup [--shell]     Create symlinks & data directories');
  console.log('  app                 Generate PWA app launchers');
  console.log('');
  console.log('Run with no arguments to see available methods.');
  console.log('');
}

function extractMethodsFromSource(source: string) {
  const ext = new SchemaExtractor();
  const metadata = ext.extractAllFromSource(source);
  return metadata.tools
    .filter((t: any) => !t.name.startsWith('scheduled') && !t.name.startsWith('handle') && t.name !== 'reportError')
    .map((tool: any) => {
      const params: { name: string; type: string; optional: boolean; description?: string }[] = [];
      const schema = tool.inputSchema;
      if (schema?.properties) {
        for (const [name, prop] of Object.entries(schema.properties) as [string, any][]) {
          let type = prop.type;
          if (!type && (prop.anyOf || prop.oneOf)) {
            type = (prop.anyOf || prop.oneOf).map((v: any) => v.type).filter(Boolean).join(' | ');
          }
          params.push({
            name,
            type: type || 'any',
            optional: !schema.required?.includes(name),
            description: prop.description,
          });
        }
      }
      return { name: tool.name, params, description: tool.description !== 'No description' ? tool.description : undefined };
    });
}

function cliParseArgs(args: string[], params: { name: string; type: string; optional: boolean }[]) {
  const result: Record<string, any> = {};
  const paramTypes = new Map(params.map(p => [p.name, p.type]));
  let positionalIndex = 0;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h' || arg === '--json') continue;
    if (arg.startsWith('--no-')) { result[arg.substring(5)] = false; continue; }
    if (arg.startsWith('--')) {
      const eqIdx = arg.indexOf('=');
      if (eqIdx !== -1) {
        const key = arg.substring(2, eqIdx);
        result[key] = cliCoerce(arg.substring(eqIdx + 1), paramTypes.get(key) || 'any');
      } else {
        const key = arg.substring(2);
        const expectedType = paramTypes.get(key) || 'any';
        if (expectedType === 'boolean' && (i + 1 >= args.length || args[i + 1].startsWith('--'))) {
          result[key] = true;
        } else if (i + 1 < args.length) { i++; result[key] = cliCoerce(args[i], expectedType); }
        else { result[key] = true; }
      }
    } else if (paramTypes.has(arg)) {
      const key = arg;
      const expectedType = paramTypes.get(key) || 'any';
      if (expectedType === 'boolean') { result[key] = true; }
      else if (i + 1 < args.length) { i++; result[key] = cliCoerce(args[i], expectedType); }
      else { result[key] = true; }
    } else {
      while (positionalIndex < params.length && params[positionalIndex].name in result) positionalIndex++;
      if (positionalIndex < params.length) {
        result[params[positionalIndex].name] = cliCoerce(arg, params[positionalIndex].type);
        positionalIndex++;
      }
    }
  }
  return result;
}

function cliCoerce(value: string, type: string): any {
  if (type === 'boolean') return value === 'true' || value === '1';
  if (type === 'number') { const n = Number(value); return isNaN(n) ? value : n; }
  try { return JSON.parse(value); } catch { return value; }
}

async function runCli(methodName: string, methodArgs: string[], source: string, filePath: string, mod: any, depMap?: Map<string, any>) {
  const methods = extractMethodsFromSource(source);

  if (!methodName) {
    console.log('\\nUSAGE:\\n    ' + PHOTON_NAME + ' <command> [options]\\n');
    console.log('COMMANDS:');
    const maxLen = Math.max(...methods.map((m: any) => m.name.length), 0);
    for (const m of methods) {
      const pad = ' '.repeat(maxLen - m.name.length + 4);
      const desc = m.description ? (m.description.length > 60 ? m.description.substring(0, 57) + '...' : m.description) : '';
      console.log('    ' + m.name + pad + desc);
    }
    console.log('\\nRun \\'' + PHOTON_NAME + ' <command> --help\\' for details.\\n');
    console.log('SERVER MODES:');
    console.log('    mcp              MCP server (stdio)');
    console.log('    sse [port]       MCP server (HTTP/SSE)');
    console.log('    beam [port]      Beam web UI');
    console.log('');
    return;
  }

  if (methodArgs.includes('--help') || methodArgs.includes('-h')) {
    const method = methods.find((m: any) => m.name === methodName);
    if (!method) { console.error('Method \\'' + methodName + '\\' not found.'); process.exit(1); }
    console.log('\\n' + PHOTON_NAME + ' ' + method.name);
    if (method.description) console.log('  ' + method.description);
    if (method.params.length > 0) {
      console.log('\\nParameters:');
      for (const p of method.params) {
        const req = p.optional ? '' : ' (required)';
        console.log('  --' + p.name + ' <' + p.type + '>' + req + (p.description ? '  ' + p.description : ''));
      }
    }
    console.log('');
    return;
  }

  const method = methods.find((m: any) => m.name === methodName);
  if (!method) { console.error('Method \\'' + methodName + '\\' not found. Run \\'' + PHOTON_NAME + '\\' to see available methods.'); process.exit(1); }

  const parsedArgs = cliParseArgs(methodArgs, method.params);
  const jsonOutput = methodArgs.includes('--json');
  const missing = method.params.filter((p: any) => !p.optional && !(p.name in parsedArgs)).map((p: any) => p.name);
  if (missing.length > 0) {
    const usage = method.params.map((p: any) => p.optional ? '[--' + p.name + ']' : '--' + p.name + ' <value>').join(' ');
    console.error('Missing required parameters: ' + missing.join(', ') + '\\nUsage: ' + PHOTON_NAME + ' ' + methodName + ' ' + usage);
    process.exit(1);
  }

  const runtime = new EmbeddedRuntime();
  runtime.start();

  const loader = new PhotonLoader(false);
  if (depMap) (loader as any).preloadedDependencies = depMap;
  const photonInstance = await loader.loadFromModule(mod, filePath, source);
  const result = await loader.executeTool(photonInstance, methodName, parsedArgs);

  if (photonInstance) runtime.registerScheduledJobs(photonInstance, loader);

  if (result === undefined || result === null) return;
  if (jsonOutput || typeof result === 'object') {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(result);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || '';

  // Meta commands (no symlink routing needed)
  if (command === 'setup') { await runSetup(args.includes('--shell')); process.exit(0); }
  if (command === 'app') { await generateAppLaunchers(args.slice(1)); process.exit(0); }
  if (command === '--help' || command === '-h') { printUsage(); process.exit(0); }
  if (command === '--version' || command === '-v') { console.log(PHOTON_NAME); process.exit(0); }

${symlinkRoutingCode}
  // Server modes
  const SERVER_COMMANDS = ['mcp', 'sse', 'beam'];
  if (SERVER_COMMANDS.includes(command)) {
    let port: number | undefined;
    if (command === 'sse' || command === 'beam') {
      port = args[1] ? parseInt(args[1], 10) : (command === 'beam' ? 3000 : undefined);
    }

    if (command === 'beam' && BEAM_BUNDLE === '') {
      console.error('Error: This binary was not built with --with-app. Rebuild with: photon build <file> --with-app');
      process.exit(1);
    }

    const runtime = new EmbeddedRuntime();
    runtime.start();

    const server = new PhotonServer({
      filePath: activeFilePath,
      transport: command === 'sse' || command === 'beam' ? 'sse' : 'stdio',
      port,
      preloadedModule: activeModule,
      embeddedSource: activeSource,${depMapArg}
      embeddedAssets: BEAM_BUNDLE !== '' ? { indexHtml: BEAM_INDEX_HTML, bundleJs: BEAM_BUNDLE } : undefined,
    });

    await server.start();

    if (server.getLoadedPhoton()) {
      runtime.registerScheduledJobs(server.getLoadedPhoton()!, server.getLoader());
    }

    // For beam mode, open the browser
    if (command === 'beam') {
      const beamPort = port || 3000;
      const beamUrl = 'http://localhost:' + beamPort + '/#' + PHOTON_NAME + '?focus=1';
      console.log('Beam UI: ' + beamUrl);
      const { exec } = await import('child_process');
      if (process.platform === 'darwin') exec('open "' + beamUrl + '"');
      else if (process.platform === 'win32') exec('start "" "' + beamUrl + '"');
      else exec('xdg-open "' + beamUrl + '" 2>/dev/null');
    }
    return;
  }

  // CLI mode (default): run method or list methods
  const methodName = command;
  const methodArgs = command ? args.slice(1) : [];
  await runCli(methodName, methodArgs, activeSource, activeFilePath, activeModule${cliDepMapArg});
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
          console.log(`  ./${outfile}              CLI mode (list methods)`);
          console.log(`  ./${outfile} <method>     Run a method directly`);
          console.log(`  ./${outfile} mcp          MCP server (stdio)`);
          console.log(`  ./${outfile} sse [port]   MCP server (HTTP/SSE)`);
          if (options.withApp) {
            console.log(`  ./${outfile} beam [port]  Beam web UI`);
          }
          console.log(`  ./${outfile} setup        Create symlinks & data dirs`);
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
      }
    );
}

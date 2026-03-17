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

          // Generate dynamic import lines for each @photon dependency (deferred loading)
          const depDynamicLoads: string[] = [];
          const depMapEntries: string[] = [];
          for (let i = 0; i < photonDeps.length; i++) {
            const dep = photonDeps[i];
            let depImportPath = path.relative(workingDir, dep.filePath);
            if (!depImportPath.startsWith('.')) {
              depImportPath = `./${depImportPath}`;
            }
            depDynamicLoads.push(`  _depModules[${i}] = await import('${depImportPath}');`);

            const escapedDepSource = escapeForTemplateLiteral(dep.sourceCode);
            depMapEntries.push(
              `  deps.set('${dep.name}', { module: _depModules[${i}], source: \`${escapedDepSource}\`, filePath: ${JSON.stringify(dep.filePath)} });`
            );
            // Also register by source name for fallback matching
            if (dep.source !== dep.name) {
              depMapEntries.push(
                `  deps.set('${dep.source}', { module: _depModules[${i}], source: \`${escapedDepSource}\`, filePath: ${JSON.stringify(dep.filePath)} });`
              );
            }
          }

          const loadModulesBody =
            depDynamicLoads.length > 0 ? depDynamicLoads.join('\n') + '\n' : '';
          const depMapBlock =
            depMapEntries.length > 0
              ? `\nfunction buildDependencyMap() {\n  const deps = new Map();\n${depMapEntries.join('\n')}\n  return deps;\n}\n`
              : '';
          const depMapArg =
            depMapEntries.length > 0 ? `\n    preloadedDependencies: buildDependencyMap(),` : '';

          // Build bundled photons metadata map (module refs resolved lazily via depIndex)
          const bundledEntries: string[] = [];
          for (let i = 0; i < photonDeps.length; i++) {
            const dep = photonDeps[i];
            const escapedDepSource = escapeForTemplateLiteral(dep.sourceCode);
            const depPhotonName = path.basename(dep.filePath, '.photon.ts').replace('.photon', '');
            bundledEntries.push(
              `  '${depPhotonName}': { depIndex: ${i}, source: \`${escapedDepSource}\`, filePath: ${JSON.stringify(dep.filePath)} },`
            );
            if (dep.name !== depPhotonName) {
              bundledEntries.push(
                `  '${dep.name}': { depIndex: ${i}, source: \`${escapedDepSource}\`, filePath: ${JSON.stringify(dep.filePath)} },`
              );
            }
          }
          const bundledMapBlock =
            bundledEntries.length > 0
              ? `\nconst BUNDLED_PHOTONS: Record<string, { depIndex: number; source: string; filePath: string }> = {\n${bundledEntries.join('\n')}\n};\n`
              : '\nconst BUNDLED_PHOTONS: Record<string, { depIndex: number; source: string; filePath: string }> = {};\n';

          // The main photon file path constant for the entrypoint
          const mainFilePathJson = JSON.stringify(photonPath);

          // Build the depMap argument for CLI mode
          const cliDepMapArg = depMapEntries.length > 0 ? ', buildDependencyMap()' : '';

          const entrypointCode = `import { PhotonServer, PhotonLoader, EmbeddedRuntime, SchemaExtractor } from '${photonImportPath}';

const EMBEDDED_SOURCE = \`${escapedSource}\`;
const PHOTON_NAME = '${path.basename(outfile)}';
${beamBundleConst}
${beamIndexHtmlConst}

// Lazy module loading — avoids top-level side effects that block startup
let _mainModule: any;
const _depModules: any[] = [];
let _modulesLoaded = false;

async function loadModules() {
  if (_modulesLoaded) return;
  _mainModule = await import('${relativePhotonPath}');
${loadModulesBody}  _modulesLoaded = true;
}
${depMapBlock}${bundledMapBlock}
async function runSetup() {
  const __fs = await import('fs');
  const __path = await import('path');
  const __os = await import('os');
  const binDir = __path.default.dirname(process.execPath);
  const binName = __path.default.basename(process.execPath);
  const binPath = process.execPath;
  const homeDir = __os.default.homedir();
  const isWindows = process.platform === 'win32';
  const S = String.fromCharCode(36); // shell dollar sign

  console.log('Setting up ' + PHOTON_NAME + '...\\n');

  // 1. Create data directory
  const dataDir = __path.default.join(homeDir, '.photon', PHOTON_NAME);
  __fs.default.mkdirSync(dataDir, { recursive: true });
  console.log('  Data dir: ' + dataDir);

  // 2. Collect unique bundled photon names
  const seen = new Set<string>();
  const bundledNames: string[] = [];
  for (const [name] of Object.entries(BUNDLED_PHOTONS)) {
    if (seen.has(name) || name === PHOTON_NAME) continue;
    seen.add(name);
    bundledNames.push(name);
  }

  // 3. Create wrapper scripts so bundled photons are callable by name
  const createdWrappers: string[] = [];
  for (const name of bundledNames) {
    try {
      if (isWindows) {
        const cmdPath = __path.default.join(binDir, name + '.cmd');
        __fs.default.writeFileSync(cmdPath, '@echo off\\r\\n"%~dp0' + binName + '" x ' + name + ' %*\\r\\n');
        createdWrappers.push(name + '.cmd');
      } else {
        const scriptPath = __path.default.join(binDir, name);
        __fs.default.writeFileSync(scriptPath, '#!/bin/sh\\nexec "$(dirname "$0")/' + binName + '" x ' + name + ' "$@"\\n', { mode: 0o755 });
        createdWrappers.push(name);
      }
    } catch (e) {
      // Non-fatal — shell aliases will still work
    }
  }
  if (createdWrappers.length > 0) {
    console.log('  Wrappers: ' + createdWrappers.join(', '));
  }

  // 4. Install tab completions in auto-discovery locations
  if (isWindows) {
    // PowerShell: must go in profile (no auto-discovery)
    // Handled in step 5 below
  } else {
    const isZsh = (process.env.SHELL || '').includes('zsh');
    if (isZsh) {
      // Zsh: drop completion file in ~/.zsh/completions/ and ensure fpath
      const compDir = __path.default.join(homeDir, '.zsh', 'completions');
      __fs.default.mkdirSync(compDir, { recursive: true });
      // Generate zsh completion script
      let compScript = '#compdef ' + PHOTON_NAME + '\\n';
      compScript += '_' + PHOTON_NAME + '() { compadd -- ' + S + '("' + binPath + '" completions ' + S + '{words[@]:1}" 2>/dev/null) }\\n';
      __fs.default.writeFileSync(__path.default.join(compDir, '_' + PHOTON_NAME), compScript);
      // Also generate for bundled photons
      for (const name of bundledNames) {
        let cs = '#compdef ' + name + '\\n';
        cs += '_' + name + '() { compadd -- ' + S + '("' + binPath + '" completions x ' + name + ' ' + S + '{words[@]:1}" 2>/dev/null) }\\n';
        __fs.default.writeFileSync(__path.default.join(compDir, '_' + name), cs);
      }
      console.log('  Zsh completions: ' + compDir);
    } else {
      // Bash: drop in ~/.local/share/bash-completion/completions/ (auto-loaded)
      const compDir = __path.default.join(homeDir, '.local', 'share', 'bash-completion', 'completions');
      __fs.default.mkdirSync(compDir, { recursive: true });
      let compScript = '_' + PHOTON_NAME + '() { COMPREPLY=(' + S + '(compgen -W "' + S + '("' + binPath + '" completions ' + S + '{COMP_WORDS[@]:1}" 2>/dev/null)" -- "' + S + '{COMP_WORDS[COMP_CWORD]}")); }\\n';
      compScript += 'complete -F _' + PHOTON_NAME + ' ' + PHOTON_NAME + '\\n';
      for (const name of bundledNames) {
        compScript += '_' + name + '() { COMPREPLY=(' + S + '(compgen -W "' + S + '("' + binPath + '" completions x ' + name + ' ' + S + '{COMP_WORDS[@]:1}" 2>/dev/null)" -- "' + S + '{COMP_WORDS[COMP_CWORD]}")); }\\n';
        compScript += 'complete -F _' + name + ' ' + name + '\\n';
      }
      __fs.default.writeFileSync(__path.default.join(compDir, PHOTON_NAME), compScript);
      console.log('  Bash completions: ' + compDir);
    }
  }

  // 5. Shell integration — aliases + PATH + fpath (idempotent)
  const marker = '# photon:' + PHOTON_NAME;

  if (isWindows) {
    const psProfile = __path.default.join(homeDir, 'Documents', 'PowerShell', 'Microsoft.PowerShell_profile.ps1');
    const psDir = __path.default.dirname(psProfile);
    __fs.default.mkdirSync(psDir, { recursive: true });
    const psContent = __fs.default.existsSync(psProfile) ? __fs.default.readFileSync(psProfile, 'utf-8') : '';
    if (!psContent.includes(marker)) {
      let block = '\\n' + marker + '\\n';
      block += 'function ' + PHOTON_NAME + ' { & "' + binPath + '" @args }\\n';
      for (const name of bundledNames) {
        block += 'function ' + name + ' { & "' + binPath + '" x ' + name + ' @args }\\n';
      }
      block += 'Register-ArgumentCompleter -CommandName ' + PHOTON_NAME + ' -ScriptBlock {\\n';
      block += '  param(' + S + 'wordToComplete, ' + S + 'commandAst, ' + S + 'cursorPosition)\\n';
      block += '  ' + S + 'words = ' + S + 'commandAst.ToString().Split(" ")\\n';
      block += '  & "' + binPath + '" completions (' + S + 'words | Select-Object -Skip 1) 2>' + S + 'null |\\n';
      block += '    Where-Object { ' + S + '_ -like "' + S + 'wordToComplete*" } |\\n';
      block += '    ForEach-Object { [System.Management.Automation.CompletionResult]::new(' + S + '_, ' + S + '_, "ParameterValue", ' + S + '_) }\\n';
      block += '}\\n';
      __fs.default.appendFileSync(psProfile, block);
      console.log('  PowerShell profile: ' + psProfile);
    } else {
      console.log('  PowerShell profile: already configured');
    }
  } else {
    const isZsh = (process.env.SHELL || '').includes('zsh');
    const rcFile = isZsh
      ? __path.default.join(homeDir, '.zshrc')
      : __path.default.join(homeDir, '.bashrc');
    const rcContent = __fs.default.existsSync(rcFile) ? __fs.default.readFileSync(rcFile, 'utf-8') : '';
    if (!rcContent.includes(marker)) {
      let block = '\\n' + marker + '\\n';
      // Ensure completion dir is in fpath (zsh only)
      if (isZsh) {
        block += 'fpath=(~/.zsh/completions ' + S + 'fpath)\\n';
        block += 'autoload -Uz compinit && compinit -C\\n';
      }
      // Aliases
      block += 'alias ' + PHOTON_NAME + '="' + binPath + '"\\n';
      for (const name of bundledNames) {
        block += 'alias ' + name + '="' + binPath + ' x ' + name + '"\\n';
      }
      __fs.default.appendFileSync(rcFile, block);
      console.log('  Shell config: ' + rcFile);
    } else {
      console.log('  Shell config: already configured');
    }
  }

  console.log('\\nSetup complete. Restart your shell or run: source ~/' + (isWindows ? 'Documents/PowerShell/Microsoft.PowerShell_profile.ps1' : ((process.env.SHELL || '').includes('zsh') ? '.zshrc' : '.bashrc')));
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

function handleCompletions(args: string[]) {
  // args = words after the binary name, e.g. ['x', 'whats'] or ['status', '--']
  const META_COMMANDS = ['mcp', 'sse', 'beam', 'setup', 'app', 'x', '--help', '--version'];
  const photonNames = [...new Set(Object.keys(BUNDLED_PHOTONS))];

  if (args.length <= 1) {
    // Completing first word: methods + meta commands + bundled photon names via x
    const methods = extractMethodsFromSource(EMBEDDED_SOURCE).map((m: any) => m.name);
    const all = [...methods, ...META_COMMANDS];
    const partial = args[0] || '';
    console.log(all.filter(c => c.startsWith(partial)).join('\\n'));
    return;
  }

  if (args[0] === 'x') {
    if (args.length === 2) {
      // Completing photon name after x
      const partial = args[1] || '';
      console.log(photonNames.filter(n => n.startsWith(partial)).join('\\n'));
      return;
    }
    // Completing method/command for a bundled photon
    const bundled = BUNDLED_PHOTONS[args[1]];
    if (bundled) {
      const methods = extractMethodsFromSource(bundled.source);
      const subArgs = args.slice(2);
      completeMethodArgs(methods, subArgs);
      return;
    }
    return;
  }

  // Completing args for main photon method
  const methods = extractMethodsFromSource(EMBEDDED_SOURCE);
  completeMethodArgs(methods, args);
}

function completeMethodArgs(methods: any[], args: string[]) {
  const META_COMMANDS = ['mcp', 'sse', 'beam', 'setup', 'app', 'x', '--help', '--version'];
  if (args.length <= 1) {
    const partial = args[0] || '';
    const names = [...methods.map((m: any) => m.name), ...META_COMMANDS];
    console.log(names.filter(n => n.startsWith(partial)).join('\\n'));
    return;
  }
  // Completing params for a known method
  const method = methods.find((m: any) => m.name === args[0]);
  if (method) {
    const partial = args[args.length - 1] || '';
    const usedParams = new Set(args.filter(a => a.startsWith('--')).map(a => a.replace(/^--/, '').split('=')[0]));
    const candidates = method.params
      .filter((p: any) => !usedParams.has(p.name))
      .map((p: any) => '--' + p.name);
    candidates.push('--help', '--json');
    console.log(candidates.filter((c: string) => c.startsWith(partial)).join('\\n'));
  }
}

function printUsage() {
  console.log('');
  console.log('Usage: ' + PHOTON_NAME + ' [command] [options]');
  console.log('');
  console.log('Commands:');
  console.log('  <method> [args]     Run a method directly (CLI mode)');
  console.log('  x <photon> [...]    Run a bundled photon (cross-platform)');
  console.log('  mcp                 Start MCP server (stdio transport)');
  console.log('  sse [port]          Start MCP server (HTTP/SSE transport)');
  console.log('  beam [port]         Start Beam web UI (SSE + browser)');
  console.log('  setup               Set up shell integration (aliases, completions)');
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
  let args = process.argv.slice(2);
  let command = args[0] || '';

  // Meta commands (no routing needed)
  if (command === 'setup') { await runSetup(); process.exit(0); }
  if (command === 'app') { await generateAppLaunchers(args.slice(1)); process.exit(0); }
  if (command === '--help' || command === '-h') { printUsage(); process.exit(0); }
  if (command === '--version' || command === '-v') { console.log(PHOTON_NAME); process.exit(0); }
  if (command === 'completions') { handleCompletions(args.slice(1)); process.exit(0); }

  // Load all photon modules (deferred to avoid top-level side effects blocking startup)
  await loadModules();

  // Resolve which bundled photon to serve
  let activeModule: any;
  let activeSource: string;
  let activeFilePath: string;

  if (command === 'x' && args[1]) {
    // Explicit routing: claw x whatsapp [command] [args...]
    const photonName = args[1];
    const bundled = BUNDLED_PHOTONS[photonName];
    if (!bundled) {
      const available = Object.keys(BUNDLED_PHOTONS).filter((v, i, a) => a.indexOf(v) === i).join(', ');
      console.error('Unknown photon: ' + photonName + '\\nBundled: ' + (available || '(none)'));
      process.exit(1);
    }
    activeModule = _depModules[bundled.depIndex];
    activeSource = bundled.source;
    activeFilePath = bundled.filePath;
    args = args.slice(2); // remaining args after x <photon>
    command = args[0] || '';
  } else {
    // Fallback: symlink/wrapper detection via $_ (Unix) or argv[0]
    const __path = await import('path');
    const invokedAs = __path.default.basename(process.env._ || process.argv[1] || process.execPath);
    const bundled = BUNDLED_PHOTONS[invokedAs];
    if (bundled) {
      activeModule = _depModules[bundled.depIndex];
      activeSource = bundled.source;
      activeFilePath = bundled.filePath;
    } else {
      activeModule = _mainModule;
      activeSource = EMBEDDED_SOURCE;
      activeFilePath = ${mainFilePathJson};
    }
  }

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

          // Create wrapper scripts for bundled @photon dependencies
          if (photonDeps.length > 0) {
            const outDir = path.dirname(path.resolve(outfile));
            const outName = path.basename(outfile);
            const createdWrappers: string[] = [];
            const seenNames = new Set<string>();

            for (const dep of photonDeps) {
              const depName = path.basename(dep.filePath, '.photon.ts').replace('.photon', '');
              if (seenNames.has(depName) || depName === outName) continue;
              // Skip if a directory with this name exists (e.g. whatsapp/ for storage)
              const existingPath = path.join(outDir, depName);
              try {
                if (fs.statSync(existingPath).isDirectory()) continue;
              } catch {}
              seenNames.add(depName);

              try {
                // Create Unix shell wrapper (unlink first to avoid following old symlinks)
                const scriptPath = path.join(outDir, depName);
                try {
                  fs.unlinkSync(scriptPath);
                } catch {}
                const scriptContent = `#!/bin/sh\nexec "$(dirname "$0")/${outName}" x ${depName} "$@"\n`;
                fs.writeFileSync(scriptPath, scriptContent, { mode: 0o755 });
                createdWrappers.push(depName);
              } catch {
                // Non-fatal — user can run `setup` later
              }
            }

            if (createdWrappers.length > 0) {
              console.log(`\n${chalk.dim('Wrappers (each routes to a bundled photon via `x`):')}`);
              for (const name of createdWrappers) {
                console.log(`  ${chalk.cyan(name)} → ${outfile} x ${name}`);
              }
            }
          }

          console.log(`\nUsage:`);
          console.log(`  ./${outfile}              CLI mode (list methods)`);
          console.log(`  ./${outfile} <method>     Run a method directly`);
          console.log(`  ./${outfile} x <photon>   Run a bundled photon`);
          console.log(`  ./${outfile} mcp          MCP server (stdio)`);
          console.log(`  ./${outfile} sse [port]   MCP server (HTTP/SSE)`);
          if (options.withApp) {
            console.log(`  ./${outfile} beam [port]  Beam web UI`);
          }
          console.log(`  ./${outfile} setup        Set up shell integration`);
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

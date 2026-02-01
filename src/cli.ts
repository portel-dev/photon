#!/usr/bin/env node

/**
 * Photon MCP CLI
 *
 * Command-line interface for running .photon.ts files as MCP servers
 */

import { Command } from 'commander';
import * as path from 'path';
import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import * as os from 'os';
import * as net from 'net';
import { PhotonServer } from './server.js';
import { FileWatcher } from './watcher.js';
import {
  resolvePhotonPath,
  listPhotonMCPs,
  ensureWorkingDir,
  DEFAULT_WORKING_DIR,
} from './path-resolver.js';
import { SchemaExtractor, ConstructorParam } from '@portel/photon-core';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

import { ProgressRenderer } from '@portel/photon-core';
import { getBundledPhotonPath, DEFAULT_BUNDLED_PHOTONS } from './shared-utils.js';
import { PHOTON_VERSION } from './version.js';
import { toEnvVarName } from './shared/config-docs.js';
import { renderSection } from './shared/cli-sections.js';
import { runTask } from './shared/task-runner.js';
import { LoggerOptions, normalizeLogLevel, logger } from './shared/logger.js';
import { printHeader, printInfo, printWarning, printError, printSuccess } from './cli-formatter.js';
import {
  handleError,
  wrapError,
  getErrorMessage,
  ExitCode,
  exitWithError,
} from './shared/error-handler.js';
import { validateOrThrow, inRange, isPositive, isInteger } from './shared/validation.js';
import { createReadline, promptText, promptWait } from './shared/cli-utils.js';
import { registerMarketplaceCommands } from './cli/commands/marketplace.js';
import { registerInfoCommand } from './cli/commands/info.js';
import { registerPackageCommands } from './cli/commands/package.js';
import { registerPackageAppCommand } from './cli/commands/package-app.js';

// ══════════════════════════════════════════════════════════════════════════════
// BUNDLED PHOTONS
// ══════════════════════════════════════════════════════════════════════════════

/** Bundled photon names that ship with the runtime */
// BUNDLED_PHOTONS and getBundledPhotonPath are imported from shared-utils.js

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
  // Check bundled photons first
  const bundledPath = getBundledPhotonPath(name, __dirname);
  if (bundledPath) {
    return bundledPath;
  }

  // Fall back to user photons
  return resolvePhotonPath(name, workingDir);
}

// ══════════════════════════════════════════════════════════════════════════════
// PORT UTILITIES
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

function getLogOptionsFromCommand(command: Command | null | undefined): LoggerOptions {
  const root = command?.parent?.opts?.() ?? program.opts();
  try {
    const level = normalizeLogLevel(root.logLevel);
    return {
      level,
      json: Boolean(root.jsonLogs),
    };
  } catch (error) {
    handleError(error, { exitOnError: true });
    throw error; // TypeScript doesn't know handleError exits
  }
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

function cliHeading(title: string): void {
  console.log('');
  printHeader(title);
}

function cliListItem(text: string): void {
  printInfo(`  ${text}`);
}

function cliSpacer(): void {
  console.log('');
}

function cliHint(message: string): void {
  printWarning(message);
}

// ══════════════════════════════════════════════════════════════════════════════
// ELICITATION HANDLERS
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Handle form-based elicitation (MCP-aligned)
 * Renders a multi-field form in CLI using readline
 */
async function handleFormElicitation(ask: {
  message: string;
  schema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}): Promise<{ action: 'accept' | 'decline' | 'cancel'; content?: any }> {
  cliHeading(`📝 ${ask.message}`);
  cliHint('Press Enter to accept defaults. Fields marked * are required.');
  cliSpacer();

  const rl = createReadline();

  const question = (prompt: string): Promise<string> => {
    return new Promise((resolve) => {
      rl.question(prompt, (answer) => resolve(answer));
    });
  };

  const result: Record<string, any> = {};
  const required = ask.schema.required || [];

  for (const [key, prop] of Object.entries(ask.schema.properties)) {
    const title = prop.title || key;
    const isRequired = required.includes(key);
    const reqMark = isRequired ? '*' : '';
    const defaultVal = prop.default !== undefined ? ` [${prop.default}]` : '';

    let value: any;

    // Handle different property types
    if (prop.type === 'boolean') {
      const answer = await question(`${title}${reqMark} (y/n)${defaultVal}: `);
      if (answer === '' && prop.default !== undefined) {
        value = prop.default;
      } else {
        value = answer.toLowerCase().startsWith('y');
      }
    } else if (prop.enum || prop.oneOf) {
      // Single select
      const options = prop.oneOf
        ? prop.oneOf.map((o: any) => ({ value: o.const, label: o.title }))
        : prop.enum.map((e: string) => ({ value: e, label: e }));

      printInfo(`${title}${reqMark}:`);
      options.forEach((opt: any, i: number) => {
        const isDefault = opt.value === prop.default ? ' (default)' : '';
        cliListItem(`${i + 1}. ${opt.label}${isDefault}`);
      });

      const answer = await question(`Choose (1-${options.length})${defaultVal}: `);
      const idx = parseInt(answer) - 1;
      if (idx >= 0 && idx < options.length) {
        value = options[idx].value;
      } else if (answer === '' && prop.default !== undefined) {
        value = prop.default;
      } else {
        value = options[0].value;
      }
    } else if (prop.type === 'array') {
      // Multi-select
      const items =
        prop.items?.anyOf || prop.items?.enum?.map((e: string) => ({ const: e, title: e }));
      if (items) {
        printInfo(`${title}${reqMark} (comma-separated numbers):`);
        items.forEach((item: any, i: number) => {
          const label = item.title || item.const || item;
          cliListItem(`${i + 1}. ${label}`);
        });

        const answer = await question('Choose: ');
        const indices = answer.split(',').map((s: string) => parseInt(s.trim()) - 1);
        value = indices
          .filter((idx: number) => idx >= 0 && idx < items.length)
          .map((idx: number) => items[idx].const || items[idx]);

        if (value.length === 0 && prop.default) {
          value = prop.default;
        }
      } else {
        value = prop.default || [];
      }
    } else if (prop.type === 'number' || prop.type === 'integer') {
      const answer = await question(`${title}${reqMark}${defaultVal}: `);
      if (answer === '' && prop.default !== undefined) {
        value = prop.default;
      } else {
        value = prop.type === 'integer' ? parseInt(answer) : parseFloat(answer);
        if (isNaN(value)) value = prop.default ?? 0;
      }
    } else {
      // String or default
      const format = prop.format ? ` (${prop.format})` : '';
      const answer = await question(`${title}${reqMark}${format}${defaultVal}: `);
      value = answer || prop.default || '';
    }

    result[key] = value;
    cliSpacer();
  }

  rl.close();
  cliSpacer();

  return { action: 'accept', content: result };
}

/**
 * Handle URL-based elicitation (OAuth flows)
 * Opens URL in browser and waits for user confirmation
 */
async function handleUrlElicitation(ask: {
  message: string;
  url: string;
}): Promise<{ action: 'accept' | 'decline' | 'cancel' }> {
  cliHeading(`🔗 ${ask.message}`);
  printInfo(`URL: ${ask.url}`);
  cliHint('Opening your default browser...');
  cliSpacer();

  // Open URL in default browser
  const platform = process.platform;
  const openCommand = platform === 'darwin' ? 'open' : platform === 'win32' ? 'start' : 'xdg-open';

  try {
    const { exec } = await import('child_process');
    exec(`${openCommand} "${ask.url}"`);
  } catch (error) {
    cliHint('Please open the URL manually in your browser.');
  }

  const shouldContinue = await promptWait('Press Enter when done', true);
  return { action: shouldContinue ? 'accept' : 'cancel' };
}

/**
 * Handle select elicitation with options
 */
async function handleSelectElicitation(ask: {
  message: string;
  options: Array<string | { value: string; label: string; description?: string }>;
  multi?: boolean;
  default?: string | string[];
}): Promise<string | string[]> {
  cliHeading(ask.message);

  const options = ask.options.map((opt) =>
    typeof opt === 'string' ? { value: opt, label: opt } : opt
  );

  options.forEach((opt, i) => {
    const isDefault =
      ask.default === opt.value || (Array.isArray(ask.default) && ask.default.includes(opt.value));
    const defaultMark = isDefault ? ' ✓' : '';
    const desc = opt.description ? ` - ${opt.description}` : '';
    cliListItem(`${i + 1}. ${opt.label}${desc}${defaultMark}`);
  });
  cliSpacer();

  const rl = createReadline();
  const prompt = ask.multi
    ? `Choose (comma-separated, 1-${options.length}): `
    : `Choose (1-${options.length}): `;

  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();

      if (ask.multi) {
        if (answer.trim() === '') {
          resolve(Array.isArray(ask.default) ? ask.default : []);
        } else {
          const indices = answer.split(',').map((s) => parseInt(s.trim()) - 1);
          const values = indices
            .filter((idx) => idx >= 0 && idx < options.length)
            .map((idx) => options[idx].value);
          resolve(values);
        }
      } else {
        const idx = parseInt(answer) - 1;
        if (idx >= 0 && idx < options.length) {
          resolve(options[idx].value);
        } else if (answer.trim() === '' && ask.default) {
          resolve(ask.default as string);
        } else {
          resolve(options[0].value);
        }
      }
    });
  });
}

/**
 * Extract constructor parameters from a Photon MCP file
 */
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
 * Ensure .gitignore includes marketplace template directory
 */
async function ensureGitignore(workingDir: string): Promise<void> {
  const gitignorePath = path.join(workingDir, '.gitignore');
  const templatesPattern = '.marketplace/_templates/';

  try {
    let gitignoreContent = '';

    if (existsSync(gitignorePath)) {
      gitignoreContent = await fs.readFile(gitignorePath, 'utf-8');
    }

    // Check if pattern already exists
    if (gitignoreContent.includes(templatesPattern)) {
      return; // Already configured
    }

    // Add templates pattern to .gitignore
    const newContent = gitignoreContent.endsWith('\n')
      ? gitignoreContent + templatesPattern + '\n'
      : gitignoreContent + '\n' + templatesPattern + '\n';

    await fs.writeFile(gitignorePath, newContent, 'utf-8');
    console.error('   ✓ Added .marketplace/_templates/ to .gitignore');
  } catch (error) {
    // Non-fatal - just warn
    console.error(`   ⚠ Could not update .gitignore: ${getErrorMessage(error)}`);
  }
}

/**
 * Perform marketplace sync - generates documentation files
 */
async function performMarketplaceSync(
  dirPath: string,
  options: { name?: string; description?: string; owner?: string; filterInstalled?: boolean }
): Promise<void> {
  const resolvedPath = path.resolve(dirPath);
  const isDefaultDir = resolvedPath === DEFAULT_WORKING_DIR;

  if (!existsSync(resolvedPath)) {
    exitWithError(`Directory not found: ${resolvedPath}`, {
      exitCode: ExitCode.NOT_FOUND,
      suggestion: 'Check the path and ensure the directory exists',
    });
  }

  // Scan for .photon.ts files
  console.error('📦 Scanning for .photon.ts files...');
  const files = await fs.readdir(resolvedPath);
  let photonFiles = files.filter((f) => f.endsWith('.photon.ts'));

  // Filter out installed photons if requested (for ~/.photon)
  if (options.filterInstalled && isDefaultDir) {
    const { readLocalMetadata } = await import('./marketplace-manager.js');
    const metadata = await readLocalMetadata();
    // Metadata keys may include .photon.ts extension
    const installedNames = new Set(
      Object.keys(metadata.photons || {}).map((k) => k.replace(/\.photon\.ts$/, ''))
    );

    const originalCount = photonFiles.length;
    photonFiles = photonFiles.filter((f) => {
      const name = f.replace(/\.photon\.ts$/, '');
      return !installedNames.has(name);
    });

    if (originalCount !== photonFiles.length) {
      console.error(`   Filtered out ${originalCount - photonFiles.length} installed photons`);
    }
  }

  if (photonFiles.length === 0) {
    exitWithError(`No .photon.ts files found`, {
      exitCode: ExitCode.NOT_FOUND,
      searchedIn: resolvedPath,
      suggestion: "Create a .photon.ts file or use 'photon maker new' to generate one",
    });
  }

  console.error(`   Found ${photonFiles.length} photons\n`);

  // Initialize template manager
  const { TemplateManager } = await import('./template-manager.js');
  const templateMgr = new TemplateManager(resolvedPath);

  console.error('📝 Ensuring templates...');
  await templateMgr.ensureTemplates();

  // Ensure .gitignore excludes templates
  await ensureGitignore(resolvedPath);

  console.error('');

  // Extract metadata from each Photon
  console.error('📄 Extracting documentation...');
  const { calculateFileHash } = await import('./marketplace-manager.js');
  const { PhotonDocExtractor } = await import('./photon-doc-extractor.js');

  const photons: any[] = [];

  for (const file of photonFiles.sort()) {
    const filePath = path.join(resolvedPath, file);

    // Extract full metadata
    const extractor = new PhotonDocExtractor(filePath);
    const metadata = await extractor.extractFullMetadata();

    // Calculate hash
    const hash = await calculateFileHash(filePath);

    console.error(`   ✓ ${metadata.name} (${metadata.tools?.length || 0} tools)`);

    // Build manifest entry
    photons.push({
      name: metadata.name,
      version: metadata.version,
      description: metadata.description,
      author: metadata.author || options.owner || 'Unknown',
      license: metadata.license || 'MIT',
      repository: metadata.repository,
      homepage: metadata.homepage,
      source: `../${file}`,
      hash,
      tools: metadata.tools?.map((t) => t.name),
      assets: metadata.assets,
      photonType: metadata.photonType,
      features: metadata.features,
    });

    // Generate individual photon documentation
    const photonMarkdown = await templateMgr.renderTemplate('photon.md', metadata);
    const docPath = path.join(resolvedPath, `${metadata.name}.md`);
    await fs.writeFile(docPath, photonMarkdown, 'utf-8');
  }

  // Create manifest
  console.error('\n📋 Updating manifest...');
  const baseName = path.basename(resolvedPath);
  const marketplaceDir = path.join(resolvedPath, '.marketplace');
  await fs.mkdir(marketplaceDir, { recursive: true });
  const manifestPath = path.join(marketplaceDir, 'photons.json');

  // Read existing manifest to preserve owner if not explicitly provided
  let existingOwner: { name: string; email?: string; url?: string } | undefined;
  if (existsSync(manifestPath) && !options.owner) {
    try {
      const existingManifest = JSON.parse(await fs.readFile(manifestPath, 'utf-8'));
      existingOwner = existingManifest.owner;
    } catch {
      // Ignore parse errors
    }
  }

  const manifest = {
    name: options.name || baseName,
    version: PHOTON_VERSION,
    description: options.description || undefined,
    owner: options.owner
      ? {
          name: options.owner,
        }
      : existingOwner,
    photons,
  };
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
  console.error('   ✓ .marketplace/photons.json');

  // Sync README with generated content
  console.error('\n📖 Syncing README.md...');
  const { ReadmeSyncer } = await import('./readme-syncer.js');
  const readmePath = path.join(resolvedPath, 'README.md');
  const syncer = new ReadmeSyncer(readmePath);

  // Render README section from template
  const readmeContent = await templateMgr.renderTemplate('readme.md', {
    marketplaceName: manifest.name,
    marketplaceDescription: manifest.description || '',
    photons: photons.map((p) => ({
      name: p.name,
      description: p.description,
      version: p.version,
      license: p.license,
      tools: p.tools || [],
      photonType: p.photonType || 'api',
      features: p.features || [],
    })),
  });

  const isUpdate = await syncer.sync(readmeContent);
  if (isUpdate) {
    console.error('   ✓ README.md synced (user content preserved)');
  } else {
    console.error('   ✓ README.md created');
  }

  console.error('\n✅ Marketplace synced successfully!');
  console.error(`\n   Marketplace: ${manifest.name}`);
  console.error(`   Photons: ${photons.length}`);
  console.error(`   Documentation: ${photons.length} markdown files generated`);
  console.error(`\n   Generated files:`);
  console.error(`   • .marketplace/photons.json (manifest)`);
  console.error(`   • *.md (${photons.length} documentation files at root)`);
  console.error(`   • README.md (auto-generated table)`);
}

/**
 * Initialize a marketplace with git hooks
 */
async function performMarketplaceInit(
  dirPath: string,
  options: { name?: string; description?: string; owner?: string }
): Promise<void> {
  const absolutePath = path.resolve(dirPath);

  // Check if directory exists
  if (!existsSync(absolutePath)) {
    await fs.mkdir(absolutePath, { recursive: true });
    console.error(`📁 Created directory: ${absolutePath}`);
  }

  // Check if it's a git repository
  const gitDir = path.join(absolutePath, '.git');
  if (!existsSync(gitDir)) {
    exitWithError('Not a git repository', {
      exitCode: ExitCode.CONFIG_ERROR,
      searchedIn: absolutePath,
      suggestion: 'Initialize with: git init',
    });
  }

  // Create .githooks directory
  const hooksDir = path.join(absolutePath, '.githooks');
  await fs.mkdir(hooksDir, { recursive: true });

  // Create pre-commit hook
  const preCommitHook = `#!/bin/bash
# Pre-commit hook: Auto-sync marketplace manifest before commit
# This ensures .marketplace/photons.json and .claude-plugin/ are always up-to-date

# Check if any .photon.ts files or marketplace files are being committed
if git diff --cached --name-only | grep -qE '\\.photon\\.ts$|\\.marketplace/|\\.claude-plugin/'; then
  echo "🔄 Syncing marketplace manifest..."

  # Run photon maker sync with --claude-code to generate plugin files
  if photon maker sync --dir . --claude-code; then
    # Stage the generated files
    git add .marketplace/photons.json README.md *.md .claude-plugin/ 2>/dev/null
    echo "✅ Marketplace and Claude Code plugin synced and staged"
  else
    echo "❌ Failed to sync marketplace"
    exit 1
  fi
fi

exit 0
`;

  const preCommitPath = path.join(hooksDir, 'pre-commit');
  await fs.writeFile(preCommitPath, preCommitHook, { mode: 0o755 });
  console.error('✅ Created .githooks/pre-commit');

  // Create setup script
  const setupScript = `#!/bin/bash
# Setup script to install git hooks for this marketplace

REPO_ROOT="$(git rev-parse --show-toplevel)"
HOOKS_DIR="$REPO_ROOT/.git/hooks"
SOURCE_HOOKS="$REPO_ROOT/.githooks"

echo "🔧 Installing git hooks for Photon marketplace..."

# Copy pre-commit hook
if [ -f "$SOURCE_HOOKS/pre-commit" ]; then
  cp "$SOURCE_HOOKS/pre-commit" "$HOOKS_DIR/pre-commit"
  chmod +x "$HOOKS_DIR/pre-commit"
  echo "✅ Installed pre-commit hook (auto-syncs marketplace manifest)"
else
  echo "❌ pre-commit hook not found"
  exit 1
fi

echo ""
echo "✅ Git hooks installed successfully!"
echo ""
echo "The pre-commit hook will automatically run 'photon maker sync'"
echo "whenever you commit changes to .photon.ts files."
`;

  const setupPath = path.join(hooksDir, 'setup.sh');
  await fs.writeFile(setupPath, setupScript, { mode: 0o755 });
  console.error('✅ Created .githooks/setup.sh');

  // Install hooks to .git/hooks
  const gitHooksDir = path.join(absolutePath, '.git', 'hooks');
  const gitPreCommitPath = path.join(gitHooksDir, 'pre-commit');
  await fs.writeFile(gitPreCommitPath, preCommitHook, { mode: 0o755 });
  console.error('✅ Installed hooks to .git/hooks');

  // Create .marketplace directory
  const marketplaceDir = path.join(absolutePath, '.marketplace');
  await fs.mkdir(marketplaceDir, { recursive: true });
  console.error('✅ Created .marketplace directory');

  // Run initial sync (don't filter installed for marketplace repos)
  console.error('\n🔄 Running initial marketplace sync...\n');
  await performMarketplaceSync(absolutePath, options);

  console.error('\n✅ Marketplace initialized successfully!');
  console.error('\nNext steps:');
  console.error('1. Add your .photon.ts files to this directory');
  console.error('2. Commit your changes (hooks will auto-sync)');
  console.error('3. Push to GitHub to share your marketplace');
  console.error('\nContributors can setup hooks with:');
  console.error('  bash .githooks/setup.sh');
}

/**
 * Format default value for display in config
 */
function formatDefaultValue(value: any): string {
  if (typeof value === 'string') {
    // Check if it's a function call expression
    if (value.includes('homedir()')) {
      // Replace homedir() with actual home directory
      // Handle both path.join() and join()
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
  // For other complex expressions
  return String(value);
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
    // On Windows, use APPDATA if available, otherwise fall back to home/AppData/Roaming
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    return path.join(appData, 'Claude', 'claude_desktop_config.json');
  } else {
    // Linux/other
    return path.join(home, '.config/Claude/claude_desktop_config.json');
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
  workingDir: string = DEFAULT_WORKING_DIR
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

  const needsWorkingDir = workingDir !== DEFAULT_WORKING_DIR;
  const config = {
    mcpServers: {
      [mcpName]: {
        command: 'npx',
        args: needsWorkingDir
          ? ['@portel/photon', 'mcp', mcpName, '--dir', workingDir]
          : ['@portel/photon', 'mcp', mcpName],
        env: envExample,
      },
    },
  };

  console.log(JSON.stringify(config, null, 2));
  cliSpacer();
  cliHint(`Add this to: ${getConfigPath()}`);
  cliHint(`Validate with: photon mcp ${mcpName} --validate`);
}

const version = PHOTON_VERSION;

const program = new Command();

program
  .name('photon')
  .description('Universal runtime for single-file TypeScript programs')
  .version(version)
  .option('--dir <path>', 'Photon directory (default: ~/.photon)', DEFAULT_WORKING_DIR)
  .option('--log-level <level>', 'Set log verbosity (error|warn|info|debug)', 'info')
  .option('--json-logs', 'Emit newline-delimited JSON logs for runtime output')
  .configureHelp({
    sortSubcommands: false,
    sortOptions: false,
  })
  .addHelpText(
    'after',
    `
Runtime Commands:
  mcp <name>              Run a photon as MCP server (for AI assistants)
  cli <photon> [method]   Run photon methods from command line
  sse <name>              Run Photon as HTTP server with SSE transport
  beam                    Launch Photon Beam (interactive control panel)
  serve                   Start local multi-tenant MCP hosting for development

Hosting:
  host <command>          Manage cloud hosting (preview, deploy)

Package Management:
  add <name>              Install a photon from marketplace
  remove <name>           Remove an installed photon
  upgrade [name]          Upgrade photon(s) to latest version
  search <query>          Search marketplaces for photons
  info [name]             Show installed photons and details

Maintenance:
  update                  Refresh marketplace indexes & check CLI version
  doctor [name]           Diagnose environment and installations

Development:
  maker new <name>        Create a new photon from template
  maker validate <name>   Validate photon syntax and schemas
  maker sync              Generate marketplace manifest
  maker init              Initialize marketplace with git hooks

Advanced:
  marketplace             Manage marketplace sources
  alias <photon>          Create CLI shortcuts for photons

Run 'photon <command> --help' for detailed usage.
`
  );

// Update command: refresh marketplace indexes and check for CLI updates
program
  .command('update', { hidden: true })
  .description('Update marketplace indexes and check for CLI updates')
  .action(async () => {
    try {
      const { printInfo, printSuccess, printWarning, printHeader } =
        await import('./cli-formatter.js');
      const { MarketplaceManager } = await import('./marketplace-manager.js');
      const manager = new MarketplaceManager();
      await manager.initialize();

      const results = await runTask('Refreshing marketplace indexes', async () => {
        return manager.updateAllCaches();
      });

      console.log('');
      const entries = Array.from(results.entries());
      let successCount = 0;
      for (const [marketplaceName, success] of entries) {
        if (success) {
          printSuccess(marketplaceName);
          successCount++;
        } else {
          printWarning(`${marketplaceName} (no manifest)`);
        }
      }
      printInfo(`\nUpdated ${successCount}/${entries.length} marketplaces`);

      let latestVersion: string | null = null;
      try {
        latestVersion = await runTask('Checking for Photon CLI updates', async () => {
          const { execSync } = await import('child_process');
          return execSync('npm view @portel/photon version', {
            encoding: 'utf-8',
            timeout: 10000,
          }).trim();
        });
      } catch {
        printWarning('\nCould not check for CLI updates');
      }

      if (latestVersion) {
        console.log('');
        if (latestVersion !== version) {
          printHeader('Update available');
          printWarning(`Current: ${version}`);
          printInfo(`Latest:  ${latestVersion}`);
          printInfo(`Update with: npm install -g @portel/photon`);
        } else {
          printSuccess(`Photon CLI is up to date (${version})`);
        }
      }
    } catch (error) {
      const { printError } = await import('./cli-formatter.js');
      printError(getErrorMessage(error));
      process.exit(1);
    }
  });

// MCP Runtime: run a .photon.ts file as MCP server
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
      const workingDir = program.opts().dir || DEFAULT_WORKING_DIR;
      const logOptions = getLogOptionsFromCommand(command);

      // Resolve file path - check bundled photons first, then user directory
      let filePath = await resolvePhotonPathWithBundled(name, workingDir);

      // Auto-install from marketplace if not found locally
      let unresolvedPhoton: import('./server.js').UnresolvedPhoton | undefined;

      if (!filePath) {
        const { MarketplaceManager, calculateHash } = await import('./marketplace-manager.js');
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

          // Ensure working directory exists and save
          await ensureWorkingDir(workingDir);
          const targetPath = path.join(workingDir, `${name}.photon.ts`);
          await fs.writeFile(targetPath, result.content, 'utf-8');

          // Save metadata
          if (source.metadata) {
            const contentHash = calculateHash(result.content);
            await manager.savePhotonMetadata(
              `${name}.photon.ts`,
              source.marketplace,
              source.metadata,
              contentHash
            );

            // Download assets
            if (source.metadata.assets && source.metadata.assets.length > 0) {
              const assets = await manager.fetchAssets(source.marketplace, source.metadata.assets);
              for (const [assetPath, content] of assets) {
                const assetTarget = path.join(workingDir, assetPath);
                const assetDir = path.dirname(assetTarget);
                await fs.mkdir(assetDir, { recursive: true });
                await fs.writeFile(assetTarget, content, 'utf-8');
              }
            }
          }

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
          exitWithError(`Cannot validate: ${name} has multiple sources. Install it first with 'photon add ${name}'.`, {
            exitCode: ExitCode.CONFIG_ERROR,
          });
        }
        await validateConfiguration(filePath, name);
        return;
      }

      // Handle --config flag
      if (options.config) {
        if (!filePath) {
          exitWithError(`Cannot show config: ${name} has multiple sources. Install it first with 'photon add ${name}'.`, {
            exitCode: ExitCode.CONFIG_ERROR,
          });
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

      // Start MCP server
      const server = new PhotonServer({
        filePath: filePath || '', // empty when unresolved — server handles it
        devMode: options.dev,
        transport,
        port: parseInt(options.port, 10),
        logOptions: { ...logOptions, scope: transport },
        unresolvedPhoton,
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

// SSE command: quick SSE server with auto port detection (formerly serve)
program
  .command('sse', { hidden: true })
  .argument('<name>', 'Photon name (without .photon.ts extension)')
  .option('-p, --port <number>', 'Port to start from (auto-finds available)', '3000')
  .option('--dev', 'Enable development mode with hot reload')
  .description('Run Photon as HTTP server with SSE transport (auto port detection)')
  .action(async (name: string, options: any, command: Command) => {
    try {
      // Get working directory from global options
      const workingDir = program.opts().dir || DEFAULT_WORKING_DIR;
      const logOptions = getLogOptionsFromCommand(command);

      // Resolve file path from name
      const filePath = await resolvePhotonPath(name, workingDir);

      if (!filePath) {
        exitWithError(`Photon not found: ${name}`, {
          exitCode: ExitCode.NOT_FOUND,
          searchedIn: workingDir,
          suggestion: "Use 'photon info' to see available photons",
        });
      }

      // Find available port
      const startPort = parseInt(options.port, 10);
      const port = await findAvailablePort(startPort);

      if (port !== startPort) {
        console.error(`⚠️  Port ${startPort} is in use, using ${port} instead\n`);
      }

      // Start SSE server
      const server = new PhotonServer({
        filePath,
        devMode: options.dev,
        transport: 'sse',
        port,
        logOptions: { ...logOptions, scope: 'sse' },
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

      // Start file watcher in dev mode
      if (options.dev) {
        const watcher = new FileWatcher(server, filePath, server.createScopedLogger('watcher'));
        watcher.start();

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

// Beam command: interactive UI for all photons
program
  .command('beam', { hidden: true })
  .option('-p, --port <number>', 'Port to start from (auto-finds available)', '3000')
  .option('-o, --open', 'Auto-open browser after starting')
  .option('--no-open', 'Do not auto-open browser')
  .description('Launch Photon Beam - interactive control panel for all your photons')
  .action(async (options: any, command: Command) => {
    try {
      // Get working directory from global options
      const workingDir = program.opts().dir || DEFAULT_WORKING_DIR;

      // Find available port
      const startPort = parseInt(options.port, 10);
      const port = await findAvailablePort(startPort);

      if (port !== startPort) {
        console.error(`⚠️  Port ${startPort} is in use, using ${port} instead\n`);
      }

      // Import and start Beam server
      const { startBeam } = await import('./auto-ui/beam.js');
      await startBeam(workingDir, port);

      // Auto-open browser if requested
      if (options.open) {
        const url = `http://localhost:${port}`;
        const { exec } = await import('child_process');
        const openCmd =
          process.platform === 'darwin'
            ? 'open'
            : process.platform === 'win32'
              ? 'start'
              : 'xdg-open';
        exec(`${openCmd} ${url}`, (err) => {
          if (err) logger.debug(`Could not auto-open browser: ${err.message}`);
        });
      }

      // Handle shutdown signals
      const shutdown = () => {
        console.error('\nShutting down Photon Beam...');
        process.exit(0);
      };

      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
    } catch (error) {
      logger.error(`Error: ${getErrorMessage(error)}`);
      process.exit(1);
    }
  });

// Serve command: multi-tenant MCP hosting (formerly serv)
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
      const { createLocalServ, getTestToken } = await import('./serv/local.js');
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

// Host command: manage hosting and deployment (preview, deploy)
const host = program
  .command('host', { hidden: true })
  .description('Manage cloud hosting and deployment');

host
  .command('preview')
  .argument('<target>', 'Deployment target: cloudflare (or cf)')
  .argument('<name>', 'Photon name (without .photon.ts extension)')
  .option('--output <dir>', 'Output directory for generated project')
  .description('Run Photon locally in a simulated deployment environment')
  .action(async (target: string, name: string, options: any) => {
    try {
      // Get working directory from global options
      const workingDir = program.opts().dir || DEFAULT_WORKING_DIR;

      // Resolve file path from name
      const photonPath = await resolvePhotonPath(name, workingDir);

      if (!photonPath) {
        logger.error(`Photon not found: ${name}`);
        console.error(`Searched in: ${workingDir}`);
        console.error(`Tip: Use 'photon info' to see available photons`);
        process.exit(1);
      }

      const normalizedTarget = target.toLowerCase();

      if (normalizedTarget === 'cloudflare' || normalizedTarget === 'cf') {
        const { devCloudflare } = await import('./deploy/cloudflare.js');
        await devCloudflare({
          photonPath,
          outputDir: options.output,
        });
      } else {
        logger.error(`Unknown target: ${target}`);
        console.error('Supported targets: cloudflare (cf)');
        process.exit(1);
      }
    } catch (error) {
      logger.error(`Error: ${getErrorMessage(error)}`);
      process.exit(1);
    }
  });

host
  .command('deploy')
  .argument('<target>', 'Deployment target: cloudflare (or cf)')
  .argument('<name>', 'Photon name (without .photon.ts extension)')
  .option('--dev', 'Enable Beam UI in deployment')
  .option('--dry-run', 'Generate project without deploying')
  .option('--output <dir>', 'Output directory for generated project')
  .description('Deploy a Photon to cloud platforms')
  .action(async (target: string, name: string, options: any) => {
    try {
      // Get working directory from global options
      const workingDir = program.opts().dir || DEFAULT_WORKING_DIR;

      // Resolve file path from name
      const photonPath = await resolvePhotonPath(name, workingDir);

      if (!photonPath) {
        logger.error(`Photon not found: ${name}`);
        console.error(`Searched in: ${workingDir}`);
        console.error(`Tip: Use 'photon info' to see available photons`);
        process.exit(1);
      }

      const normalizedTarget = target.toLowerCase();

      if (normalizedTarget === 'cloudflare' || normalizedTarget === 'cf') {
        const { deployToCloudflare } = await import('./deploy/cloudflare.js');
        await deployToCloudflare({
          photonPath,
          devMode: options.dev,
          dryRun: options.dryRun,
          outputDir: options.output,
        });
      } else {
        logger.error(`Unknown deployment target: ${target}`);
        console.error('Supported targets: cloudflare (cf)');
        process.exit(1);
      }
    } catch (error) {
      logger.error(`Deployment failed: ${getErrorMessage(error)}`);
      process.exit(1);
    }
  });

// Search command: search for MCPs across marketplaces
program
  .command('search', { hidden: true })
  .argument('<query>', 'MCP name or keyword to search for')
  .description('Search for MCP in all enabled marketplaces')
  .action(async (query: string) => {
    try {
      const { MarketplaceManager } = await import('./marketplace-manager.js');
      const { formatOutput, printInfo, printError } = await import('./cli-formatter.js');
      const manager = new MarketplaceManager();
      await manager.initialize();

      // Auto-update stale caches
      const updated = await manager.autoUpdateStaleCaches();
      if (updated) {
        printInfo('Refreshed marketplace data...\n');
      }

      printInfo(`Searching for '${query}' in marketplaces...`);

      const results = await manager.search(query);

      if (results.size === 0) {
        printError(`No results found for '${query}'`);
        printInfo(`Tip: Run 'photon marketplace update' to manually refresh marketplace data`);
        return;
      }

      // Build table data from search results
      const tableData: any[] = [];
      for (const [mcpName, entries] of results) {
        for (const entry of entries) {
          tableData.push({
            name: mcpName,
            version: entry.metadata?.version || PHOTON_VERSION,
            description: entry.metadata?.description
              ? entry.metadata.description.substring(0, 50) +
                (entry.metadata.description.length > 50 ? '...' : '')
              : '-',
            marketplace: entry.marketplace.name,
          });
        }
      }

      console.log('');
      formatOutput(tableData, 'table');
      printInfo(`\nInstall with: photon add <name>`);
    } catch (error) {
      const { printError } = await import('./cli-formatter.js');
      printError(getErrorMessage(error));
      process.exit(1);
    }
  });

// Maker command: commands for photon creators/publishers
const maker = program
  .command('maker', { hidden: true })
  .description('Commands for creating photons and marketplaces');

// maker new: create a new photon from template
maker
  .command('new')
  .argument('<name>', 'Name for the new photon')
  .description('Create a new photon from template')
  .action(async (name: string, options: any, command: Command) => {
    try {
      // Get working directory from global options
      const workingDir = program.opts().dir || DEFAULT_WORKING_DIR;

      // Ensure working directory exists
      await ensureWorkingDir(workingDir);

      const fileName = `${name}.photon.ts`;
      const filePath = path.join(workingDir, fileName);

      // Check if file already exists
      try {
        await fs.access(filePath);
        logger.error(`File already exists: ${filePath}`);
        process.exit(1);
      } catch {
        // File doesn't exist, good
      }

      // Read template
      const templatePath = path.join(__dirname, '..', 'templates', 'photon.template.ts');
      let template: string;

      try {
        template = await fs.readFile(templatePath, 'utf-8');
      } catch {
        // Fallback inline template if file not found
        template = getInlineTemplate();
      }

      // Replace placeholders
      // Convert kebab-case to PascalCase for class name
      const className = name
        .split(/[-_]/)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join('');
      const content = template.replace(/TemplateName/g, className).replace(/template-name/g, name);

      // Write file
      await fs.writeFile(filePath, content, 'utf-8');

      console.error(`✅ Created ${fileName} in ${workingDir}`);
      console.error(`Run with: photon mcp ${name} --dev`);
    } catch (error) {
      logger.error(`Error: ${getErrorMessage(error)}`);
      process.exit(1);
    }
  });

// maker validate: validate photon syntax and schemas
maker
  .command('validate')
  .argument('<name>', 'Photon name (without .photon.ts extension)')
  .description('Validate photon syntax and schemas')
  .action(async (name: string, options: any, command: Command) => {
    try {
      // Get working directory from global options
      const workingDir = program.opts().dir || DEFAULT_WORKING_DIR;

      // Resolve file path from name in working directory
      const filePath = await resolvePhotonPath(name, workingDir);

      if (!filePath) {
        exitWithError(`Photon not found: ${name}`, {
          exitCode: ExitCode.NOT_FOUND,
          searchedIn: workingDir,
          suggestion: "Use 'photon info' to see available photons",
        });
      }

      console.error(`Validating ${path.basename(filePath)}...\n`);

      // Import loader and try to load
      const { PhotonLoader } = await import('./loader.js');
      const loader = new PhotonLoader(false); // quiet mode for inspection

      const mcp = await loader.loadFile(filePath);

      console.error(`✅ Valid Photon`);
      console.error(`Name: ${mcp.name}`);
      console.error(`Tools: ${mcp.tools.length}`);

      for (const tool of mcp.tools) {
        console.error(`  - ${tool.name}: ${tool.description}`);
      }

      process.exit(0);
    } catch (error) {
      logger.error(`Validation failed: ${getErrorMessage(error)}`);
      process.exit(1);
    }
  });

// maker sync: generate marketplace manifest
maker
  .command('sync')
  .option('--dir <path>', 'Directory to sync (defaults to current directory)')
  .option('--name <name>', 'Marketplace name')
  .option('--description <desc>', 'Marketplace description')
  .option('--owner <owner>', 'Owner name')
  .option('--claude-code', 'Generate Claude Code plugin files')
  .description('Generate marketplace manifest and documentation from your photons')
  .action(async (options: any) => {
    try {
      const dirPath = options.dir || '.';
      const resolvedPath = path.resolve(dirPath);
      // Only filter installed photons when syncing ~/.photon
      const filterInstalled = resolvedPath === DEFAULT_WORKING_DIR;
      await performMarketplaceSync(dirPath, { ...options, filterInstalled });

      // Generate Claude Code plugin if requested
      if (options.claudeCode) {
        const { generateClaudeCodePlugin } = await import('./claude-code-plugin.js');
        await generateClaudeCodePlugin(dirPath, options);
      }
    } catch (error) {
      logger.error(`Error: ${getErrorMessage(error)}`);
      if (process.env.DEBUG && error instanceof Error) {
        console.error(error.stack);
      }
      process.exit(1);
    }
  });

maker
  .command('init')
  .option('--dir <path>', 'Directory to initialize (defaults to current directory)')
  .option('--name <name>', 'Marketplace name')
  .option('--description <desc>', 'Marketplace description')
  .option('--owner <owner>', 'Owner name')
  .description('Initialize a directory as a Photon marketplace with git hooks')
  .action(async (options: any) => {
    try {
      const dirPath = options.dir || '.';
      await performMarketplaceInit(dirPath, options);
    } catch (error) {
      logger.error(`Error: ${getErrorMessage(error)}`);
      if (process.env.DEBUG && error instanceof Error) {
        console.error(error.stack);
      }
      process.exit(1);
    }
  });

// maker diagram: generate Mermaid diagram for a Photon
maker
  .command('diagram <photon>')
  .option('--dir <path>', 'Directory containing photon (defaults to current directory)')
  .description('Generate Mermaid diagram for a Photon')
  .action(async (photonName: string, options: any) => {
    try {
      const { PhotonDocExtractor } = await import('./photon-doc-extractor.js');

      // Resolve photon path
      const dirPath = options.dir || '.';
      let photonPath = photonName;

      // If not a path, look in the directory
      if (!photonName.includes('/') && !photonName.includes('\\')) {
        if (!photonName.endsWith('.photon.ts')) {
          photonName = `${photonName}.photon.ts`;
        }
        photonPath = path.resolve(dirPath, photonName);
      } else {
        photonPath = path.resolve(photonName);
      }

      if (!existsSync(photonPath)) {
        logger.error(`Photon not found: ${photonPath}`);
        process.exit(1);
      }

      const extractor = new PhotonDocExtractor(photonPath);
      const diagram = await extractor.generateDiagram();

      // Output just the diagram (can be piped or copied)
      console.log(diagram);
    } catch (error) {
      logger.error(`Error: ${getErrorMessage(error)}`);
      if (process.env.DEBUG && error instanceof Error) {
        console.error(error.stack);
      }
      process.exit(1);
    }
  });

// maker diagrams: generate Mermaid diagrams for all Photons in a directory
maker
  .command('diagrams')
  .option('--dir <path>', 'Directory to scan (defaults to current directory)')
  .description('Generate Mermaid diagrams for all Photons in a directory')
  .action(async (options: any) => {
    try {
      const { PhotonDocExtractor } = await import('./photon-doc-extractor.js');

      const dirPath = path.resolve(options.dir || '.');
      const files = await fs.readdir(dirPath);
      const photonFiles = files.filter((f) => f.endsWith('.photon.ts'));

      if (photonFiles.length === 0) {
        console.error('No .photon.ts files found');
        process.exit(1);
      }

      console.error(`📦 Found ${photonFiles.length} photons\n`);

      for (const file of photonFiles) {
        const photonPath = path.join(dirPath, file);
        const name = file.replace('.photon.ts', '');

        try {
          const extractor = new PhotonDocExtractor(photonPath);
          const diagram = await extractor.generateDiagram();

          console.log(`## ${name}\n`);
          console.log('```mermaid');
          console.log(diagram);
          console.log('```\n');
        } catch (err: any) {
          console.error(`⚠️  Failed to generate diagram for ${name}: ${err.message}`);
        }
      }
    } catch (error) {
      logger.error(`Error: ${getErrorMessage(error)}`);
      if (process.env.DEBUG && error instanceof Error) {
        console.error(error.stack);
      }
      process.exit(1);
    }
  });

// Register marketplace commands (list, add, remove, enable, disable)
registerMarketplaceCommands(program);

// Register info command
registerInfoCommand(program, DEFAULT_WORKING_DIR);

// Register package management commands
registerPackageCommands(program, DEFAULT_WORKING_DIR);

// Register package-app command (cross-platform PWA launchers)
registerPackageAppCommand(program, DEFAULT_WORKING_DIR);

// Doctor command: diagnose photon environment
program
  .command('doctor')
  .argument('[name]', 'Photon name to diagnose (checks environment if omitted)')
  .description('Run diagnostics on photon environment, ports, and configuration')
  .option('--port <number>', 'Port to check for availability', '3000')
  .action(async (name: string | undefined, options: any, command: Command) => {
    try {
      const { formatOutput, printHeader, printInfo, printSuccess, printWarning, STATUS } =
        await import('./cli-formatter.js');
      const workingDir = command.parent?.opts().dir || DEFAULT_WORKING_DIR;
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
        const { MarketplaceManager } = await import('./marketplace-manager.js');
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
      const { printError } = await import('./cli-formatter.js');
      printError(getErrorMessage(error));
      process.exit(1);
    }
  });

// CLI command: directly invoke photon methods
// Also serves as escape hatch for photons with reserved names (e.g., photon cli list get)
program
  .command('cli <photon> [method] [args...]')
  .description('Run photon methods from command line (escape hatch for reserved names)')
  .allowUnknownOption()
  .helpOption(false) // Disable default help so we can handle it ourselves
  .action(async (photon: string, method: string | undefined, args: string[]) => {
    // Handle help flag
    if (photon === '--help' || photon === '-h') {
      console.log(`USAGE:
    photon <photon-name> [method] [args...]
    photon cli <photon-name> [method] [args...]   (explicit form)

DESCRIPTION:
    Run photon methods directly from the command line. Photons provide
    a CLI interface automatically based on their exported methods.

    The 'cli' command is optional - you can run photons directly:
      photon lg-remote volume +5      (implicit)
      photon cli lg-remote volume +5  (explicit)

    Use 'photon cli' explicitly when your photon name conflicts with
    a reserved command (serve, beam, list, init, etc.)

EXAMPLES:
    # List all methods for a photon
    photon lg-remote

    # Call a method with no parameters
    photon lg-remote status

    # Call a method with parameters
    photon lg-remote volume 50
    photon lg-remote volume +5
    photon spotify play

    # Get method-specific help
    photon lg-remote volume --help

    # Output raw JSON instead of formatted text
    photon lg-remote status --json

    # Escape hatch for reserved-name photons
    photon cli list get       (photon named "list", method "get")
    photon cli serve status   (photon named "serve", method "status")

SEE ALSO:
    photon list           List all installed photons
    photon add <name>     Install a photon from marketplace
`);
      return;
    }

    const { listMethods, runMethod } = await import('./photon-cli-runner.js');

    if (!method) {
      // List all methods
      await listMethods(photon);
    } else {
      // Run specific method
      await runMethod(photon, method, args);
    }
  });

// Alias commands: create CLI shortcuts for photons
program
  .command('alias', { hidden: true })
  .argument('<photon>', 'Photon to create alias for')
  .argument('[alias-name]', 'Custom alias name (defaults to photon name)')
  .description('Create a CLI alias for a photon')
  .action(async (photon: string, aliasName: string | undefined) => {
    const { createAlias } = await import('./cli-alias.js');
    await createAlias(photon, aliasName);
  });

program
  .command('unalias', { hidden: true })
  .argument('<alias-name>', 'Alias to remove')
  .description('Remove a CLI alias')
  .action(async (aliasName: string) => {
    const { removeAlias } = await import('./cli-alias.js');
    await removeAlias(aliasName);
  });

program
  .command('aliases', { hidden: true })
  .description('List all CLI aliases')
  .action(async () => {
    const { listAliases } = await import('./cli-alias.js');
    await listAliases();
  });

// Test command: run tests for photons
program
  .command('test')
  .argument('[photon]', 'Photon to test (tests all if omitted)')
  .argument('[test]', 'Specific test to run')
  .option('--json', 'Output results as JSON')
  .option(
    '--mode <mode>',
    'Test mode: direct (unit), cli (integration via CLI), mcp (integration via MCP), all',
    'direct'
  )
  .description('Run test methods in photons')
  .action(async (photon: string | undefined, test: string | undefined, options: any) => {
    try {
      const workingDir = program.opts().dir || DEFAULT_WORKING_DIR;
      const { runTests } = await import('./test-runner.js');

      // Validate mode
      const validModes = ['direct', 'cli', 'mcp', 'all'];
      if (!validModes.includes(options.mode)) {
        logger.error(`Invalid mode: ${options.mode}. Valid modes: ${validModes.join(', ')}`);
        process.exit(1);
      }

      const summary = await runTests(workingDir, photon, test, {
        json: options.json,
        mode: options.mode,
      });

      // Exit with error code if any tests failed
      if (summary.failed > 0) {
        process.exit(1);
      }
    } catch (error) {
      logger.error(`Error: ${getErrorMessage(error)}`);
      process.exit(1);
    }
  });

// Reserved commands that should NOT be treated as photon names
// Reserved commands that should NOT be treated as photon names
// If first arg is not in this list, it's assumed to be a photon name (implicit CLI mode)
const RESERVED_COMMANDS = [
  // Core commands
  'serve',
  'sse',
  'beam',
  'list',
  'ls',
  'info',
  'test',
  // Photon management
  'new',
  'init',
  'validate',
  'sync',
  'add',
  'remove',
  'rm',
  // Maintenance
  'upgrade',
  'up',
  'update',
  'doctor',
  'clear-cache',
  'clean',
  // Aliases
  'cli',
  'alias',
  'unalias',
  'aliases',
  // Marketplace
  'marketplace',
  // Packaging
  'package',
  // Hidden/advanced
  'mcp',
  'search',
  'maker',
  'host',
  'diagram',
  'diagrams',
  'enable',
  'disable',
  // Help/version (handled by commander)
  'help',
  '--help',
  '-h',
  'version',
  '--version',
  '-V',
];

// All known commands for "did you mean" suggestions
const knownCommands = [
  'serve',
  'sse',
  'beam',
  'list',
  'ls',
  'info',
  'test',
  'new',
  'init',
  'validate',
  'sync',
  'add',
  'remove',
  'rm',
  'upgrade',
  'up',
  'update',
  'clear-cache',
  'clean',
  'doctor',
  'cli',
  'alias',
  'unalias',
  'aliases',
  'mcp',
  'search',
  'marketplace',
  'maker',
  'host',
  'diagram',
  'diagrams',
];

const knownSubcommands: Record<string, string[]> = {
  marketplace: ['list', 'add', 'remove', 'enable', 'disable'],
  maker: ['new', 'validate', 'sync', 'init'],
};

/**
 * Calculate Levenshtein distance between two strings
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1, // insertion
          matrix[i - 1][j] + 1 // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Find closest matching command
 */
function findClosestCommand(input: string, commands: string[]): string | null {
  let closest: string | null = null;
  let minDistance = Infinity;

  for (const cmd of commands) {
    const distance = levenshteinDistance(input.toLowerCase(), cmd.toLowerCase());
    // Only suggest if distance is small enough (max 3 edits for short commands, proportional for longer)
    const maxDistance = Math.max(2, Math.floor(cmd.length / 2));
    if (distance < minDistance && distance <= maxDistance) {
      minDistance = distance;
      closest = cmd;
    }
  }

  return closest;
}

// Handle unknown commands with "did you mean" suggestions
program.on('command:*', async (operands) => {
  const { printError, printInfo } = await import('./cli-formatter.js');
  const unknownCommand = operands[0];

  printError(`Unknown command: ${unknownCommand}`);

  // Check if it's a subcommand typo for a known parent
  const args = process.argv.slice(2);
  const parentIndex = args.findIndex((arg) => knownSubcommands[arg]);

  if (parentIndex !== -1 && parentIndex < args.indexOf(unknownCommand)) {
    const parent = args[parentIndex];
    const suggestion = findClosestCommand(unknownCommand, knownSubcommands[parent]);
    if (suggestion) {
      printInfo(`Did you mean: photon ${parent} ${suggestion}`);
    }
  } else {
    // Check for top-level command typo
    const suggestion = findClosestCommand(unknownCommand, knownCommands);
    if (suggestion) {
      printInfo(`Did you mean: photon ${suggestion}`);
    }
  }

  console.log('');
  printInfo(`Run 'photon --help' for usage`);
  process.exit(1);
});

// ══════════════════════════════════════════════════════════════════════════════
// IMPLICIT CLI MODE
// ══════════════════════════════════════════════════════════════════════════════
// If the first argument is not a reserved command, treat it as a photon name
// This enables: `photon lg-remote volume +5` instead of `photon cli lg-remote volume +5`

function preprocessArgs(): string[] {
  const args = process.argv.slice(2);

  // No args - default to beam with auto-open browser
  if (args.length === 0) {
    return [...process.argv, 'beam', '--open'];
  }

  // Find the first non-flag argument (skip values of flags that take a parameter)
  const flagsWithValues = ['--dir', '--log-level'];
  const firstArgIndex = args.findIndex((arg, i) => {
    if (arg.startsWith('-')) return false;
    // Skip values of preceding flags (e.g., "." in "--dir .")
    if (i > 0 && flagsWithValues.includes(args[i - 1])) return false;
    return true;
  });
  if (firstArgIndex === -1) {
    // No subcommand — only flags present (e.g., --dir=. --log-level debug)
    // photon --help / -h / --version / -V → show program help/version
    if (args.some((a) => a === '--help' || a === '-h' || a === '--version' || a === '-V')) {
      return process.argv;
    }
    // Otherwise default to beam (e.g., photon --dir=. → photon --dir=. beam --open)
    return [...process.argv, 'beam', '--open'];
  }

  const firstArg = args[firstArgIndex];

  // If first arg is a reserved command, let commander handle normally
  if (RESERVED_COMMANDS.includes(firstArg)) {
    return process.argv;
  }

  // First arg looks like a photon name - inject 'cli' command
  // photon lg-remote volume +5 → photon cli lg-remote volume +5
  const newArgs = [...process.argv];
  newArgs.splice(2 + firstArgIndex, 0, 'cli');
  return newArgs;
}

program.parse(preprocessArgs());

/**
 * Inline template fallback
 */
function getInlineTemplate(): string {
  return `/**
 * TemplateName Photon MCP
 *
 * Single-file MCP server using Photon
 */

export default class TemplateName {
  /**
   * Example tool
   * @param message Message to echo
   */
  async echo(params: { message: string }) {
    return \`Echo: \${params.message}\`;
  }

  /**
   * Add two numbers
   * @param a First number
   * @param b Second number
   */
  async add(params: { a: number; b: number }) {
    return params.a + params.b;
  }
}
`;
}

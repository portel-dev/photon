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
import * as readline from 'readline';
import { PhotonServer } from './server.js';
import { FileWatcher } from './watcher.js';
import { resolvePhotonPath, listPhotonMCPs, ensureWorkingDir, DEFAULT_WORKING_DIR } from './path-resolver.js';
import {
  SchemaExtractor,
  ConstructorParam,
  loadPhotonMCPConfig,
  setMCPServerConfig,
  resolveMCPSource,
  type MCPDependency,
  type MCPServerConfig,
} from '@portel/photon-core';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

import { ProgressRenderer } from '@portel/photon-core';
import { PHOTON_VERSION } from './version.js';
import { toEnvVarName } from './shared/config-docs.js';
import { renderSection } from './shared/cli-sections.js';
import { runTask } from './shared/task-runner.js';
import { LoggerOptions, normalizeLogLevel } from './shared/logger.js';
import { printHeader, printInfo, printWarning, printError, printSuccess } from './cli-formatter.js';
import { handleError, wrapError, getErrorMessage } from './shared/error-handler.js';

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
  for (let i = 0; i < maxAttempts; i++) {
    const port = startPort + i;
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found between ${startPort} and ${startPort + maxAttempts - 1}`);
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

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
  });

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
      const items = prop.items?.anyOf || prop.items?.enum?.map((e: string) => ({ const: e, title: e }));
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
  const openCommand =
    platform === 'darwin' ? 'open' :
    platform === 'win32' ? 'start' : 'xdg-open';

  try {
    const { exec } = await import('child_process');
    exec(`${openCommand} "${ask.url}"`);
  } catch (error) {
    cliHint('Please open the URL manually in your browser.');
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
  });

  return new Promise((resolve) => {
    rl.question('Press Enter when done (or type "cancel" to abort): ', (answer) => {
      rl.close();
      if (answer.toLowerCase() === 'cancel') {
        resolve({ action: 'cancel' });
      } else {
        resolve({ action: 'accept' });
      }
    });
  });
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
    const isDefault = ask.default === opt.value || (Array.isArray(ask.default) && ask.default.includes(opt.value));
    const defaultMark = isDefault ? ' ✓' : '';
    const desc = opt.description ? ` - ${opt.description}` : '';
    cliListItem(`${i + 1}. ${opt.label}${desc}${defaultMark}`);
  });
  cliSpacer();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
  });

  return new Promise((resolve) => {
    const prompt = ask.multi
      ? `Choose (comma-separated, 1-${options.length}): `
      : `Choose (1-${options.length}): `;

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
 * Convert MCP name and parameter name to environment variable name
 */
/**
 * Setup MCP dependencies during photon installation
 * Detects @mcp declarations and prompts user to configure missing ones
 */
async function setupMCPDependencies(
  source: string,
  photonName: string,
  options: { skipPrompts?: boolean } = {}
): Promise<{ configured: string[]; skipped: string[] }> {
  const extractor = new SchemaExtractor();
  const mcpDeps = extractor.extractMCPDependencies(source);

  if (mcpDeps.length === 0) {
    return { configured: [], skipped: [] };
  }

  // Load existing config
  const config = await loadPhotonMCPConfig();
  const configured: string[] = [];
  const skipped: string[] = [];

  // Check which MCPs need configuration
  const unconfigured = mcpDeps.filter(dep => !config.mcpServers[dep.name]);

  if (unconfigured.length === 0) {
    console.error(`\n✓ All ${mcpDeps.length} MCP dependencies already configured`);
    return { configured: mcpDeps.map(d => d.name), skipped: [] };
  }

  console.error(`\n📦 Found ${mcpDeps.length} MCP dependencies:`);
  for (const dep of mcpDeps) {
    const status = config.mcpServers[dep.name] ? '✓' : '○';
    console.error(`   ${status} ${dep.name} (${dep.source})`);
  }

  if (options.skipPrompts) {
    // Auto-configure all without prompting
    for (const dep of unconfigured) {
      const serverConfig = resolveMCPSource(dep.name, dep.source, dep.sourceType);
      await setMCPServerConfig(dep.name, serverConfig);
      configured.push(dep.name);
    }
    console.error(`\n✓ Auto-configured ${configured.length} MCP(s) in ~/.photon/mcp-servers.json`);
    return { configured, skipped };
  }

  // Interactive setup for each unconfigured MCP
  console.error(`\n${unconfigured.length} MCP(s) need configuration:\n`);

  for (const dep of unconfigured) {
    const shouldConfigure = await promptYesNo(
      `Configure ${dep.name}? (${dep.source})`,
      true
    );

    if (!shouldConfigure) {
      skipped.push(dep.name);
      console.error(`   Skipped ${dep.name}`);
      continue;
    }

    // Generate default config from @mcp source
    const serverConfig = resolveMCPSource(dep.name, dep.source, dep.sourceType);

    // Ask for environment variables
    const envVars = await promptEnvVars(dep.name, serverConfig);
    if (Object.keys(envVars).length > 0) {
      serverConfig.env = { ...serverConfig.env, ...envVars };
    }

    // Save to config
    await setMCPServerConfig(dep.name, serverConfig);
    configured.push(dep.name);
    console.error(`   ✓ Configured ${dep.name}`);
  }

  if (configured.length > 0) {
    console.error(`\n✓ Saved ${configured.length} MCP(s) to ~/.photon/mcp-servers.json`);
  }

  if (skipped.length > 0) {
    console.error(`\n⚠️  Skipped MCPs can be configured later with:`);
    console.error(`   photon config mcp <name>`);
  }

  return { configured, skipped };
}

/**
 * Prompt for yes/no with default
 */
async function promptYesNo(message: string, defaultYes: boolean = true): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
  });

  const hint = defaultYes ? '[Y/n]' : '[y/N]';

  return new Promise((resolve) => {
    rl.question(`${message} ${hint}: `, (answer) => {
      rl.close();
      const trimmed = answer.trim().toLowerCase();
      if (trimmed === '') {
        resolve(defaultYes);
      } else {
        resolve(trimmed === 'y' || trimmed === 'yes');
      }
    });
  });
}

/**
 * Prompt for environment variables for an MCP
 */
async function promptEnvVars(
  mcpName: string,
  serverConfig: MCPServerConfig
): Promise<Record<string, string>> {
  const envVars: Record<string, string> = {};

  // Common env var patterns based on MCP name
  const commonPatterns: Record<string, string[]> = {
    slack: ['SLACK_BOT_TOKEN', 'SLACK_TEAM_ID'],
    github: ['GITHUB_TOKEN', 'GITHUB_PERSONAL_ACCESS_TOKEN'],
    filesystem: [], // No tokens needed
    postgres: ['POSTGRES_CONNECTION_STRING', 'DATABASE_URL'],
    sqlite: [], // No tokens needed
    brave: ['BRAVE_API_KEY'],
    fetch: [], // No tokens needed
    memory: [], // No tokens needed
    puppeteer: [], // No tokens needed
    google: ['GOOGLE_API_KEY'],
    openai: ['OPENAI_API_KEY'],
    anthropic: ['ANTHROPIC_API_KEY'],
  };

  // Find matching pattern
  const lowerName = mcpName.toLowerCase();
  let suggestedVars: string[] = [];

  for (const [pattern, vars] of Object.entries(commonPatterns)) {
    if (lowerName.includes(pattern)) {
      suggestedVars = vars;
      break;
    }
  }

  if (suggestedVars.length === 0) {
    // No known env vars needed
    return envVars;
  }

  console.error(`\n   Environment variables for ${mcpName}:`);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
  });

  for (const varName of suggestedVars) {
    const existingValue = process.env[varName];
    const hint = existingValue ? ` (found in env)` : '';

    const value = await new Promise<string>((resolve) => {
      rl.question(`   ${varName}${hint}: `, (answer) => {
        resolve(answer.trim());
      });
    });

    if (value) {
      // Store as reference if it looks like an env var reference
      if (value.startsWith('$')) {
        envVars[varName] = value.replace('$', '${') + '}';
      } else {
        envVars[varName] = value;
      }
    } else if (existingValue) {
      // Use env var reference
      envVars[varName] = `\${${varName}}`;
    }
  }

  rl.close();
  return envVars;
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
    console.error(`❌ Directory not found: ${resolvedPath}`);
    process.exit(1);
  }

  // Scan for .photon.ts files
  console.error('📦 Scanning for .photon.ts files...');
  const files = await fs.readdir(resolvedPath);
  let photonFiles = files.filter(f => f.endsWith('.photon.ts'));

  // Filter out installed photons if requested (for ~/.photon)
  if (options.filterInstalled && isDefaultDir) {
    const { readLocalMetadata } = await import('./marketplace-manager.js');
    const metadata = await readLocalMetadata();
    // Metadata keys may include .photon.ts extension
    const installedNames = new Set(
      Object.keys(metadata.photons || {}).map(k => k.replace(/\.photon\.ts$/, ''))
    );

    const originalCount = photonFiles.length;
    photonFiles = photonFiles.filter(f => {
      const name = f.replace(/\.photon\.ts$/, '');
      return !installedNames.has(name);
    });

    if (originalCount !== photonFiles.length) {
      console.error(`   Filtered out ${originalCount - photonFiles.length} installed photons`);
    }
  }

  if (photonFiles.length === 0) {
    console.error(`❌ No .photon.ts files found in ${resolvedPath}`);
    process.exit(1);
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
      tools: metadata.tools?.map(t => t.name),
    });

    // Generate individual photon documentation
    const photonMarkdown = await templateMgr.renderTemplate('photon.md', metadata);
    const docPath = path.join(resolvedPath, `${metadata.name}.md`);
    await fs.writeFile(docPath, photonMarkdown, 'utf-8');
  }

  // Create manifest
  console.error('\n📋 Updating manifest...');
  const baseName = path.basename(resolvedPath);
  const manifest = {
    name: options.name || baseName,
    version: PHOTON_VERSION,
    description: options.description || undefined,
    owner: options.owner ? {
      name: options.owner,
    } : undefined,
    photons,
  };

  const marketplaceDir = path.join(resolvedPath, '.marketplace');
  await fs.mkdir(marketplaceDir, { recursive: true });

  const manifestPath = path.join(marketplaceDir, 'photons.json');
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
    photons: photons.map(p => ({
      name: p.name,
      description: p.description,
      version: p.version,
      license: p.license,
      tools: p.tools || [],
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
    console.error('⚠️  Not a git repository. Initialize with: git init');
    process.exit(1);
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
      return value.replace(/(?:path\.)?join\(homedir\(\),\s*['"]([^'"]+)['"]\)/g, (_, folderName) => {
        return path.join(os.homedir(), folderName);
      });
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
  if (platform === 'darwin') {
    return path.join(os.homedir(), 'Library/Application Support/Claude/claude_desktop_config.json');
  } else if (platform === 'win32') {
    return path.join(process.env.APPDATA || '', 'Claude/claude_desktop_config.json');
  } else {
    // Linux/other
    return path.join(os.homedir(), '.config/Claude/claude_desktop_config.json');
  }
}

/**
 * Check if photon is installed globally
 * @returns "photon" if available globally (cross-platform), null otherwise
 */
async function getGlobalPhotonPath(): Promise<string | null> {
  const { execFile } = await import('child_process');
  const { promisify } = await import('util');
  const execFileAsync = promisify(execFile);

  try {
    const command = process.platform === 'win32' ? 'where' : 'which';
    const { stdout } = await execFileAsync(command, ['photon']);
    const photonPath = stdout.trim().split('\n')[0]; // Take first match

    if (photonPath) {
      // Verify it's actually the @portel/photon package by checking version
      try {
        const { stdout: versionOutput } = await execFileAsync(photonPath, ['--version']);
        // If it outputs a version, it's likely our photon
        if (versionOutput.trim()) {
          // Return "photon" instead of full path for cross-platform compatibility
          // The shell will resolve it from PATH
          return 'photon';
        }
      } catch {
        // Version check failed, might not be our photon
        return null;
      }
    }
  } catch {
    // which/where command failed, photon not in PATH
  }

  return null;
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
  const results: Array<{name: string; envVar: string; status: string; value?: string}> = [];

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
  results.forEach(r => {
    printInfo(`  ${r.status} ${r.envVar}`);
    if (r.value) {
      printInfo(`     Value: ${r.value}`);
    }
  });
  cliSpacer();

  if (hasErrors) {
    printError('Validation failed: Missing required environment variables.');
    cliHint(`Run 'photon mcp ${mcpName} --config' to see the configuration template.`);
    process.exit(1);
  } else {
    printSuccess('Configuration valid!');
    cliHint(`Run: photon mcp ${mcpName}`);
  }
}

/**
 * Show configuration template for an MCP
 */
async function showConfigTemplate(filePath: string, mcpName: string, workingDir: string = DEFAULT_WORKING_DIR): Promise<void> {
  cliHeading(`📋 Configuration template for: ${mcpName}`);
  cliSpacer();

  const params = await extractConstructorParams(filePath);

  if (params.length === 0) {
    printSuccess('No configuration required for this MCP.');
    return;
  }

  printHeader('Environment variables');
  params.forEach(param => {
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
  params.forEach(param => {
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
  .addHelpText('after', `
Runtime Commands:
  mcp <name>              Run a photon as MCP server (for AI assistants)
  cli <photon> [method]   Run photon methods from command line

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
`);

// Update command: refresh marketplace indexes and check for CLI updates
program
  .command('update', { hidden: true })
  .description('Update marketplace indexes and check for CLI updates')
  .action(async () => {
    try {
      const { printInfo, printSuccess, printWarning, printHeader } = await import('./cli-formatter.js');
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
  .action(async (name: string, options: any, command: Command) => {
    try {
      // Get working directory from global options
      const workingDir = program.opts().dir || DEFAULT_WORKING_DIR;
      const logOptions = getLogOptionsFromCommand(command);

      // Resolve file path from name in working directory
      const filePath = await resolvePhotonPath(name, workingDir);

      if (!filePath) {
        console.error(`❌ MCP not found: ${name}`);
        console.error(`Searched in: ${workingDir}`);
        console.error(`Tip: Use 'photon info' to see available MCPs`);
        process.exit(1);
      }

      // Handle --validate flag
      if (options.validate) {
        await validateConfiguration(filePath, name);
        return;
      }

      // Handle --config flag
      if (options.config) {
        await showConfigTemplate(filePath, name, workingDir);
        return;
      }

      // Validate transport option
      const transport = options.transport as 'stdio' | 'sse';
      if (transport !== 'stdio' && transport !== 'sse') {
        console.error(`❌ Invalid transport: ${options.transport}`);
        console.error('Valid options: stdio, sse');
        process.exit(1);
      }

      // Start MCP server
      const server = new PhotonServer({
        filePath,
        devMode: options.dev,
        transport,
        port: parseInt(options.port, 10),
        logOptions: { ...logOptions, scope: transport },
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

        // Clean up watcher on shutdown
        process.on('SIGINT', async () => {
          await watcher.stop();
        });
        process.on('SIGTERM', async () => {
          await watcher.stop();
        });
      }
    } catch (error) {
      console.error(`❌ Error: ${getErrorMessage(error)}`);
      process.exit(1);
    }
  });


// Serve command: quick SSE server with auto port detection
program
  .command('serve')
  .argument('<name>', 'Photon name (without .photon.ts extension)')
  .option('-p, --port <number>', 'Port to start from (auto-finds available)', '3000')
  .option('--dev', 'Enable development mode with hot reload and playground')
  .description('Run Photon as HTTP server with SSE transport (auto port detection)')
  .action(async (name: string, options: any, command: Command) => {
    try {
      // Get working directory from global options
      const workingDir = program.opts().dir || DEFAULT_WORKING_DIR;
      const logOptions = getLogOptionsFromCommand(command);

      // Resolve file path from name
      const filePath = await resolvePhotonPath(name, workingDir);

      if (!filePath) {
        console.error(`❌ Photon not found: ${name}`);
        console.error(`Searched in: ${workingDir}`);
        console.error(`Tip: Use 'photon info' to see available photons`);
        process.exit(1);
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
      console.error(`❌ Error: ${getErrorMessage(error)}`);
      process.exit(1);
    }
  });


// Deploy command: deploy Photon to cloud platforms
program
  .command('deploy')
  .argument('<target>', 'Deployment target: cloudflare (or cf)')
  .argument('<name>', 'Photon name (without .photon.ts extension)')
  .option('--dev', 'Enable playground in deployment')
  .option('--dry-run', 'Generate project without deploying')
  .option('--output <dir>', 'Output directory for generated project')
  .description('Deploy a Photon to cloud platforms')
  .action(async (target: string, name: string, options: any, command: Command) => {
    try {
      // Get working directory from global options
      const workingDir = program.opts().dir || DEFAULT_WORKING_DIR;

      // Resolve file path from name
      const photonPath = await resolvePhotonPath(name, workingDir);

      if (!photonPath) {
        console.error(`❌ Photon not found: ${name}`);
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
        console.error(`❌ Unknown deployment target: ${target}`);
        console.error('Supported targets: cloudflare (cf)');
        process.exit(1);
      }
    } catch (error) {
      console.error(`❌ Deployment failed: ${getErrorMessage(error)}`);
      process.exit(1);
    }
  });


// Dev command: run local Cloudflare dev server
program
  .command('cf-dev')
  .argument('<name>', 'Photon name (without .photon.ts extension)')
  .option('--output <dir>', 'Output directory for generated project')
  .description('Run Photon locally with Cloudflare Workers dev server')
  .action(async (name: string, options: any) => {
    try {
      // Get working directory from global options
      const workingDir = program.opts().dir || DEFAULT_WORKING_DIR;

      // Resolve file path from name
      const photonPath = await resolvePhotonPath(name, workingDir);

      if (!photonPath) {
        console.error(`❌ Photon not found: ${name}`);
        console.error(`Searched in: ${workingDir}`);
        console.error(`Tip: Use 'photon info' to see available photons`);
        process.exit(1);
      }

      const { devCloudflare } = await import('./deploy/cloudflare.js');
      await devCloudflare({
        photonPath,
        outputDir: options.output,
      });
    } catch (error) {
      console.error(`❌ Error: ${getErrorMessage(error)}`);
      process.exit(1);
    }
  });


// Info command: show installed and available Photons
program
  .command('info', { hidden: true })
  .argument('[name]', 'Photon name to show details for (shows all if omitted)')
  .option('--mcp', 'Output as MCP server configuration')
  .alias('list')
  .alias('ls')
  .description('Show installed and available Photons')
  .action(async (name: string | undefined, options: any, command: Command) => {
    try {
      const { formatOutput, printInfo, printError, printHeader, STATUS } = await import('./cli-formatter.js');
      // Get working directory from global/parent options
      const parentOpts = command.parent?.opts() || {};
      const workingDir = parentOpts.dir || DEFAULT_WORKING_DIR;
      const asMcp = options.mcp || false;

      const mcps = await listPhotonMCPs(workingDir);

      // Initialize marketplace manager for all operations
      const { MarketplaceManager } = await import('./marketplace-manager.js');
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
            const defaultDisplay = param.defaultValue !== undefined
              ? formatDefaultValue(param.defaultValue)
              : `<your-${param.name}>`;
            env[envVarName] = defaultDisplay;
          }

          // Check for global photon installation
          const globalPhotonPath = await getGlobalPhotonPath();
          const needsWorkingDir = workingDir !== DEFAULT_WORKING_DIR;

          const config = globalPhotonPath
            ? {
                command: globalPhotonPath,
                args: needsWorkingDir
                  ? ['mcp', name, '--dir', workingDir]
                  : ['mcp', name],
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
            const { PhotonDocExtractor } = await import('./photon-doc-extractor.js');
            const extractor = new PhotonDocExtractor(filePath!);
            const photonMetadata = await extractor.extractFullMetadata();
            const fileName = `${name}.photon.ts`;
            const metadata = await manager.getPhotonInstallMetadata(fileName);
            const isModified = metadata ? await manager.isPhotonModified(filePath!, fileName) : false;

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
              renderSection('Methods', tools.map(tool => {
                const desc = tool.description ? tool.description.split(/\.(?:\s|$)|  |\n/)[0].trim() : '';
                return desc ? `${tool.name} — ${desc}` : tool.name;
              }));
            }

            const usageLines = metadata && !isModified
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
            const marketplaceLines = sources.map(source => {
              const version = source.metadata?.version || 'unknown';
              const mark = installMetadata?.marketplace === source.marketplace.name ? ' (installed)' : '';
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
        const needsWorkingDir = workingDir !== DEFAULT_WORKING_DIR;

        for (const mcpName of mcps) {
          const filePath = await resolvePhotonPath(mcpName, workingDir);
          if (!filePath) continue;

          const constructorParams = await extractConstructorParams(filePath);
          const env: Record<string, string> = {};
          for (const param of constructorParams) {
            const envVarName = toEnvVarName(mcpName, param.name);
            const defaultDisplay = param.defaultValue !== undefined
              ? formatDefaultValue(param.defaultValue)
              : `<your-${param.name}>`;
            env[envVarName] = defaultDisplay;
          }

          allConfigs[mcpName] = globalPhotonPath
            ? {
                command: globalPhotonPath,
                args: needsWorkingDir
                  ? ['mcp', mcpName, '--dir', workingDir]
                  : ['mcp', mcpName],
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

        const tableData: Array<{ name: string; version: string; source: string; status: string }> = [];

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

      const marketplaces = manager.getAll().filter(m => m.enabled);
      const counts = await manager.getMarketplaceCounts();

      // Build marketplace tree
      const marketplaceTree: Record<string, any> = {};

      for (const marketplace of marketplaces) {
        const count = counts.get(marketplace.name) || 0;
        if (count > 0) {
          // Get a few sample photons from this marketplace
          const manifest = await manager['getCachedManifest'](marketplace.name);
          if (manifest && manifest.photons) {
            const samples = manifest.photons.slice(0, 3);
            const photonList: Record<string, string> = {};

            samples.forEach((photon) => {
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
      const { printError } = await import('./cli-formatter.js');
      printError(getErrorMessage(error));
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
              ? entry.metadata.description.substring(0, 50) + (entry.metadata.description.length > 50 ? '...' : '')
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
        console.error(`❌ File already exists: ${filePath}`);
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
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join('');
      const content = template
        .replace(/TemplateName/g, className)
        .replace(/template-name/g, name);

      // Write file
      await fs.writeFile(filePath, content, 'utf-8');

      console.error(`✅ Created ${fileName} in ${workingDir}`);
      console.error(`Run with: photon mcp ${name} --dev`);
    } catch (error) {
      console.error(`❌ Error: ${getErrorMessage(error)}`);
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
        console.error(`❌ Photon not found: ${name}`);
        console.error(`Searched in: ${workingDir}`);
        console.error(`Tip: Use 'photon info' to see available photons`);
        process.exit(1);
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
      console.error(`❌ Validation failed: ${getErrorMessage(error)}`);
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
      console.error(`❌ Error: ${getErrorMessage(error)}`);
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
      console.error(`❌ Error: ${getErrorMessage(error)}`);
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
        console.error(`❌ Photon not found: ${photonPath}`);
        process.exit(1);
      }

      const extractor = new PhotonDocExtractor(photonPath);
      const diagram = await extractor.generateDiagram();

      // Output just the diagram (can be piped or copied)
      console.log(diagram);
    } catch (error) {
      console.error(`❌ Error: ${getErrorMessage(error)}`);
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
      const photonFiles = files.filter(f => f.endsWith('.photon.ts'));

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
      console.error(`❌ Error: ${getErrorMessage(error)}`);
      if (process.env.DEBUG && error instanceof Error) {
        console.error(error.stack);
      }
      process.exit(1);
    }
  });

// Marketplace command: manage MCP marketplaces
const marketplace = program
  .command('marketplace', { hidden: true })
  .description('Manage MCP marketplaces');

marketplace
  .command('list')
  .description('List all configured marketplaces')
  .action(async () => {
    try {
      const { MarketplaceManager } = await import('./marketplace-manager.js');
      const { formatOutput, printInfo, STATUS } = await import('./cli-formatter.js');
      const manager = new MarketplaceManager();
      await manager.initialize();

      const marketplaces = manager.getAll();

      if (marketplaces.length === 0) {
        printInfo('No marketplaces configured');
        printInfo('Add one with: photon marketplace add portel-dev/photons');
        return;
      }

      // Get MCP counts
      const counts = await manager.getMarketplaceCounts();

      // Build table data
      const tableData = marketplaces.map(m => ({
        name: m.name,
        source: m.source || m.repo || '-',
        photons: counts.get(m.name) || 0,
        status: m.enabled ? STATUS.OK : STATUS.OFF,
      }));

      printInfo(`Configured marketplaces (${marketplaces.length}):\n`);
      formatOutput(tableData, 'table');

    } catch (error) {
      const { printError } = await import('./cli-formatter.js');
      printError(getErrorMessage(error));
      process.exit(1);
    }
  });

marketplace
  .command('add')
  .argument('<repo>', 'GitHub repository (username/repo or github.com URL)')
  .description('Add a new MCP marketplace from GitHub')
  .action(async (repo: string) => {
    try {
      const { MarketplaceManager } = await import('./marketplace-manager.js');
      const manager = new MarketplaceManager();
      await manager.initialize();

      const { marketplace: result, added } = await manager.add(repo);

      if (added) {
        console.error(`✅ Added marketplace: ${result.name}`);
        console.error(`Source: ${repo}`);
        console.error(`URL: ${result.url}`);

        // Auto-fetch marketplace.json
        console.error(`Fetching marketplace metadata...`);
        const success = await manager.updateMarketplaceCache(result.name);
        if (success) {
          console.error(`✅ Marketplace ready to use`);
        }
      } else {
        console.error(`ℹ️  Marketplace already exists: ${result.name}`);
        console.error(`Source: ${result.source}`);
        console.error(`Skipping duplicate addition`);
      }
    } catch (error) {
      console.error(`❌ Error: ${getErrorMessage(error)}`);
      process.exit(1);
    }
  });

marketplace
  .command('remove')
  .argument('<name>', 'Marketplace name')
  .description('Remove a marketplace')
  .action(async (name: string) => {
    try {
      const { MarketplaceManager } = await import('./marketplace-manager.js');
      const manager = new MarketplaceManager();
      await manager.initialize();

      const removed = await manager.remove(name);

      if (removed) {
        console.error(`✅ Removed marketplace: ${name}`);
      } else {
        console.error(`❌ Marketplace '${name}' not found`);
        process.exit(1);
      }
    } catch (error) {
      console.error(`❌ Error: ${getErrorMessage(error)}`);
      process.exit(1);
    }
  });

marketplace
  .command('enable')
  .argument('<name>', 'Marketplace name')
  .description('Enable a marketplace')
  .action(async (name: string) => {
    try {
      const { MarketplaceManager } = await import('./marketplace-manager.js');
      const manager = new MarketplaceManager();
      await manager.initialize();

      const success = await manager.setEnabled(name, true);

      if (success) {
        console.error(`✅ Enabled marketplace: ${name}`);
      } else {
        console.error(`❌ Marketplace '${name}' not found`);
        process.exit(1);
      }
    } catch (error) {
      console.error(`❌ Error: ${getErrorMessage(error)}`);
      process.exit(1);
    }
  });

marketplace
  .command('disable')
  .argument('<name>', 'Marketplace name')
  .description('Disable a marketplace')
  .action(async (name: string) => {
    try {
      const { MarketplaceManager } = await import('./marketplace-manager.js');
      const manager = new MarketplaceManager();
      await manager.initialize();

      const success = await manager.setEnabled(name, false);

      if (success) {
        console.error(`✅ Disabled marketplace: ${name}`);
      } else {
        console.error(`❌ Marketplace '${name}' not found`);
        process.exit(1);
      }
    } catch (error) {
      console.error(`❌ Error: ${getErrorMessage(error)}`);
      process.exit(1);
    }
  });


// Add command: add MCP from marketplace
program
  .command('add', { hidden: true })
  .argument('<name>', 'MCP name to add')
  .option('--marketplace <name>', 'Specific marketplace to use')
  .option('-y, --yes', 'Automatically select first suggestion without prompting')
  .option('--skip-mcp-setup', 'Skip MCP dependency configuration')
  .description('Add an MCP from a marketplace')
  .action(async (name: string, options: any, command: Command) => {
    try {
      // Get working directory from global options
      const workingDir = command.parent?.opts().dir || DEFAULT_WORKING_DIR;
      await ensureWorkingDir(workingDir);

      const { MarketplaceManager } = await import('./marketplace-manager.js');
      const manager = new MarketplaceManager();
      await manager.initialize();

      // Check for conflicts
      let conflict = await manager.checkConflict(name, options.marketplace);

      if (!conflict.sources || conflict.sources.length === 0) {
        console.error(`❌ MCP '${name}' not found in any enabled marketplace\n`);

        // Search for similar names
        const searchResults = await manager.search(name);

        if (searchResults.size > 0) {
          console.error(`Did you mean one of these?\n`);

          // Convert search results to array for selection
          const suggestions: Array<{ name: string; version: string; description: string }> = [];
          let count = 0;
          for (const [mcpName, sources] of searchResults) {
            if (count >= 5) break; // Limit to 5 suggestions
            const source = sources[0]; // Use first marketplace
            const version = source.metadata?.version || 'unknown';
            const description = source.metadata?.description || 'No description';
            suggestions.push({ name: mcpName, version, description });
            console.error(`  [${count + 1}] ${mcpName} (v${version})`);
            console.error(`      ${description}`);
            count++;
          }

          // Interactive selection or auto-select with -y
          let selectedIndex: number | null;

          if (options.yes) {
            // Auto-select first suggestion
            selectedIndex = 0;
          } else {
            // Interactive selection
            selectedIndex = await new Promise<number | null>((resolve) => {
              const rl = readline.createInterface({
                input: process.stdin,
                output: process.stderr,
              });

              const askQuestion = () => {
                rl.question(`\nWhich one? [1-${suggestions.length}] (or press Enter to cancel): `, (answer) => {
                  const trimmed = answer.trim();

                  // Empty input = cancel
                  if (trimmed === '') {
                    rl.close();
                    resolve(null);
                    return;
                  }

                  const choice = parseInt(trimmed, 10);

                  // Validate input
                  if (isNaN(choice) || choice < 1 || choice > suggestions.length) {
                    console.error(`Invalid choice. Please enter a number between 1 and ${suggestions.length}.`);
                    askQuestion();
                  } else {
                    rl.close();
                    resolve(choice - 1);
                  }
                });
              };

              askQuestion();
            });

            if (selectedIndex === null) {
              console.error('\nCancelled.');
              process.exit(0);
            }
          }

          // Update name to the selected MCP
          name = suggestions[selectedIndex].name;
          console.error(`\n✓ Selected: ${name}`);

          // Re-check for conflicts with the new name
          conflict = await manager.checkConflict(name, options.marketplace);
          if (!conflict.sources || conflict.sources.length === 0) {
            console.error(`❌ MCP '${name}' is no longer available`);
            process.exit(1);
          }
        } else {
          console.error(`Run 'photon info' to see all available MCPs`);
          process.exit(1);
        }
      }

      // Check if already exists locally
      const filePath = path.join(workingDir, `${name}.photon.ts`);
      const fileName = `${name}.photon.ts`;

      if (existsSync(filePath)) {
        console.error(`⚠️  MCP '${name}' already exists`);
        console.error(`Use 'photon upgrade ${name}' to update it`);
        process.exit(1);
      }

      // Handle conflicts
      let selectedMarketplace: typeof conflict.sources[0]['marketplace'];
      let selectedMetadata: typeof conflict.sources[0]['metadata'];

      if (conflict.hasConflict) {
        console.error(`⚠️  MCP '${name}' found in multiple marketplaces:\n`);

        conflict.sources.forEach((source, index) => {
          const marker = source.marketplace.name === conflict.recommendation ? '→' : ' ';
          const version = source.metadata?.version || 'unknown';
          console.error(`  ${marker} [${index + 1}] ${source.marketplace.name} (v${version})`);
          console.error(`      ${source.marketplace.repo || source.marketplace.url}`);
        });

        if (conflict.recommendation) {
          console.error(`\n💡 Recommended: ${conflict.recommendation} (newest version)`);
        }

        // Get default choice (recommended or first)
        const recommendedIndex = conflict.sources.findIndex(s => s.marketplace.name === conflict.recommendation);
        const defaultChoice = recommendedIndex !== -1 ? recommendedIndex + 1 : 1;

        // Interactive selection
        const selectedIndex = await new Promise<number>((resolve) => {
          const rl = readline.createInterface({
            input: process.stdin,
            output: process.stderr,
          });

          const askQuestion = () => {
            rl.question(`\nWhich marketplace? [1-${conflict.sources.length}] (default: ${defaultChoice}): `, (answer) => {
              const trimmed = answer.trim();

              // Empty input = use default
              if (trimmed === '') {
                rl.close();
                resolve(defaultChoice - 1);
                return;
              }

              const choice = parseInt(trimmed, 10);

              // Validate input
              if (isNaN(choice) || choice < 1 || choice > conflict.sources.length) {
                console.error(`Invalid choice. Please enter a number between 1 and ${conflict.sources.length}.`);
                askQuestion();
              } else {
                rl.close();
                resolve(choice - 1);
              }
            });
          };

          askQuestion();
        });

        const selectedSource = conflict.sources[selectedIndex];
        selectedMarketplace = selectedSource.marketplace;
        selectedMetadata = selectedSource.metadata;

        console.error(`\n✓ Using: ${selectedMarketplace.name}`);
      } else {
        selectedMarketplace = conflict.sources[0].marketplace;
        selectedMetadata = conflict.sources[0].metadata;
        console.error(`Adding ${name} from ${selectedMarketplace.name}...`);
      }

      // Fetch content from selected marketplace
      const result = await manager.fetchMCP(name);
      if (!result) {
        console.error(`❌ Failed to fetch MCP content`);
        process.exit(1);
      }
      const content = result.content;

      // Write file
      await fs.writeFile(filePath, content, 'utf-8');

      // Save installation metadata if we have it
      if (selectedMetadata) {
        const { calculateHash } = await import('./marketplace-manager.js');
        const contentHash = calculateHash(content);
        await manager.savePhotonMetadata(fileName, selectedMarketplace, selectedMetadata, contentHash);
      }

      console.error(`✅ Added ${name} from ${selectedMarketplace.name}`);
      if (selectedMetadata?.version) {
        console.error(`Version: ${selectedMetadata.version}`);
      }
      console.error(`Location: ${filePath}`);

      // Setup MCP dependencies if present
      if (!options.skipMcpSetup) {
        const { configured, skipped } = await setupMCPDependencies(content, name, {
          skipPrompts: options.yes,
        });

        if (skipped.length > 0) {
          console.error(`\n⚠️  Some MCPs were not configured. Run:`);
          console.error(`   photon mcp ${name}`);
          console.error(`   to see configuration requirements.`);
        }
      }

      console.error(`\nRun with: photon mcp ${name}`);
      console.error(`\nTo customize: Copy to a new name and run with --dev for hot reload`);
    } catch (error) {
      console.error(`❌ Error: ${getErrorMessage(error)}`);
      process.exit(1);
    }
  });

// Remove command: remove an installed photon
program
  .command('remove', { hidden: true })
  .argument('<name>', 'MCP name to remove')
  .alias('rm')
  .option('--keep-cache', 'Keep compiled cache for this photon')
  .description('Remove an installed photon')
  .action(async (name: string, options: any, command: Command) => {
    try {
      const { printInfo, printSuccess, printError } = await import('./cli-formatter.js');
      const workingDir = command.parent?.opts().dir || DEFAULT_WORKING_DIR;

      // Find the photon file
      const filePath = await resolvePhotonPath(name, workingDir);

      if (!filePath) {
        printError(`Photon not found: ${name}`);
        printInfo(`Searched in: ${workingDir}`);
        printInfo(`Tip: Use 'photon info' to see installed photons`);
        process.exit(1);
      }

      printInfo(`Removing ${name}...`);

      // Remove the .photon.ts file
      await fs.unlink(filePath);
      printSuccess(`Removed ${name}.photon.ts`);

      // Clear compiled cache unless --keep-cache
      if (!options.keepCache) {
        const cacheDir = path.join(os.homedir(), '.cache', 'photon-mcp', 'compiled');
        const cachedFiles = [
          path.join(cacheDir, `${name}.js`),
          path.join(cacheDir, `${name}.js.map`),
        ];

        for (const cachedFile of cachedFiles) {
          try {
            await fs.unlink(cachedFile);
          } catch {
            // Ignore if cache doesn't exist
          }
        }
        printSuccess(`Cleared cache`);
      }

      console.log('');
      printSuccess(`Successfully removed ${name}`);
      printInfo(`To reinstall: photon add ${name}`);

    } catch (error) {
      const { printError } = await import('./cli-formatter.js');
      printError(getErrorMessage(error));
      process.exit(1);
    }
  });

// Upgrade command: update MCPs from marketplace
program
  .command('upgrade', { hidden: true })
  .argument('[name]', 'MCP name to upgrade (upgrades all if omitted)')
  .option('--check', 'Check for updates without upgrading')
  .alias('up')
  .description('Upgrade MCP(s) from marketplaces')
  .action(async (name: string | undefined, options: any, command: Command) => {
    try {
      const { formatOutput, printInfo, printSuccess, printWarning, printError, STATUS } = await import('./cli-formatter.js');
      // Get working directory from global options
      const workingDir = command.parent?.opts().dir || DEFAULT_WORKING_DIR;

      const { VersionChecker } = await import('./version-checker.js');
      const checker = new VersionChecker();
      await checker.initialize();

      if (name) {
        // Upgrade single MCP
        const filePath = await resolvePhotonPath(name, workingDir);

        if (!filePath) {
          printError(`MCP not found: ${name}`);
          printInfo(`Searched in: ${workingDir}`);
          process.exit(1);
        }

        printInfo(`Checking ${name} for updates...`);
        const versionInfo = await checker.checkForUpdate(name, filePath);

        if (!versionInfo.local) {
          printWarning('Could not determine local version');
          return;
        }

        if (!versionInfo.remote) {
          printWarning('Not found in any marketplace. This might be a local-only MCP.');
          return;
        }

        if (options.check) {
          const tableData = [{
            name,
            local: versionInfo.local,
            remote: versionInfo.remote,
            status: versionInfo.needsUpdate ? STATUS.UPDATE : STATUS.OK,
          }];
          formatOutput(tableData, 'table');
          return;
        }

        if (!versionInfo.needsUpdate) {
          printSuccess(`Already up to date (${versionInfo.local})`);
          return;
        }

        printInfo(`Upgrading ${name}: ${versionInfo.local} → ${versionInfo.remote}`);

        const success = await checker.updateMCP(name, filePath);

        if (success) {
          printSuccess(`Successfully upgraded ${name} to ${versionInfo.remote}`);
        } else {
          printError(`Failed to upgrade ${name}`);
          process.exit(1);
        }
      } else {
        // Check/upgrade all MCPs
        printInfo(`Checking all MCPs in ${workingDir}...\n`);
        const updates = await checker.checkAllUpdates(workingDir);

        if (updates.size === 0) {
          printInfo('No MCPs found');
          return;
        }

        const needsUpdate: string[] = [];

        // Build table data
        const tableData: Array<{ name: string; local: string; remote: string; status: string }> = [];

        for (const [mcpName, info] of updates) {
          if (info.needsUpdate) {
            needsUpdate.push(mcpName);
            tableData.push({
              name: mcpName,
              local: info.local || '-',
              remote: info.remote || '-',
              status: STATUS.UPDATE,
            });
          } else if (info.local && info.remote) {
            tableData.push({
              name: mcpName,
              local: info.local,
              remote: info.remote,
              status: STATUS.OK,
            });
          } else {
            tableData.push({
              name: mcpName,
              local: info.local || '-',
              remote: info.remote || 'local only',
              status: STATUS.UNKNOWN,
            });
          }
        }

        formatOutput(tableData, 'table');

        if (needsUpdate.length === 0) {
          console.log('');
          printSuccess('All MCPs are up to date!');
          return;
        }

        if (options.check) {
          console.log('');
          printInfo(`${needsUpdate.length} MCP(s) have updates available`);
          printInfo(`Run 'photon upgrade' to upgrade all`);
          return;
        }

        // Upgrade all that need updates
        console.log('');
        printInfo(`Upgrading ${needsUpdate.length} MCP(s)...`);

        for (const mcpName of needsUpdate) {
          const filePath = path.join(workingDir, `${mcpName}.photon.ts`);
          const success = await checker.updateMCP(mcpName, filePath);

          if (success) {
            printSuccess(`Upgraded ${mcpName}`);
          } else {
            printError(`Failed to upgrade ${mcpName}`);
          }
        }
      }
    } catch (error) {
      const { printError } = await import('./cli-formatter.js');
      printError(getErrorMessage(error));
      process.exit(1);
    }
  });


// Clear-cache command: clear compiled photon cache
program
  .command('clear-cache', { hidden: true })
  .argument('[name]', 'MCP name to clear cache for (clears all if omitted)')
  .alias('clean')
  .description('Clear compiled photon cache')
  .action(async (name: string | undefined, options: any, command: Command) => {
    try {
      const { printInfo, printSuccess, printError } = await import('./cli-formatter.js');
      const cacheDir = path.join(os.homedir(), '.cache', 'photon-mcp', 'compiled');

      if (name) {
        // Clear cache for specific photon
        const workingDir = command.parent?.opts().dir || DEFAULT_WORKING_DIR;
        const filePath = await resolvePhotonPath(name, workingDir);

        if (!filePath) {
          printError(`Photon not found: ${name}`);
          printInfo(`Tip: Use 'photon info' to see installed photons`);
          process.exit(1);
        }

        printInfo(`Clearing cache for ${name}...`);

        const cachedFiles = [
          path.join(cacheDir, `${name}.js`),
          path.join(cacheDir, `${name}.js.map`),
        ];

        let cleared = false;
        for (const cachedFile of cachedFiles) {
          try {
            await fs.unlink(cachedFile);
            cleared = true;
          } catch {
            // Ignore if file doesn't exist
          }
        }

        if (cleared) {
          printSuccess(`Cleared cache for ${name}`);
        } else {
          printInfo(`No cache found for ${name}`);
        }
      } else {
        // Clear all cache
        printInfo('Clearing all compiled photon cache...');

        try {
          const files = await fs.readdir(cacheDir);
          let count = 0;

          for (const file of files) {
            const filePath = path.join(cacheDir, file);
            try {
              await fs.unlink(filePath);
              count++;
            } catch {
              // Ignore errors
            }
          }

          if (count > 0) {
            printSuccess(`Cleared ${count} cached file(s)`);
          } else {
            printInfo(`Cache is already empty`);
          }
        } catch (error) {
          if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
            printInfo(`No cache directory found`);
          } else {
            throw error;
          }
        }
      }
    } catch (error) {
      const { printError } = await import('./cli-formatter.js');
      printError(getErrorMessage(error));
      process.exit(1);
    }
  });

// Doctor command: diagnose photon environment
program
  .command('doctor')
  .argument('[name]', 'Photon name to diagnose (checks environment if omitted)')
  .description('Run diagnostics on photon environment, ports, and configuration')
  .option('--port <number>', 'Port to check for availability', '3000')
  .action(async (name: string | undefined, options: any, command: Command) => {
    try {
      const { formatOutput, printHeader, printInfo, printSuccess, printWarning, STATUS } = await import('./cli-formatter.js');
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
        note: majorVersion >= 18 ? 'supported runtime' : 'Photon requires Node.js 18+',
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
        diagnostics['Cache directory'] = { path: cacheDir, status: STATUS.OK, cachedFiles: files.length };
      } catch {
        diagnostics['Cache directory'] = { path: cacheDir, status: STATUS.UNKNOWN, note: 'Created on demand' };
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
        suggestions.push(`Port ${port} is busy. Run Photon with '--port ${port + 1}' or stop the conflicting service.`);
      }

      // Marketplace configuration
      try {
        const { MarketplaceManager } = await import('./marketplace-manager.js');
        const manager = new MarketplaceManager();
        await manager.initialize();
        const enabled = manager.getAll().filter(m => m.enabled);
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
            enabled: enabled.map(m => m.name),
            conflicts: conflicts.size,
          };
          if (conflicts.size > 0) {
            issuesFound++;
            suggestions.push('Resolve duplicate photons with: photon marketplace resolve');
          }
        }
      } catch (error) {
        diagnostics['Marketplaces'] = { status: STATUS.ERROR, error: getErrorMessage(error) };
        suggestions.push('Marketplace config failed to load. Run photon marketplace list to debug.');
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
            photonSection.environment = params.map(param => {
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
                value: value ? 'configured' : param.hasDefault ? `default: ${formatDefaultValue(param.defaultValue)}` : 'missing',
              };
            });
          }

          const cachedFile = path.join(cacheDir, `${name}.js`);
          try {
            await fs.access(cachedFile);
            photonSection.cache = { status: STATUS.OK, note: 'Warm' };
          } catch {
            photonSection.cache = { status: STATUS.WARN, note: 'Not compiled yet (first run will compile)' };
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
program
  .command('cli <photon> [method] [args...]', { hidden: true })
  .description('Run photon methods directly from the command line')
  .allowUnknownOption()
  .helpOption(false) // Disable default help so we can handle it ourselves
  .action(async (photon: string, method: string | undefined, args: string[]) => {
    // Handle help flag
    if (photon === '--help' || photon === '-h') {
      console.log(`USAGE:
    photon cli <photon-name> [method] [args...]

DESCRIPTION:
    Run photon methods directly from the command line. Photons provide
    a CLI interface automatically based on their exported methods.

EXAMPLES:
    # List all methods for a photon
    photon cli lg-remote

    # Call a method with no parameters
    photon cli lg-remote status

    # Call a method with parameters
    photon cli lg-remote volume 50
    photon cli lg-remote volume +5
    photon cli lg-remote volume --level=-3

    # Get method-specific help
    photon cli lg-remote volume --help

    # Output raw JSON instead of formatted text
    photon cli lg-remote status --json

SEE ALSO:
    photon info           List all installed photons
    photon add <name>     Install a photon from marketplace
    photon alias          Create CLI shortcuts for photons
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



// All known commands for "did you mean" suggestions
const knownCommands = [
  'mcp', 'info', 'list', 'ls', 'search',
  'add', 'remove', 'rm', 'upgrade', 'up', 'update',
  'clear-cache', 'clean', 'doctor',
  'cli', 'alias', 'unalias', 'aliases',
  'marketplace', 'maker',
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
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
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
  const parentIndex = args.findIndex(arg => knownSubcommands[arg]);

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

program.parse();

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

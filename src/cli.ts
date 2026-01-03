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
  listRuns,
  getRunInfo,
  deleteRun,
  cleanupRuns,
  executeStatefulGenerator,
  generateRunId,
  StateLog,
  type MCPDependency,
  type MCPServerConfig,
  type WorkflowRun,
} from '@portel/photon-core';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Inline progress renderer for CLI
 * Shows progress bar with animation on a single line
 */
class ProgressRenderer {
  private lastLength = 0;
  private spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  private spinnerIndex = 0;
  private isActive = false;

  /**
   * Render progress inline (overwrites current line)
   */
  render(value: number, message?: string): void {
    this.isActive = true;
    const pct = Math.round(value * 100);
    const barWidth = 20;
    const filled = Math.round(value * barWidth);
    const empty = barWidth - filled;

    // Progress bar: [████████░░░░░░░░░░░░]
    const bar = '█'.repeat(filled) + '░'.repeat(empty);
    const spinner = pct < 100 ? this.spinnerFrames[this.spinnerIndex++ % this.spinnerFrames.length] : '✓';

    const text = `${spinner} [${bar}] ${pct.toString().padStart(3)}%${message ? ` ${message}` : ''}`;

    // Clear previous line and write new content
    this.clearLine();
    process.stdout.write(text);
    this.lastLength = text.length;
  }

  /**
   * Clear the progress line
   */
  clearLine(): void {
    if (this.lastLength > 0) {
      process.stdout.write('\r' + ' '.repeat(this.lastLength) + '\r');
    }
  }

  /**
   * End progress display (moves to new line)
   */
  done(): void {
    if (this.isActive) {
      this.clearLine();
      this.isActive = false;
      this.lastLength = 0;
    }
  }

  /**
   * Print a status message (clears progress first)
   */
  status(message: string): void {
    this.done();
    console.log(`ℹ ${message}`);
  }
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
  console.log(`\n📝 ${ask.message}\n`);

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

      console.log(`${title}${reqMark}:`);
      options.forEach((opt: any, i: number) => {
        const isDefault = opt.value === prop.default ? ' (default)' : '';
        console.log(`  ${i + 1}. ${opt.label}${isDefault}`);
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
        console.log(`${title}${reqMark} (comma-separated numbers):`);
        items.forEach((item: any, i: number) => {
          const label = item.title || item.const || item;
          console.log(`  ${i + 1}. ${label}`);
        });

        const answer = await question(`Choose: `);
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
  }

  rl.close();
  console.log('');

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
  console.log(`\n🔗 ${ask.message}`);
  console.log(`   URL: ${ask.url}\n`);

  // Open URL in default browser
  const platform = process.platform;
  const openCommand =
    platform === 'darwin' ? 'open' :
    platform === 'win32' ? 'start' : 'xdg-open';

  try {
    const { exec } = await import('child_process');
    exec(`${openCommand} "${ask.url}"`);
  } catch (error) {
    console.log(`   (Please open the URL manually in your browser)`);
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
  console.log(`\n${ask.message}`);

  const options = ask.options.map((opt) =>
    typeof opt === 'string' ? { value: opt, label: opt } : opt
  );

  options.forEach((opt, i) => {
    const isDefault = ask.default === opt.value || (Array.isArray(ask.default) && ask.default.includes(opt.value));
    const defaultMark = isDefault ? ' ✓' : '';
    const desc = opt.description ? ` - ${opt.description}` : '';
    console.log(`  ${i + 1}. ${opt.label}${desc}${defaultMark}`);
  });

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
  } catch (error: any) {
    console.error(`Failed to extract constructor params: ${error.message}`);
    return [];
  }
}

/**
 * Convert MCP name and parameter name to environment variable name
 */
function toEnvVarName(mcpName: string, paramName: string): string {
  const mcpPrefix = mcpName.toUpperCase().replace(/-/g, '_');
  const paramSuffix = paramName
    .replace(/([A-Z])/g, '_$1')
    .toUpperCase()
    .replace(/^_/, '');
  return `${mcpPrefix}_${paramSuffix}`;
}

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
  } catch (error: any) {
    // Non-fatal - just warn
    console.error(`   ⚠ Could not update .gitignore: ${error.message}`);
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
    version: '1.0.0',
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
  console.log(`🔍 Validating configuration for: ${mcpName}\n`);

  const params = await extractConstructorParams(filePath);

  if (params.length === 0) {
    console.log('✅ No configuration required');
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
        status: '❌ MISSING (required)',
      });
    } else if (envValue) {
      results.push({
        name: param.name,
        envVar: envVarName,
        status: '✅ SET',
        value: envValue.length > 20 ? envValue.substring(0, 17) + '...' : envValue,
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

  // Print results
  console.log('Configuration Status:\n');
  results.forEach(r => {
    console.log(`  ${r.status} ${r.envVar}`);
    if (r.value) {
      console.log(`     Value: ${r.value}`);
    }
    console.log();
  });

  if (hasErrors) {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('❌ Validation failed: Missing required environment variables');
    console.log('\nRun: photon mcp ' + mcpName + ' --config');
    console.log('     To see configuration template');
    process.exit(1);
  } else {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ Configuration valid!');
    console.log('\nYou can now run: photon mcp ' + mcpName);
  }
}

/**
 * Show configuration template for an MCP
 */
async function showConfigTemplate(filePath: string, mcpName: string, workingDir: string = DEFAULT_WORKING_DIR): Promise<void> {
  console.log(`📋 Configuration template for: ${mcpName}\n`);

  const params = await extractConstructorParams(filePath);

  if (params.length === 0) {
    console.log('✅ No configuration required for this MCP');
    return;
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Environment Variables:\n');

  params.forEach(param => {
    const envVarName = toEnvVarName(mcpName, param.name);
    const isRequired = !param.isOptional && !param.hasDefault;
    const status = isRequired ? '[REQUIRED]' : '[OPTIONAL]';

    console.log(`  ${envVarName} ${status}`);
    console.log(`    Type: ${param.type}`);
    if (param.hasDefault) {
      console.log(`    Default: ${formatDefaultValue(param.defaultValue)}`);
    }
    console.log();
  });

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Claude Desktop Configuration:\n');

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
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`\nAdd this to: ${getConfigPath()}`);
  console.log('\nValidate: photon mcp ' + mcpName + ' --validate');
}

// Get version from package.json
let version = '1.0.0';
try {
  const packageJson = require('../package.json');
  version = packageJson.version;
} catch {
  // Fallback version
}

const program = new Command();

program
  .name('photon')
  .description('Universal runtime for single-file TypeScript programs')
  .version(version)
  .option('--dir <path>', 'Photon directory (default: ~/.photon)', DEFAULT_WORKING_DIR)
  .configureHelp({
    sortSubcommands: false,
    sortOptions: false,
  })
  .addHelpText('after', `
Runtime Commands:
  mcp <name>              Run a photon as MCP server (for AI assistants)
  cli <photon> [method]   Run photon methods from command line

Workflow Commands:
  runs                    List all workflow runs
  run <photon> <method>   Run a stateful workflow (supports checkpoint/resume)
  status <runId>          Get status of a workflow run
  resume <runId>          Resume a paused or interrupted workflow

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
      const { printInfo, printSuccess, printWarning } = await import('./cli-formatter.js');

      // Update all marketplace caches
      printInfo('Refreshing marketplace indexes...\n');

      const { MarketplaceManager } = await import('./marketplace-manager.js');
      const manager = new MarketplaceManager();
      await manager.initialize();

      const results = await manager.updateAllCaches();

      for (const [marketplaceName, success] of results) {
        if (success) {
          printSuccess(`${marketplaceName}`);
        } else {
          printWarning(`${marketplaceName} (no manifest)`);
        }
      }

      const successCount = Array.from(results.values()).filter(Boolean).length;
      console.log('');
      printInfo(`Updated ${successCount}/${results.size} marketplaces`);

      // Check for CLI updates
      console.log('');
      printInfo('Checking for Photon CLI updates...');

      try {
        const { execSync } = await import('child_process');
        const latestVersion = execSync('npm view @portel/photon version', {
          encoding: 'utf-8',
          timeout: 10000,
        }).trim();

        if (latestVersion && latestVersion !== version) {
          console.log('');
          printWarning(`New Photon version available: ${version} → ${latestVersion}`);
          printInfo(`Update with: npm install -g @portel/photon`);
        } else {
          printSuccess(`Photon CLI is up to date (${version})`);
        }
      } catch {
        printWarning('Could not check for CLI updates');
      }

    } catch (error: any) {
      const { printError } = await import('./cli-formatter.js');
      printError(error.message);
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
  .action(async (name: string, options: any, command: Command) => {
    try {
      // Get working directory from global options
      const workingDir = program.opts().dir || DEFAULT_WORKING_DIR;

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

      // Start MCP server
      const server = new PhotonServer({
        filePath,
        devMode: options.dev,
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
        const watcher = new FileWatcher(server, filePath);
        watcher.start();

        // Clean up watcher on shutdown
        process.on('SIGINT', async () => {
          await watcher.stop();
        });
        process.on('SIGTERM', async () => {
          await watcher.stop();
        });
      }
    } catch (error: any) {
      console.error(`❌ Error: ${error.message}`);
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
      const { formatOutput, printInfo, printError, STATUS } = await import('./cli-formatter.js');
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
          // Show info for specific photon - both local and marketplace

          // Show local installation if present
          if (isInstalled) {
            const { PhotonDocExtractor } = await import('./photon-doc-extractor.js');
            const extractor = new PhotonDocExtractor(filePath!);
            const photonMetadata = await extractor.extractFullMetadata();

            const fileName = `${name}.photon.ts`;
            const metadata = await manager.getPhotonInstallMetadata(fileName);
            const isModified = metadata ? await manager.isPhotonModified(filePath!, fileName) : false;

            printInfo(`Installed in ${workingDir}:\n`);

            // Build info as tree structure
            const infoData: Record<string, any> = {
              name: name,
              version: photonMetadata.version || '-',
              location: filePath,
            };

            if (photonMetadata.description) {
              infoData.description = photonMetadata.description;
            }

            if (metadata) {
              infoData.installed = new Date(metadata.installedAt).toLocaleDateString();
              infoData.source = metadata.marketplace;
              if (isModified) {
                infoData.status = 'modified locally';
              }
            }

            const toolCount = photonMetadata.tools?.length || 0;
            if (toolCount > 0) {
              infoData.tools = toolCount;
            }

            formatOutput(infoData, 'tree');

            console.log('');
            // Show appropriate run command
            if (metadata && !isModified) {
              printInfo(`Run with: photon mcp ${name}`);
              printInfo(`To customize: Copy to a new name and run with --dev for hot reload`);
            } else if (metadata && isModified) {
              printInfo(`Run with: photon mcp ${name} --dev`);
              printInfo(`Note: Modified from marketplace - consider renaming to avoid upgrade conflicts`);
            } else {
              printInfo(`Run with: photon mcp ${name} --dev`);
            }
            console.log('');
          }

          // Show marketplace availability in tree format
          const searchResults = await manager.search(name);

          if (searchResults.size > 0) {
            printInfo('Available in marketplaces:\n');

            // Get all sources for this specific photon
            const sources = searchResults.get(name);
            if (sources && sources.length > 0) {
              // Get local installation info to mark which one is installed
              const fileName = `${name}.photon.ts`;
              const installMetadata = await manager.getPhotonInstallMetadata(fileName);

              // Build marketplace data as tree
              const marketplaceData: Record<string, any> = {};
              for (const source of sources) {
                const isCurrentlyInstalled = installMetadata?.marketplace === source.marketplace.name;
                const version = source.metadata?.version || 'unknown';
                marketplaceData[source.marketplace.name] = {
                  version,
                  source: source.marketplace.repo,
                  status: isCurrentlyInstalled ? 'installed' : '-',
                };
              }

              formatOutput(marketplaceData, 'tree');
            }
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
        printInfo(`Installed in ${workingDir} (${mcps.length}):\n`);

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
              version: '-',
              source: 'local',
              status: STATUS.OK,
            });
          }
        }

        formatOutput(tableData, 'table');
        console.log('');
      } else {
        printInfo(`No photons installed in ${workingDir}`);
        printInfo(`Install with: photon add <name>\n`);
      }

      // Show marketplace availability in tree format
      printInfo('Available in marketplaces:\n');

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
    } catch (error: any) {
      const { printError } = await import('./cli-formatter.js');
      printError(error.message);
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
            version: entry.metadata?.version || '-',
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

    } catch (error: any) {
      const { printError } = await import('./cli-formatter.js');
      printError(error.message);
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
    } catch (error: any) {
      console.error(`❌ Error: ${error.message}`);
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
    } catch (error: any) {
      console.error(`❌ Validation failed: ${error.message}`);
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
    } catch (error: any) {
      console.error(`❌ Error: ${error.message}`);
      if (process.env.DEBUG) {
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
    } catch (error: any) {
      console.error(`❌ Error: ${error.message}`);
      if (process.env.DEBUG) {
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
    } catch (error: any) {
      console.error(`❌ Error: ${error.message}`);
      if (process.env.DEBUG) {
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
    } catch (error: any) {
      console.error(`❌ Error: ${error.message}`);
      if (process.env.DEBUG) {
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

    } catch (error: any) {
      const { printError } = await import('./cli-formatter.js');
      printError(error.message);
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
    } catch (error: any) {
      console.error(`❌ Error: ${error.message}`);
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
    } catch (error: any) {
      console.error(`❌ Error: ${error.message}`);
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
    } catch (error: any) {
      console.error(`❌ Error: ${error.message}`);
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
    } catch (error: any) {
      console.error(`❌ Error: ${error.message}`);
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
    } catch (error: any) {
      console.error(`❌ Error: ${error.message}`);
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

    } catch (error: any) {
      const { printError } = await import('./cli-formatter.js');
      printError(error.message);
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
    } catch (error: any) {
      const { printError } = await import('./cli-formatter.js');
      printError(error.message);
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
        } catch (error: any) {
          if (error.code === 'ENOENT') {
            printInfo(`No cache directory found`);
          } else {
            throw error;
          }
        }
      }
    } catch (error: any) {
      const { printError } = await import('./cli-formatter.js');
      printError(error.message);
      process.exit(1);
    }
  });

// Doctor command: diagnose photon environment
program
  .command('doctor', { hidden: true })
  .argument('[name]', 'Photon name to diagnose (checks environment if omitted)')
  .description('Run diagnostics on photon environment and installations')
  .action(async (name: string | undefined, options: any, command: Command) => {
    try {
      const { formatOutput, printInfo, printSuccess, printWarning, STATUS } = await import('./cli-formatter.js');
      const workingDir = command.parent?.opts().dir || DEFAULT_WORKING_DIR;
      let issuesFound = 0;

      printInfo('Running Photon diagnostics...\n');

      // Build diagnostic data
      const diagnostics: Record<string, any> = {};

      // Check Node version
      const nodeVersion = process.version;
      const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0]);
      diagnostics['Node.js'] = {
        version: nodeVersion,
        status: majorVersion >= 18 ? STATUS.OK : STATUS.ERROR,
        note: majorVersion >= 18 ? 'supported' : 'requires Node.js 18+',
      };
      if (majorVersion < 18) issuesFound++;

      // Check npm/npx
      try {
        const { execSync } = await import('child_process');
        const npmVersion = execSync('npm --version', { encoding: 'utf-8' }).trim();
        diagnostics['Package Manager'] = {
          npm: npmVersion,
          status: STATUS.OK,
        };
      } catch {
        diagnostics['Package Manager'] = {
          npm: 'not found',
          status: STATUS.ERROR,
        };
        issuesFound++;
      }

      // Check working directory
      try {
        await fs.access(workingDir);
        const stats = await fs.stat(workingDir);
        if (stats.isDirectory()) {
          const mcps = await listPhotonMCPs(workingDir);
          diagnostics['Working Directory'] = {
            path: workingDir,
            status: STATUS.OK,
            photons: mcps.length,
          };
        } else {
          diagnostics['Working Directory'] = {
            path: workingDir,
            status: STATUS.ERROR,
            note: 'not a directory',
          };
          issuesFound++;
        }
      } catch {
        diagnostics['Working Directory'] = {
          path: workingDir,
          status: STATUS.UNKNOWN,
          note: 'will be created on first use',
        };
      }

      // Check cache directory
      const cacheDir = path.join(os.homedir(), '.cache', 'photon-mcp', 'compiled');
      try {
        await fs.access(cacheDir);
        const files = await fs.readdir(cacheDir);
        diagnostics['Cache Directory'] = {
          path: cacheDir,
          status: STATUS.OK,
          cachedFiles: files.length,
        };
      } catch {
        diagnostics['Cache Directory'] = {
          path: cacheDir,
          status: STATUS.UNKNOWN,
          note: 'will be created on first use',
        };
      }

      // Check marketplaces and conflicts
      let manager: any;
      try {
        const { MarketplaceManager } = await import('./marketplace-manager.js');
        manager = new MarketplaceManager();
        await manager.initialize();
        const marketplaces = manager.getAll();
        const enabled = marketplaces.filter((m: any) => m.enabled);

        if (enabled.length > 0) {
          // Check for conflicts
          const conflicts = await manager.detectAllConflicts();
          if (conflicts.size > 0) {
            diagnostics['Marketplaces'] = {
              enabled: enabled.length,
              status: STATUS.WARN,
              sources: enabled.map((m: any) => m.name),
              conflicts: `${conflicts.size} photon(s) in multiple marketplaces`,
            };
            issuesFound++;
          } else {
            diagnostics['Marketplaces'] = {
              enabled: enabled.length,
              status: STATUS.OK,
              sources: enabled.map((m: any) => m.name),
            };
          }
        } else {
          diagnostics['Marketplaces'] = {
            enabled: 0,
            status: STATUS.UNKNOWN,
            note: 'Add one with: photon marketplace add portel-dev/photons',
          };
        }
      } catch (error: any) {
        diagnostics['Marketplaces'] = {
          status: STATUS.ERROR,
          error: error.message,
        };
        issuesFound++;
      }

      // Check specific photon if provided
      if (name) {
        const photonDiag: Record<string, any> = {};

        const filePath = await resolvePhotonPath(name, workingDir);
        if (!filePath) {
          photonDiag['location'] = 'not found';
          photonDiag['status'] = STATUS.ERROR;
          issuesFound++;
        } else {
          photonDiag['location'] = filePath;
          photonDiag['status'] = STATUS.OK;

          // Check if it compiles
          try {
            const source = await fs.readFile(filePath, 'utf-8');
            const extractor = new SchemaExtractor();
            const params = extractor.extractConstructorParams(source);
            photonDiag['syntax'] = STATUS.OK;
            photonDiag['constructorParams'] = params.length;
          } catch (error: any) {
            photonDiag['syntax'] = STATUS.ERROR;
            photonDiag['syntaxError'] = error.message;
            issuesFound++;
          }

          // Check cache
          const cachedFile = path.join(cacheDir, `${name}.js`);
          try {
            await fs.access(cachedFile);
            photonDiag['cache'] = STATUS.OK;
          } catch {
            photonDiag['cache'] = 'not cached yet';
          }

          // Check dependencies and security
          try {
            const { DependencyManager } = await import('@portel/photon-core');
            const depManager = new DependencyManager();
            const dependencies = await depManager.extractDependencies(filePath);
            if (dependencies.length > 0) {
              photonDiag['dependencies'] = dependencies.map(dep => `${dep.name}@${dep.version}`);

              // Security audit
              try {
                const { SecurityScanner } = await import('./security-scanner.js');
                const scanner = new SecurityScanner();
                const depStrings = dependencies.map(d => `${d.name}@${d.version}`);
                const result = await scanner.auditMCP(name, depStrings);

                if (result.totalVulnerabilities > 0) {
                  photonDiag['security'] = STATUS.ERROR;
                  photonDiag['vulnerabilities'] = `${result.totalVulnerabilities} (${result.criticalCount} critical, ${result.highCount} high)`;
                  issuesFound++;
                } else {
                  photonDiag['security'] = STATUS.OK;
                }
              } catch {
                photonDiag['security'] = 'could not check';
              }
            } else {
              photonDiag['dependencies'] = 'none';
              photonDiag['security'] = STATUS.OK;
            }
          } catch (error: any) {
            photonDiag['dependencies'] = `error: ${error.message}`;
          }
        }

        diagnostics[`Photon: ${name}`] = photonDiag;
      }

      formatOutput(diagnostics, 'tree');

      // Summary
      console.log('');
      if (issuesFound === 0) {
        printSuccess('No issues found! Photon environment is healthy.');
      } else {
        printWarning(`Found ${issuesFound} issue(s). Please address the items marked with '${STATUS.ERROR}' above.`);
        process.exit(1);
      }
    } catch (error: any) {
      const { printError } = await import('./cli-formatter.js');
      printError(error.message);
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

// ═══════════════════════════════════════════════════════════════════════════════
// WORKFLOW COMMANDS - Stateful workflow execution with checkpoints
// ═══════════════════════════════════════════════════════════════════════════════

program
  .command('runs')
  .description('List all workflow runs')
  .option('--status <status>', 'Filter by status (running, waiting, completed, failed, paused)')
  .option('--limit <n>', 'Maximum number of runs to show', '20')
  .option('--json', 'Output as JSON')
  .action(async (options: any) => {
    const { printInfo, printError, printSuccess, printWarning } = await import('./cli-formatter.js');

    try {
      const runs = await listRuns();

      // Filter by status if specified
      let filtered = runs;
      if (options.status) {
        filtered = runs.filter(r => r.status === options.status);
      }

      // Limit results
      const limit = parseInt(options.limit, 10);
      filtered = filtered.slice(0, limit);

      if (options.json) {
        console.log(JSON.stringify(filtered, null, 2));
        return;
      }

      if (filtered.length === 0) {
        printInfo('No workflow runs found');
        return;
      }

      console.log('');
      printInfo(`Workflow Runs (${filtered.length}/${runs.length}):\n`);

      for (const run of filtered) {
        const statusIcon = {
          running: '▶',
          waiting: '⏸',
          completed: '✓',
          failed: '✗',
          paused: '⏹',
        }[run.status] || '?';

        const statusColor = {
          running: '\x1b[34m',
          waiting: '\x1b[33m',
          completed: '\x1b[32m',
          failed: '\x1b[31m',
          paused: '\x1b[90m',
        }[run.status] || '';

        const reset = '\x1b[0m';
        const dim = '\x1b[2m';

        const age = formatAge(Date.now() - run.startedAt);

        console.log(`  ${statusColor}${statusIcon}${reset} ${run.runId}`);
        console.log(`    ${dim}Tool: ${run.tool}${reset}`);
        console.log(`    ${dim}Status: ${run.status} | Started: ${age} ago${reset}`);

        if (run.lastCheckpoint) {
          console.log(`    ${dim}Last checkpoint: ${run.lastCheckpoint.id}${reset}`);
        }
        console.log('');
      }
    } catch (error: any) {
      printError(`Failed to list runs: ${error.message}`);
      process.exit(1);
    }
  });

program
  .command('run <photon> <method>')
  .description('Run a stateful workflow (supports checkpoint/resume)')
  .option('--id <runId>', 'Custom run ID (auto-generated if not provided)')
  .option('--resume', 'Resume from last checkpoint if run exists')
  .option('--param <key=value>', 'Pass parameters (can be repeated)', collectParams, {})
  .option('--json', 'Output result as JSON')
  .action(async (photonName: string, methodName: string, options: any) => {
    const { printInfo, printError, printSuccess, printWarning } = await import('./cli-formatter.js');
    const { PhotonLoader } = await import('./loader.js');

    try {
      // Resolve photon path
      const workingDir = program.opts().dir;
      const photonPath = await resolvePhotonPath(photonName, workingDir);

      if (!photonPath) {
        printError(`Photon not found: ${photonName}`);
        process.exit(1);
      }

      // Load photon
      const loader = new PhotonLoader();
      const photon = await loader.loadFile(photonPath);

      // Find the method
      const tool = photon.tools.find(t => t.name === methodName);
      if (!tool) {
        printError(`Method not found: ${methodName}`);
        printInfo(`Available methods: ${photon.tools.map(t => t.name).join(', ')}`);
        process.exit(1);
      }

      // Check if it's a stateful method (isStateful flag or isGenerator)
      const schema = photon.tools.find(t => t.name === methodName);

      const runId = options.id || generateRunId();
      const params = options.param || {};

      printInfo(`Starting workflow: ${photonName}.${methodName}`);
      printInfo(`Run ID: ${runId}\n`);

      // Get the method from the instance
      const method = photon.instance[methodName];
      if (typeof method !== 'function') {
        printError(`${methodName} is not a function`);
        process.exit(1);
      }

      // Inline progress renderer
      const progress = new ProgressRenderer();

      // Execute the stateful workflow
      const result = await executeStatefulGenerator(
        () => method.call(photon.instance, params),
        {
          runId,
          photon: photonName,
          tool: methodName,
          params,
          resume: options.resume,
          inputProvider: async (ask) => {
            // Clear progress before asking for input
            progress.done();

            // Handle form-based elicitation (MCP-aligned)
            if (ask.ask === 'form') {
              return handleFormElicitation(ask as any);
            }

            // Handle URL elicitation (OAuth flows)
            if (ask.ask === 'url') {
              return handleUrlElicitation(ask as any);
            }

            // Handle select with options
            if (ask.ask === 'select') {
              return handleSelectElicitation(ask as any);
            }

            const rl = readline.createInterface({
              input: process.stdin,
              output: process.stderr,
            });

            return new Promise((resolve) => {
              rl.question(`${ask.message} `, (answer) => {
                rl.close();
                if (ask.ask === 'confirm') {
                  resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
                } else if (ask.ask === 'number') {
                  resolve(parseFloat(answer));
                } else {
                  resolve(answer);
                }
              });
            });
          },
          outputHandler: (emit) => {
            if (emit.emit === 'status') {
              progress.status((emit as any).message);
            } else if (emit.emit === 'progress') {
              progress.render((emit as any).value, (emit as any).message);
            } else if (emit.emit === 'log') {
              progress.done();
              console.error(`[${(emit as any).level || 'info'}] ${(emit as any).message}`);
            } else if (emit.emit === 'toast') {
              progress.done();
              const toast = emit as any;
              if (toast.type === 'success') {
                printSuccess(toast.message);
              } else if (toast.type === 'error') {
                printError(toast.message);
              } else {
                printInfo(toast.message);
              }
            }
          },
        }
      );

      // Clear progress line before final output
      progress.done();

      console.log('');

      if (result.error) {
        printError(`Workflow failed: ${result.error}`);
        process.exit(1);
      }

      if (options.json) {
        console.log(JSON.stringify(result.result, null, 2));
      } else {
        printSuccess(`Workflow completed!`);
        if (result.result !== undefined) {
          console.log('');
          console.log('Result:');
          console.log(JSON.stringify(result.result, null, 2));
        }
      }

      if (result.resumed) {
        printInfo('(Resumed from previous checkpoint)');
      }
    } catch (error: any) {
      printError(`Failed to run workflow: ${error.message}`);
      process.exit(1);
    }
  });

program
  .command('status <runId>')
  .description('Get status of a workflow run')
  .option('--json', 'Output as JSON')
  .option('--log', 'Show full JSONL log')
  .action(async (runId: string, options: any) => {
    const { printInfo, printError, printSuccess, printWarning } = await import('./cli-formatter.js');

    try {
      const run = await getRunInfo(runId);

      if (!run) {
        printError(`Run not found: ${runId}`);
        process.exit(1);
      }

      if (options.json) {
        console.log(JSON.stringify(run, null, 2));
        return;
      }

      console.log('');
      printInfo(`Workflow Run: ${runId}\n`);

      const statusIcon = {
        running: '▶ Running',
        waiting: '⏸ Waiting for input',
        completed: '✓ Completed',
        failed: '✗ Failed',
        paused: '⏹ Paused',
      }[run.status] || run.status;

      console.log(`  Status: ${statusIcon}`);
      console.log(`  Tool: ${run.tool}`);
      console.log(`  Started: ${new Date(run.startedAt).toLocaleString()}`);
      console.log(`  Updated: ${new Date(run.updatedAt).toLocaleString()}`);

      if (run.completedAt) {
        console.log(`  Completed: ${new Date(run.completedAt).toLocaleString()}`);
      }

      if (run.lastCheckpoint) {
        console.log(`  Last Checkpoint: ${run.lastCheckpoint.id}`);
        console.log(`    State: ${JSON.stringify(run.lastCheckpoint.state)}`);
      }

      if (run.result !== undefined) {
        console.log(`  Result: ${JSON.stringify(run.result)}`);
      }

      if (run.error) {
        console.log(`  Error: ${run.error}`);
      }

      if (options.log) {
        console.log('');
        printInfo('Log entries:\n');
        const log = new StateLog(runId);
        const entries = await log.readAll();
        for (const entry of entries) {
          console.log(`  ${new Date(entry.ts).toISOString()} [${entry.t}]`);
          const { t, ts, ...rest } = entry;
          if (Object.keys(rest).length > 0) {
            console.log(`    ${JSON.stringify(rest)}`);
          }
        }
      }

      console.log('');
    } catch (error: any) {
      printError(`Failed to get status: ${error.message}`);
      process.exit(1);
    }
  });

program
  .command('resume <runId>')
  .description('Resume a paused or interrupted workflow')
  .option('--json', 'Output result as JSON')
  .action(async (runId: string, options: any) => {
    const { printInfo, printError, printSuccess, printWarning } = await import('./cli-formatter.js');
    const { PhotonLoader } = await import('./loader.js');

    try {
      const run = await getRunInfo(runId);

      if (!run) {
        printError(`Run not found: ${runId}`);
        process.exit(1);
      }

      if (run.status === 'completed') {
        printSuccess(`Run already completed`);
        if (run.result !== undefined) {
          console.log('Result:', JSON.stringify(run.result, null, 2));
        }
        return;
      }

      if (run.status === 'failed') {
        printError(`Run failed with error: ${run.error}`);
        printInfo(`Cannot resume a failed workflow. Start a new run instead.`);
        process.exit(1);
      }

      // Find the photon by matching tool name to installed photons
      const workingDir = program.opts().dir;
      const photonNames = await listPhotonMCPs(workingDir);

      // Try to find photon by checking which one has this tool
      let photonPath: string | null = null;
      let photonInstance: any = null;
      const loader = new PhotonLoader();

      for (const photonName of photonNames) {
        const pPath = await resolvePhotonPath(photonName, workingDir);
        if (pPath) {
          const loaded = await loader.loadFile(pPath);
          if (loaded.tools.some(t => t.name === run.tool)) {
            photonPath = pPath;
            photonInstance = loaded.instance;
            break;
          }
        }
      }

      if (!photonPath || !photonInstance) {
        printError(`Could not find photon with tool: ${run.tool}`);
        process.exit(1);
      }

      const method = photonInstance[run.tool];
      if (typeof method !== 'function') {
        printError(`${run.tool} is not a function`);
        process.exit(1);
      }

      printInfo(`Resuming workflow: ${run.tool}`);
      printInfo(`Run ID: ${runId}\n`);

      // Inline progress renderer
      const progress = new ProgressRenderer();

      const result = await executeStatefulGenerator(
        () => method.call(photonInstance, run.params),
        {
          runId,
          photon: run.photon,
          tool: run.tool,
          params: run.params,
          resume: true,
          inputProvider: async (ask) => {
            progress.done();

            // Handle form-based elicitation (MCP-aligned)
            if (ask.ask === 'form') {
              return handleFormElicitation(ask as any);
            }

            // Handle URL elicitation (OAuth flows)
            if (ask.ask === 'url') {
              return handleUrlElicitation(ask as any);
            }

            // Handle select with options
            if (ask.ask === 'select') {
              return handleSelectElicitation(ask as any);
            }

            const rl = readline.createInterface({
              input: process.stdin,
              output: process.stderr,
            });

            return new Promise((resolve) => {
              rl.question(`${ask.message} `, (answer) => {
                rl.close();
                if (ask.ask === 'confirm') {
                  resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
                } else if (ask.ask === 'number') {
                  resolve(parseFloat(answer));
                } else {
                  resolve(answer);
                }
              });
            });
          },
          outputHandler: (emit) => {
            if (emit.emit === 'status') {
              progress.status((emit as any).message);
            } else if (emit.emit === 'progress') {
              progress.render((emit as any).value, (emit as any).message);
            } else if (emit.emit === 'log') {
              progress.done();
              console.error(`[${(emit as any).level || 'info'}] ${(emit as any).message}`);
            } else if (emit.emit === 'toast') {
              progress.done();
              const toast = emit as any;
              if (toast.type === 'success') {
                printSuccess(toast.message);
              } else if (toast.type === 'error') {
                printError(toast.message);
              } else {
                printInfo(toast.message);
              }
            }
          },
        }
      );

      progress.done();
      console.log('');

      if (result.error) {
        printError(`Workflow failed: ${result.error}`);
        process.exit(1);
      }

      if (options.json) {
        console.log(JSON.stringify(result.result, null, 2));
      } else {
        printSuccess(`Workflow completed!`);
        if (result.result !== undefined) {
          console.log('');
          console.log('Result:');
          console.log(JSON.stringify(result.result, null, 2));
        }
      }
    } catch (error: any) {
      printError(`Failed to resume workflow: ${error.message}`);
      process.exit(1);
    }
  });

program
  .command('runs:clean')
  .description('Clean up old completed/failed workflow runs')
  .option('--days <n>', 'Delete runs older than N days', '7')
  .option('--dry-run', 'Show what would be deleted without deleting')
  .action(async (options: any) => {
    const { printInfo, printError, printSuccess } = await import('./cli-formatter.js');

    try {
      const days = parseInt(options.days, 10);
      const maxAgeMs = days * 24 * 60 * 60 * 1000;

      if (options.dryRun) {
        const runs = await listRuns();
        const cutoff = Date.now() - maxAgeMs;
        const toDelete = runs.filter(
          r => (r.status === 'completed' || r.status === 'failed') && r.updatedAt < cutoff
        );

        printInfo(`Would delete ${toDelete.length} runs older than ${days} days:`);
        for (const run of toDelete) {
          console.log(`  - ${run.runId} (${run.status})`);
        }
      } else {
        const deleted = await cleanupRuns(maxAgeMs);
        printSuccess(`Cleaned up ${deleted} old workflow runs`);
      }
    } catch (error: any) {
      printError(`Failed to clean runs: ${error.message}`);
      process.exit(1);
    }
  });

/**
 * Format age in human-readable format
 */
function formatAge(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

/**
 * Collect --param options into an object
 */
function collectParams(value: string, previous: Record<string, any>): Record<string, any> {
  const [key, ...rest] = value.split('=');
  let val: any = rest.join('=');

  // Try to parse as JSON
  try {
    val = JSON.parse(val);
  } catch {
    // Keep as string
  }

  previous[key] = val;
  return previous;
}

// All known commands for "did you mean" suggestions
const knownCommands = [
  'mcp', 'info', 'list', 'ls', 'search',
  'add', 'remove', 'rm', 'upgrade', 'up', 'update',
  'clear-cache', 'clean', 'doctor',
  'cli', 'alias', 'unalias', 'aliases',
  'marketplace', 'maker',
  'runs', 'run', 'status', 'resume', 'runs:clean',
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

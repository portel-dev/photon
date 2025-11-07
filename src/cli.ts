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
import { PhotonServer } from './server.js';
import { FileWatcher } from './watcher.js';
import { resolvePhotonPath, listPhotonMCPs, ensureWorkingDir, DEFAULT_WORKING_DIR } from './path-resolver.js';
import { SchemaExtractor } from './schema-extractor.js';
import { ConstructorParam } from './types.js';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
  options: { name?: string; description?: string; owner?: string }
): Promise<void> {
  const resolvedPath = path.resolve(dirPath);

  if (!existsSync(resolvedPath)) {
    console.error(`❌ Directory not found: ${resolvedPath}`);
    process.exit(1);
  }

  // Scan for .photon.ts files
  console.error('📦 Scanning for .photon.ts files...');
  const files = await fs.readdir(resolvedPath);
  const photonFiles = files.filter(f => f.endsWith('.photon.ts'));

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
 * Format default value for display in config
 */
function formatDefaultValue(value: any): string {
  if (typeof value === 'string') {
    // Check if it's a function call expression
    if (value.includes('homedir()')) {
      // Replace homedir() with actual home directory
      return value.replace(/join\(homedir\(\),\s*['"]([^'"]+)['"]\)/g, (_, folderName) => {
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
async function showConfigTemplate(filePath: string, mcpName: string): Promise<void> {
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

  const config = {
    mcpServers: {
      [mcpName]: {
        command: 'npx',
        args: ['@portel/photon', 'mcp', mcpName],
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
  .option('--working-dir <dir>', 'Working directory for Photons (default: ~/.photon)', DEFAULT_WORKING_DIR);

// MCP Runtime: run a .photon.ts file as MCP server
program
  .command('mcp')
  .argument('<name>', 'MCP name (without .photon.ts extension)')
  .description('Run a Photon as MCP server')
  .option('--dev', 'Enable development mode with hot reload')
  .option('--validate', 'Validate configuration without running server')
  .option('--config', 'Show configuration template and exit')
  .action(async (name: string, options: any, command: Command) => {
    try {
      // Get working directory from global options
      const workingDir = program.opts().workingDir || DEFAULT_WORKING_DIR;

      // Resolve file path from name in working directory
      const filePath = await resolvePhotonPath(name, workingDir);

      if (!filePath) {
        console.error(`❌ MCP not found: ${name}`);
        console.error(`Searched in: ${workingDir}`);
        console.error(`Tip: Use 'photon list' to see available MCPs`);
        process.exit(1);
      }

      // Handle --validate flag
      if (options.validate) {
        await validateConfiguration(filePath, name);
        return;
      }

      // Handle --config flag
      if (options.config) {
        await showConfigTemplate(filePath, name);
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

// Init command: create a new .photon.ts from template
program
  .command('init')
  .argument('<name>', 'Name for the new Photon MCP')
  .description('Create a new .photon.ts from template')
  .action(async (name: string, options: any, command: Command) => {
    try {
      // Get working directory from global options
      const workingDir = command.parent?.opts().workingDir || DEFAULT_WORKING_DIR;

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

// Validate command: check syntax and schemas
program
  .command('validate')
  .argument('<name>', 'MCP name (without .photon.ts extension)')
  .description('Validate syntax and schemas without running')
  .action(async (name: string, options: any, command: Command) => {
    try {
      // Get working directory from global options
      const workingDir = command.parent?.opts().workingDir || DEFAULT_WORKING_DIR;

      // Resolve file path from name in working directory
      const filePath = await resolvePhotonPath(name, workingDir);

      if (!filePath) {
        console.error(`❌ MCP not found: ${name}`);
        console.error(`Searched in: ${workingDir}`);
        console.error(`Tip: Use 'photon list' to see available MCPs`);
        process.exit(1);
      }

      console.error(`Validating ${path.basename(filePath)}...\n`);

      // Import loader and try to load
      const { PhotonLoader } = await import('./loader.js');
      const loader = new PhotonLoader(false); // quiet mode for inspection

      const mcp = await loader.loadFile(filePath);

      console.error(`✅ Valid Photon MCP`);
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

// Get command: list all Photons or show details for one
program
  .command('get')
  .argument('[name]', 'Photon name to show details for (shows all if omitted)')
  .option('--mcp', 'Output as MCP server configuration')
  .description('List Photons or show details for one')
  .action(async (name: string | undefined, options: any, command: Command) => {
    try {
      // Get working directory from global/parent options
      const parentOpts = command.parent?.opts() || {};
      const workingDir = parentOpts.workingDir || DEFAULT_WORKING_DIR;
      const asMcp = options.mcp || false;

      const mcps = await listPhotonMCPs(workingDir);

      if (mcps.length === 0) {
        console.error(`No Photons found in ${workingDir}`);
        console.error(`Create one with: photon init <name>`);
        return;
      }

      // Show single Photon details
      if (name) {
        const filePath = await resolvePhotonPath(name, workingDir);
        if (!filePath) {
          console.error(`❌ Photon not found: ${name}`);
          console.error(`Searched in: ${workingDir}`);
          console.error(`Tip: Use 'photon get' to see available Photons`);
          process.exit(1);
        }

        if (asMcp) {
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

          const config = {
            command: 'npx',
            args: ['@portel/photon', 'mcp', name],
            ...(Object.keys(env).length > 0 && { env }),
          };

          // Get OS-specific config path
          const configPath = getConfigPath();
          console.log(`# Photon MCP Server Configuration: ${name}`);
          console.log(`# Add to mcpServers in: ${configPath}\n`);
          console.log(JSON.stringify({ [name]: config }, null, 2));
        } else {
          // Show Photon details
          const { PhotonLoader } = await import('./loader.js');
          const loader = new PhotonLoader(false); // quiet mode for inspection
          const mcp = await loader.loadFile(filePath);

          const { MarketplaceManager } = await import('./marketplace-manager.js');
          const manager = new MarketplaceManager();
          await manager.initialize();

          const fileName = `${name}.photon.ts`;
          const metadata = await manager.getPhotonInstallMetadata(fileName);
          const isModified = metadata ? await manager.isPhotonModified(filePath, fileName) : false;

          console.error(`📦 ${name}\n`);
          console.error(`Location: ${filePath}`);

          // Show marketplace metadata if available
          if (metadata) {
            console.error(`Version: ${metadata.version}`);
            console.error(`Marketplace: ${metadata.marketplace} (${metadata.marketplaceRepo})`);
            console.error(`Installed: ${new Date(metadata.installedAt).toLocaleDateString()}`);
            if (isModified) {
              console.error(`Status: ⚠️  Modified locally`);
            }
          }

          console.error(`Tools: ${mcp.tools.length}`);
          console.error(`Templates: ${mcp.templates.length}`);
          console.error(`Resources: ${mcp.statics.length}\n`);

          if (mcp.tools.length > 0) {
            console.error('Tools:');
            for (const tool of mcp.tools) {
              console.error(`  • ${tool.name}: ${tool.description || 'No description'}`);
            }
            console.error('');
          }

          if (mcp.templates.length > 0) {
            console.error('Templates:');
            for (const template of mcp.templates) {
              console.error(`  • ${template.name}: ${template.description || 'No description'}`);
            }
            console.error('');
          }

          if (mcp.statics.length > 0) {
            console.error('Resources:');
            for (const resource of mcp.statics) {
              console.error(`  • ${resource.uri}: ${resource.name || 'No name'}`);
            }
            console.error('');
          }

          console.error(`Run with: photon mcp ${name} --dev`);
        }
        return;
      }

      // Show all Photons
      if (asMcp) {
        // MCP config mode for all Photons
        const allConfigs: Record<string, any> = {};

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

          allConfigs[mcpName] = {
            command: 'npx',
            args: ['@portel/photon', 'mcp', mcpName],
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

      // Normal list mode - show with metadata
      console.error(`Photons in ${workingDir} (${mcps.length}):\n`);

      const { MarketplaceManager } = await import('./marketplace-manager.js');
      const manager = new MarketplaceManager();
      await manager.initialize();

      for (const mcpName of mcps) {
        const fileName = `${mcpName}.photon.ts`;
        const filePath = path.join(workingDir, fileName);

        // Get installation metadata
        const metadata = await manager.getPhotonInstallMetadata(fileName);

        if (metadata) {
          // Has metadata - show version and status
          const isModified = await manager.isPhotonModified(filePath, fileName);
          const modifiedMark = isModified ? ' ⚠️  modified' : '';

          console.error(`  📦 ${mcpName} (v${metadata.version} from ${metadata.marketplace})${modifiedMark}`);
        } else {
          // No metadata - local or pre-metadata Photon
          console.error(`  📦 ${mcpName}`);
        }
      }

      console.error(`\nRun: photon mcp <name> --dev`);
      console.error(`Details: photon get <name>`);
      console.error(`MCP config: photon get --mcp`);
    } catch (error: any) {
      console.error(`❌ Error: ${error.message}`);
      process.exit(1);
    }
  });

// Search command: search for MCPs across marketplaces
program
  .command('search')
  .argument('<query>', 'MCP name or keyword to search for')
  .description('Search for MCP in all enabled marketplaces')
  .action(async (query: string) => {
    try {
      const { MarketplaceManager } = await import('./marketplace-manager.js');
      const manager = new MarketplaceManager();
      await manager.initialize();

      // Auto-update stale caches
      const updated = await manager.autoUpdateStaleCaches();
      if (updated) {
        console.error('🔄 Refreshed marketplace data...\n');
      }

      console.error(`Searching for '${query}' in marketplaces...`);

      const results = await manager.search(query);

      if (results.size === 0) {
        console.error(`❌ No results found for '${query}'`);
        console.error(`Tip: Run 'photon marketplace update' to manually refresh marketplace data`);
        return;
      }

      console.error('');
      for (const [mcpName, entries] of results) {
        for (const entry of entries) {
          if (entry.metadata) {
            console.error(`  📦 ${mcpName} (v${entry.metadata.version})`);
            console.error(`     ${entry.metadata.description}`);
            console.error(`     ${entry.marketplace.name} (${entry.marketplace.repo})`);
            if (entry.metadata.tags && entry.metadata.tags.length > 0) {
              console.error(`     Tags: ${entry.metadata.tags.join(', ')}`);
            }
          } else {
            console.error(`  📦 ${mcpName}`);
            console.error(`     ✓ ${entry.marketplace.name} (${entry.marketplace.repo})`);
          }
        }
      }
      console.error('');
    } catch (error: any) {
      console.error(`❌ Error: ${error.message}`);
      process.exit(1);
    }
  });

// Info command: show detailed MCP information
program
  .command('info')
  .argument('<name>', 'MCP name to show information for')
  .description('Show detailed MCP information from marketplaces')
  .action(async (name: string) => {
    try {
      const { MarketplaceManager } = await import('./marketplace-manager.js');
      const manager = new MarketplaceManager();
      await manager.initialize();

      // Auto-update stale caches
      await manager.autoUpdateStaleCaches();

      const result = await manager.getPhotonMetadata(name);

      if (!result) {
        console.error(`❌ MCP '${name}' not found in any marketplace`);
        console.error(`Tip: Use 'photon search ${name}' to find similar MCPs`);
        process.exit(1);
      }

      const { metadata, marketplace } = result;

      console.error('');
      console.error(`  📦 ${metadata.name} (v${metadata.version})`);
      console.error(`     ${metadata.description}`);
      console.error('');
      console.error(`  Marketplace: ${marketplace.name} (${marketplace.repo})`);
      if (metadata.author) {
        console.error(`  Author: ${metadata.author}`);
      }
      if (metadata.license) {
        console.error(`  License: ${metadata.license}`);
      }
      if (metadata.homepage) {
        console.error(`  Homepage: ${metadata.homepage}`);
      }
      if (metadata.tags && metadata.tags.length > 0) {
        console.error(`  Tags: ${metadata.tags.join(', ')}`);
      }
      if (metadata.tools && metadata.tools.length > 0) {
        console.error(`  Tools: ${metadata.tools.join(', ')}`);
      }
      console.error('');
      console.error(`  To add: photon add ${metadata.name}`);
      console.error('');
    } catch (error: any) {
      console.error(`❌ Error: ${error.message}`);
      process.exit(1);
    }
  });

// Sync command: synchronize local resources
const sync = program
  .command('sync')
  .description('Synchronize local resources');

sync
  .command('marketplace')
  .argument('[path]', 'Directory containing Photons (defaults to current directory)', '.')
  .option('--name <name>', 'Marketplace name')
  .option('--description <desc>', 'Marketplace description')
  .option('--owner <owner>', 'Owner name')
  .description('Generate/sync marketplace manifest and documentation')
  .action(async (dirPath: string, options: any) => {
    try {
      await performMarketplaceSync(dirPath, options);
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
  .command('marketplace')
  .description('Manage MCP marketplaces');

marketplace
  .command('sync', { hidden: true })
  .argument('[path]', 'Directory containing Photons (defaults to current directory)', '.')
  .option('--name <name>', 'Marketplace name')
  .option('--description <desc>', 'Marketplace description')
  .option('--owner <owner>', 'Owner name')
  .description('(Deprecated: use "photon sync marketplace") Generate/sync marketplace manifest and documentation')
  .action(async (dirPath: string, options: any) => {
    console.error('⚠️  Note: "photon marketplace sync" is deprecated. Use "photon sync marketplace" instead.\n');
    try {
      await performMarketplaceSync(dirPath, options);
    } catch (error: any) {
      console.error(`❌ Error: ${error.message}`);
      if (process.env.DEBUG) {
        console.error(error.stack);
      }
      process.exit(1);
    }
  });

// Backwards compatibility: 'init' as hidden alias for 'sync'
marketplace
  .command('init', { hidden: true })
  .argument('[path]', 'Directory containing Photons (defaults to current directory)', '.')
  .option('--name <name>', 'Marketplace name')
  .option('--description <desc>', 'Marketplace description')
  .option('--owner <owner>', 'Owner name')
  .description('(Deprecated: use "sync") Initialize a directory as a Photon marketplace')
  .action(async (dirPath: string, options: any) => {
    console.error('⚠️  "marketplace init" is deprecated. Please use "marketplace sync" instead.\n');
    // Call the same handler - will be refactored into shared function later
    await program.commands.find(cmd => cmd.name() === 'marketplace')
      ?.commands.find(cmd => cmd.name() === 'sync')
      ?.parseAsync(['sync', dirPath], { from: 'user' });
  });

marketplace
  .command('list')
  .description('List all configured marketplaces')
  .action(async () => {
    try {
      const { MarketplaceManager } = await import('./marketplace-manager.js');
      const manager = new MarketplaceManager();
      await manager.initialize();

      const marketplaces = manager.getAll();

      if (marketplaces.length === 0) {
        console.error('No marketplaces configured');
        return;
      }

      // Get MCP counts
      const counts = await manager.getMarketplaceCounts();

      console.error(`Configured marketplaces (${marketplaces.length}):\n`);

      for (const marketplace of marketplaces) {
        const status = marketplace.enabled ? '✅' : '❌';
        const count = counts.get(marketplace.name) || 0;
        const countStr = count > 0 ? `${count} available` : 'no manifest';

        console.error(`  ${status} ${marketplace.name}`);
        console.error(`     ${marketplace.repo}`);
        console.error(`     ${countStr}`);
        if (marketplace.lastUpdated) {
          const date = new Date(marketplace.lastUpdated);
          console.error(`     Updated ${date.toLocaleDateString()}`);
        }
      }

      console.error('');
    } catch (error: any) {
      console.error(`❌ Error: ${error.message}`);
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

marketplace
  .command('update')
  .argument('[name]', 'Marketplace name to update (updates all if omitted)')
  .description('Update marketplace metadata from remote')
  .action(async (name: string | undefined) => {
    try {
      const { MarketplaceManager } = await import('./marketplace-manager.js');
      const manager = new MarketplaceManager();
      await manager.initialize();

      if (name) {
        // Update specific marketplace
        console.error(`Updating ${name}...`);
        const success = await manager.updateMarketplaceCache(name);

        if (success) {
          console.error(`✅ Updated ${name}`);
        } else {
          console.error(`❌ Failed to update ${name} (not found or no manifest)`);
          process.exit(1);
        }
      } else {
        // Update all enabled marketplaces
        console.error(`Updating all marketplaces...\n`);
        const results = await manager.updateAllCaches();

        for (const [marketplaceName, success] of results) {
          if (success) {
            console.error(`  ✅ ${marketplaceName}`);
          } else {
            console.error(`  ⚠️  ${marketplaceName} (no manifest)`);
          }
        }

        const successCount = Array.from(results.values()).filter(Boolean).length;
        console.error(`\nUpdated ${successCount}/${results.size} marketplaces`);
      }
    } catch (error: any) {
      console.error(`❌ Error: ${error.message}`);
      process.exit(1);
    }
  });

// Add command: add MCP from marketplace
program
  .command('add')
  .argument('<name>', 'MCP name to add')
  .option('--marketplace <name>', 'Specific marketplace to use')
  .description('Add an MCP from a marketplace')
  .action(async (name: string, options: any, command: Command) => {
    try {
      // Get working directory from global options
      const workingDir = command.parent?.opts().workingDir || DEFAULT_WORKING_DIR;
      await ensureWorkingDir(workingDir);

      const { MarketplaceManager } = await import('./marketplace-manager.js');
      const manager = new MarketplaceManager();
      await manager.initialize();

      // Check for conflicts
      const conflict = await manager.checkConflict(name, options.marketplace);

      if (!conflict.sources || conflict.sources.length === 0) {
        console.error(`❌ MCP '${name}' not found in any enabled marketplace`);
        console.error(`Tip: Use 'photon search ${name}' to find it`);
        process.exit(1);
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

        console.error(`\nTo specify a marketplace, use:`);
        console.error(`  photon add ${name} --marketplace <name>`);
        console.error(`\nOr use the first marketplace by continuing...`);

        // Use recommended or first source
        const recommendedSource = conflict.sources.find(s => s.marketplace.name === conflict.recommendation);
        const selectedSource = recommendedSource || conflict.sources[0];
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
      console.error(`Run with: photon mcp ${name} --dev`);
    } catch (error: any) {
      console.error(`❌ Error: ${error.message}`);
      process.exit(1);
    }
  });

// Upgrade command: update MCPs from marketplace
program
  .command('upgrade')
  .argument('[name]', 'MCP name to upgrade (upgrades all if omitted)')
  .option('--check', 'Check for updates without upgrading')
  .description('Upgrade MCP(s) from marketplaces')
  .action(async (name: string | undefined, options: any, command: Command) => {
    try {
      // Get working directory from global options
      const workingDir = command.parent?.opts().workingDir || DEFAULT_WORKING_DIR;

      const { VersionChecker } = await import('./version-checker.js');
      const checker = new VersionChecker();
      await checker.initialize();

      if (name) {
        // Upgrade single MCP
        const filePath = await resolvePhotonPath(name, workingDir);

        if (!filePath) {
          console.error(`❌ MCP not found: ${name}`);
          console.error(`Searched in: ${workingDir}`);
          process.exit(1);
        }

        console.error(`Checking ${name} for updates...`);
        const versionInfo = await checker.checkForUpdate(name, filePath);

        if (!versionInfo.local) {
          console.error(`⚠️  Could not determine local version`);
          return;
        }

        if (!versionInfo.remote) {
          console.error(`⚠️  Not found in any marketplace. This might be a local-only MCP.`);
          return;
        }

        if (options.check) {
          if (versionInfo.needsUpdate) {
            console.error(`🔄 Update available: ${versionInfo.local} → ${versionInfo.remote}`);
          } else {
            console.error(`✅ Already up to date (${versionInfo.local})`);
          }
          return;
        }

        if (!versionInfo.needsUpdate) {
          console.error(`✅ Already up to date (${versionInfo.local})`);
          return;
        }

        console.error(`🔄 Upgrading ${name}: ${versionInfo.local} → ${versionInfo.remote}`);

        const success = await checker.updateMCP(name, filePath);

        if (success) {
          console.error(`✅ Successfully upgraded ${name} to ${versionInfo.remote}`);
        } else {
          console.error(`❌ Failed to upgrade ${name}`);
          process.exit(1);
        }
      } else {
        // Check/upgrade all MCPs
        console.error(`Checking all MCPs in ${workingDir}...\n`);
        const updates = await checker.checkAllUpdates(workingDir);

        if (updates.size === 0) {
          console.error(`No MCPs found`);
          return;
        }

        const needsUpdate: string[] = [];

        for (const [mcpName, info] of updates) {
          const status = checker.formatVersionInfo(info);

          if (info.needsUpdate) {
            console.error(`  🔄 ${mcpName}: ${status}`);
            needsUpdate.push(mcpName);
          } else if (info.local && info.remote) {
            console.error(`  ✅ ${mcpName}: ${status}`);
          } else {
            console.error(`  📦 ${mcpName}: ${status}`);
          }
        }

        if (needsUpdate.length === 0) {
          console.error(`\nAll MCPs are up to date!`);
          return;
        }

        if (options.check) {
          console.error(`\n${needsUpdate.length} MCP(s) have updates available`);
          console.error(`Run 'photon upgrade' to upgrade all`);
          return;
        }

        // Upgrade all that need updates
        console.error(`\nUpgrading ${needsUpdate.length} MCP(s)...`);

        for (const mcpName of needsUpdate) {
          const filePath = path.join(workingDir, `${mcpName}.photon.ts`);
          const success = await checker.updateMCP(mcpName, filePath);

          if (success) {
            console.error(`✅ Upgraded ${mcpName}`);
          } else {
            console.error(`❌ Failed to upgrade ${mcpName}`);
          }
        }
      }
    } catch (error: any) {
      console.error(`❌ Error: ${error.message}`);
      process.exit(1);
    }
  });

// Audit command: security scan for MCP dependencies
program
  .command('audit')
  .argument('[name]', 'MCP name to audit (audits all if omitted)')
  .description('Security audit of MCP dependencies')
  .action(async (name: string | undefined, options: any, command: Command) => {
    try {
      const workingDir = command.parent?.opts().workingDir || DEFAULT_WORKING_DIR;
      const { DependencyManager } = await import('./dependency-manager.js');
      const { SecurityScanner } = await import('./security-scanner.js');

      const depManager = new DependencyManager();
      const scanner = new SecurityScanner();

      if (name) {
        // Audit single MCP
        const filePath = await resolvePhotonPath(name, workingDir);

        if (!filePath) {
          console.error(`❌ MCP not found: ${name}`);
          process.exit(1);
        }

        console.error(`🔍 Auditing dependencies for: ${name}\n`);

        const dependencies = await depManager.extractDependencies(filePath);

        if (dependencies.length === 0) {
          console.error('✅ No dependencies to audit');
          return;
        }

        const depStrings = dependencies.map(d => `${d.name}@${d.version}`);
        const result = await scanner.auditMCP(name, depStrings);

        console.error(scanner.formatAuditResult(result));

        if (result.totalVulnerabilities > 0) {
          console.error('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
          console.error('Vulnerabilities found:');

          result.dependencies.forEach(dep => {
            if (dep.hasVulnerabilities) {
              console.error(`\n📦 ${dep.dependency}@${dep.version}`);
              dep.vulnerabilities.forEach(vuln => {
                const symbol = scanner.getSeveritySymbol(vuln.severity);
                console.error(`   ${symbol} ${vuln.severity.toUpperCase()}: ${vuln.title}`);
                if (vuln.url) {
                  console.error(`      ${vuln.url}`);
                }
              });
            }
          });

          console.error('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
          console.error('\n💡 To fix vulnerabilities:');
          console.error(`   1. Update dependency versions in @dependencies JSDoc tag`);
          console.error(`   2. Clear cache: photon clear-cache`);
          console.error(`   3. Restart MCP to reinstall with new versions`);

          if (result.criticalCount > 0 || result.highCount > 0) {
            process.exit(1);
          }
        }
      } else {
        // Audit all MCPs
        console.error('🔍 Auditing all MCPs...\n');

        const mcps = await listPhotonMCPs(workingDir);

        if (mcps.length === 0) {
          console.error('No MCPs found');
          return;
        }

        let totalVulnerabilities = 0;
        let mcpsWithVulnerabilities = 0;

        for (const mcp of mcps) {
          const mcpPath = path.join(workingDir, mcp);
          const mcpName = path.basename(mcp, '.photon.ts');
          const dependencies = await depManager.extractDependencies(mcpPath);

          if (dependencies.length === 0) {
            console.error(`✅ ${mcpName}: No dependencies`);
            continue;
          }

          const depStrings = dependencies.map(d => `${d.name}@${d.version}`);
          const result = await scanner.auditMCP(mcpName, depStrings);

          console.error(scanner.formatAuditResult(result));

          if (result.totalVulnerabilities > 0) {
            totalVulnerabilities += result.totalVulnerabilities;
            mcpsWithVulnerabilities++;
          }
        }

        console.error('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.error(`\nSummary: ${totalVulnerabilities} vulnerabilities in ${mcpsWithVulnerabilities}/${mcps.length} MCPs`);

        if (totalVulnerabilities > 0) {
          console.error('\nRun: photon audit <name>  # for detailed vulnerability info');
          process.exit(1);
        }
      }
    } catch (error: any) {
      console.error(`❌ Error: ${error.message}`);
      process.exit(1);
    }
  });

// Conflicts command: show MCPs available in multiple marketplaces
program
  .command('conflicts')
  .description('Show MCPs available in multiple marketplaces')
  .action(async () => {
    try {
      const { MarketplaceManager } = await import('./marketplace-manager.js');
      const manager = new MarketplaceManager();
      await manager.initialize();

      console.error('🔍 Scanning for MCP conflicts across marketplaces...\n');

      const conflicts = await manager.detectAllConflicts();

      if (conflicts.size === 0) {
        console.error('✅ No conflicts detected');
        console.error('\nAll MCPs are uniquely available from single marketplaces.');
        return;
      }

      console.error(`⚠️  Found ${conflicts.size} MCP(s) in multiple marketplaces:\n`);

      for (const [mcpName, sources] of conflicts) {
        console.error(`📦 ${mcpName}`);

        sources.forEach(source => {
          const version = source.metadata?.version || 'unknown';
          const description = source.metadata?.description || '';
          console.error(`   → ${source.marketplace.name} (v${version})`);
          if (description) {
            console.error(`     ${description.substring(0, 60)}${description.length > 60 ? '...' : ''}`);
          }
        });

        // Show recommendation
        const conflict = await manager.checkConflict(mcpName);
        if (conflict.recommendation) {
          console.error(`   💡 Recommended: ${conflict.recommendation}`);
        }

        console.error('');
      }

      console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.error('\n💡 Tip: Use --marketplace flag to specify which to use:');
      console.error('   photon add <name> --marketplace <marketplace-name>');
      console.error('\nOr disable marketplaces you don\'t need:');
      console.error('   photon marketplace disable <marketplace-name>');
    } catch (error: any) {
      console.error(`❌ Error: ${error.message}`);
      process.exit(1);
    }
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

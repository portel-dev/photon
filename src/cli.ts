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
import { SchemaExtractor, ConstructorParam } from '@portel/photon-core';
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
        console.error(`Tip: Use 'photon info' to see available MCPs`);
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

// Info command: show installed and available Photons
program
  .command('info')
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
      const workingDir = parentOpts.workingDir || DEFAULT_WORKING_DIR;
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

          const config = globalPhotonPath
            ? {
                command: globalPhotonPath,
                args: ['mcp', name],
                ...(Object.keys(env).length > 0 && { env }),
              }
            : {
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
                args: ['mcp', mcpName],
                ...(Object.keys(env).length > 0 && { env }),
              }
            : {
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
  .command('search')
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
  .option('--claude-code', 'Generate Claude Code plugin files')
  .description('Generate/sync marketplace manifest and documentation')
  .action(async (dirPath: string, options: any) => {
    try {
      await performMarketplaceSync(dirPath, options);

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

// Initialize a new marketplace with git hooks
marketplace
  .command('init')
  .argument('[path]', 'Directory to initialize as marketplace (defaults to current directory)', '.')
  .option('--name <name>', 'Marketplace name')
  .option('--description <desc>', 'Marketplace description')
  .option('--owner <owner>', 'Owner name')
  .description('Initialize a directory as a Photon marketplace with git hooks')
  .action(async (dirPath: string, options: any) => {
    try {
      const fs = await import('fs/promises');
      const { existsSync } = await import('fs');
      const path = await import('path');

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

  # Run photon sync marketplace with --claude-code to generate plugin files
  if photon sync marketplace --claude-code; then
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
echo "The pre-commit hook will automatically run 'photon sync marketplace'"
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

      // Run initial sync
      console.error('\n🔄 Running initial marketplace sync...\n');
      await performMarketplaceSync(dirPath, options);

      console.error('\n✅ Marketplace initialized successfully!');
      console.error('\nNext steps:');
      console.error('1. Add your .photon.ts files to this directory');
      console.error('2. Commit your changes (hooks will auto-sync)');
      console.error('3. Push to GitHub to share your marketplace');
      console.error('\nContributors can setup hooks with:');
      console.error('  bash .githooks/setup.sh');

    } catch (error: any) {
      console.error(`❌ Error: ${error.message}`);
      if (process.env.DEBUG) {
        console.error(error.stack);
      }
      process.exit(1);
    }
  });

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
  .option('-y, --yes', 'Automatically select first suggestion without prompting')
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
      console.error(`\nRun with: photon mcp ${name}`);
      console.error(`\nTo customize: Copy to a new name and run with --dev for hot reload`);
    } catch (error: any) {
      console.error(`❌ Error: ${error.message}`);
      process.exit(1);
    }
  });

// Remove command: remove an installed photon
program
  .command('remove')
  .argument('<name>', 'MCP name to remove')
  .alias('rm')
  .option('--keep-cache', 'Keep compiled cache for this photon')
  .description('Remove an installed photon')
  .action(async (name: string, options: any, command: Command) => {
    try {
      const workingDir = command.parent?.opts().workingDir || DEFAULT_WORKING_DIR;

      // Find the photon file
      const filePath = await resolvePhotonPath(name, workingDir);

      if (!filePath) {
        console.error(`❌ Photon not found: ${name}`);
        console.error(`Searched in: ${workingDir}`);
        console.error(`Tip: Use 'photon info' to see installed photons`);
        process.exit(1);
      }

      console.error(`Removing ${name}...`);

      // Remove the .photon.ts file
      await fs.unlink(filePath);
      console.error(`✅ Removed ${name}.photon.ts`);

      // Remove install metadata
      const { MarketplaceManager } = await import('./marketplace-manager.js');
      const manager = new MarketplaceManager();
      await manager.initialize();
      const fileName = `${name}.photon.ts`;
      await manager.removeInstallMetadata(fileName);

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
        console.error(`✅ Cleared cache`);
      }

      console.error(`\n✅ Successfully removed ${name}`);
      console.error(`To reinstall: photon add ${name}`);

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
  .alias('up')
  .description('Upgrade MCP(s) from marketplaces')
  .action(async (name: string | undefined, options: any, command: Command) => {
    try {
      const { formatOutput, printInfo, printSuccess, printWarning, printError, STATUS } = await import('./cli-formatter.js');
      // Get working directory from global options
      const workingDir = command.parent?.opts().workingDir || DEFAULT_WORKING_DIR;

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

// Audit command: security scan for MCP dependencies
program
  .command('audit')
  .argument('[name]', 'MCP name to audit (audits all if omitted)')
  .description('Security audit of MCP dependencies')
  .action(async (name: string | undefined, options: any, command: Command) => {
    try {
      const workingDir = command.parent?.opts().workingDir || DEFAULT_WORKING_DIR;
      const { DependencyManager } = await import('@portel/photon-core');
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
      const { formatOutput, printInfo, printSuccess, printWarning, printError } = await import('./cli-formatter.js');
      const manager = new MarketplaceManager();
      await manager.initialize();

      printInfo('Scanning for MCP conflicts across marketplaces...\n');

      const conflicts = await manager.detectAllConflicts();

      if (conflicts.size === 0) {
        printSuccess('No conflicts detected');
        printInfo('All MCPs are uniquely available from single marketplaces.');
        return;
      }

      printWarning(`Found ${conflicts.size} MCP(s) in multiple marketplaces:\n`);

      // Build tree data for conflicts
      const treeData: Record<string, any> = {};

      for (const [mcpName, sources] of conflicts) {
        const mcpEntry: Record<string, any> = {};

        for (const source of sources) {
          const version = source.metadata?.version || 'unknown';
          const description = source.metadata?.description
            ? source.metadata.description.substring(0, 50) + (source.metadata.description.length > 50 ? '...' : '')
            : '-';
          mcpEntry[source.marketplace.name] = {
            version,
            description,
          };
        }

        // Check for recommendation
        const conflict = await manager.checkConflict(mcpName);
        if (conflict.recommendation) {
          mcpEntry['recommended'] = conflict.recommendation;
        }

        treeData[mcpName] = mcpEntry;
      }

      formatOutput(treeData, 'tree');

      console.log('');
      printInfo('Tip: Use --marketplace flag to specify which to use:');
      printInfo('  photon add <name> --marketplace <marketplace-name>');
      printInfo('Or disable marketplaces you don\'t need:');
      printInfo('  photon marketplace disable <marketplace-name>');
    } catch (error: any) {
      const { printError } = await import('./cli-formatter.js');
      printError(error.message);
      process.exit(1);
    }
  });

// Clear-cache command: clear compiled photon cache
program
  .command('clear-cache')
  .argument('[name]', 'MCP name to clear cache for (clears all if omitted)')
  .alias('clean')
  .description('Clear compiled photon cache')
  .action(async (name: string | undefined, options: any, command: Command) => {
    try {
      const cacheDir = path.join(os.homedir(), '.cache', 'photon-mcp', 'compiled');

      if (name) {
        // Clear cache for specific photon
        const workingDir = command.parent?.opts().workingDir || DEFAULT_WORKING_DIR;
        const filePath = await resolvePhotonPath(name, workingDir);

        if (!filePath) {
          console.error(`❌ Photon not found: ${name}`);
          console.error(`Tip: Use 'photon info' to see installed photons`);
          process.exit(1);
        }

        console.error(`🗑️  Clearing cache for ${name}...`);

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
          console.error(`✅ Cleared cache for ${name}`);
        } else {
          console.error(`ℹ️  No cache found for ${name}`);
        }
      } else {
        // Clear all cache
        console.error('🗑️  Clearing all compiled photon cache...');

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
            console.error(`✅ Cleared ${count} cached file(s)`);
          } else {
            console.error(`ℹ️  Cache is already empty`);
          }
        } catch (error: any) {
          if (error.code === 'ENOENT') {
            console.error(`ℹ️  No cache directory found`);
          } else {
            throw error;
          }
        }
      }
    } catch (error: any) {
      console.error(`❌ Error: ${error.message}`);
      process.exit(1);
    }
  });

// Doctor command: diagnose photon environment
program
  .command('doctor')
  .argument('[name]', 'Photon name to diagnose (checks environment if omitted)')
  .description('Run diagnostics on photon environment and installations')
  .action(async (name: string | undefined, options: any, command: Command) => {
    try {
      const { formatOutput, printInfo, printSuccess, printWarning, printError, STATUS } = await import('./cli-formatter.js');
      const workingDir = command.parent?.opts().workingDir || DEFAULT_WORKING_DIR;
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

      // Check marketplaces
      try {
        const { MarketplaceManager } = await import('./marketplace-manager.js');
        const manager = new MarketplaceManager();
        await manager.initialize();
        const marketplaces = manager.getAll();
        const enabled = marketplaces.filter(m => m.enabled);

        if (enabled.length > 0) {
          diagnostics['Marketplaces'] = {
            enabled: enabled.length,
            status: STATUS.OK,
            sources: enabled.map(m => m.name),
          };
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

          // Check dependencies
          try {
            const { DependencyManager } = await import('@portel/photon-core');
            const depManager = new DependencyManager();
            const dependencies = await depManager.extractDependencies(filePath);
            if (dependencies.length > 0) {
              photonDiag['dependencies'] = dependencies.map(dep => `${dep.name}@${dep.version}`);
            } else {
              photonDiag['dependencies'] = 'none';
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
  .command('cli <photon> [method] [args...]', { hidden: false })
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
  .command('alias <photon> [alias-name]')
  .description('Create a CLI alias for a photon (e.g., "lg-remote" instead of "photon cli lg-remote")')
  .action(async (photon: string, aliasName: string | undefined) => {
    const { createAlias } = await import('./cli-alias.js');
    await createAlias(photon, aliasName);
  });

program
  .command('unalias <alias-name>')
  .description('Remove a CLI alias')
  .action(async (aliasName: string) => {
    const { removeAlias } = await import('./cli-alias.js');
    await removeAlias(aliasName);
  });

program
  .command('aliases')
  .description('List all CLI aliases')
  .action(async () => {
    const { listAliases } = await import('./cli-alias.js');
    await listAliases();
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

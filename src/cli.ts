#!/usr/bin/env node

/**
 * Photon MCP CLI
 *
 * Command-line interface for running .photon.ts files as MCP servers
 */

import { Command } from 'commander';
import * as path from 'path';
import * as fs from 'fs/promises';
import { PhotonServer } from './server.js';
import { FileWatcher } from './watcher.js';
import { resolvePhotonPath, listPhotonMCPs, ensureWorkingDir, DEFAULT_WORKING_DIR } from './path-resolver.js';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
  .description('Run single-file TypeScript MCPs')
  .version(version)
  .option('--working-dir <dir>', 'Working directory for MCPs (default: ~/.photon)', DEFAULT_WORKING_DIR);

// Main command: run a .photon.ts file
program
  .argument('<name>', 'MCP name (without .photon.ts extension)')
  .option('--dev', 'Enable development mode with hot reload')
  .option('--config', 'Output Claude Desktop config snippet')
  .option('--verbose', 'Show detailed logs')
  .action(async (name: string, options: any, command: Command) => {
    try {
      // Get working directory from global options
      const workingDir = command.parent?.opts().workingDir || DEFAULT_WORKING_DIR;

      // Resolve file path from name in working directory
      const filePath = await resolvePhotonPath(name, workingDir);

      if (!filePath) {
        console.error(`[Photon] ❌ MCP not found: ${name}`);
        console.error(`[Photon] Searched in: ${workingDir}`);
        console.error(`[Photon] Tip: Use 'photon list' to see available MCPs`);
        process.exit(1);
      }

      // Config mode: output Claude Desktop config
      if (options.config) {
        const mcpName = path.basename(filePath, path.extname(filePath)).replace('.photon', '');
        const config = {
          [mcpName]: {
            command: 'npx',
            args: ['@portel/photon', filePath],
          },
        };

        console.log(JSON.stringify(config, null, 2));
        return;
      }

      // Normal mode: start server
      const server = new PhotonServer({
        filePath,
        devMode: options.dev,
      });

      // Handle shutdown signals
      const shutdown = async () => {
        console.error('\n[Photon] Shutting down...');
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
      console.error(`[Photon] ❌ Error: ${error.message}`);
      if (options.verbose) {
        console.error(error.stack);
      }
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
        console.error(`[Photon] ❌ File already exists: ${filePath}`);
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

      console.error(`[Photon] ✅ Created ${fileName} in ${workingDir}`);
      console.error(`[Photon] Run with: photon ${name} --dev`);
    } catch (error: any) {
      console.error(`[Photon] ❌ Error: ${error.message}`);
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
        console.error(`[Photon] ❌ MCP not found: ${name}`);
        console.error(`[Photon] Searched in: ${workingDir}`);
        console.error(`[Photon] Tip: Use 'photon list' to see available MCPs`);
        process.exit(1);
      }

      console.error(`[Photon] Validating ${path.basename(filePath)}...`);

      // Import loader and try to load
      const { PhotonLoader } = await import('./loader.js');
      const loader = new PhotonLoader();

      const mcp = await loader.loadFile(filePath);

      console.error(`[Photon] ✅ Valid Photon MCP`);
      console.error(`[Photon] Name: ${mcp.name}`);
      console.error(`[Photon] Tools: ${mcp.tools.length}`);

      for (const tool of mcp.tools) {
        console.error(`  - ${tool.name}: ${tool.description}`);
      }

      process.exit(0);
    } catch (error: any) {
      console.error(`[Photon] ❌ Validation failed: ${error.message}`);
      process.exit(1);
    }
  });

// List command: show all MCPs in working directory
program
  .command('list')
  .description('List all Photon MCPs in working directory')
  .action(async (options: any, command: Command) => {
    try {
      // Get working directory from global options
      const workingDir = command.parent?.opts().workingDir || DEFAULT_WORKING_DIR;

      const mcps = await listPhotonMCPs(workingDir);

      if (mcps.length === 0) {
        console.error(`[Photon] No MCPs found in ${workingDir}`);
        console.error(`[Photon] Create one with: photon init <name>`);
        return;
      }

      console.error(`[Photon] MCPs in ${workingDir} (${mcps.length}):`);
      console.error('');
      for (const mcp of mcps) {
        console.error(`  📦 ${mcp}`);
      }
      console.error('');
      console.error(`[Photon] Run any MCP with: photon <name> --dev`);
    } catch (error: any) {
      console.error(`[Photon] ❌ Error: ${error.message}`);
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

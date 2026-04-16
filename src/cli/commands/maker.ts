/**
 * Maker CLI Commands
 *
 * Commands for photon creators and publishers:
 * new, validate, sync, init, diagram, diagrams
 */

import type { Command } from 'commander';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import { existsSync, lstatSync } from 'fs';
import { fileURLToPath } from 'url';
import { getErrorMessage, ExitCode, exitWithError } from '../../shared/error-handler.js';
import { logger } from '../../shared/logger.js';
import { resolvePhotonPath, ensureWorkingDir } from '../../path-resolver.js';
import { getDefaultContext } from '../../context.js';
import { PHOTON_VERSION } from '../../version.js';
import { isNodeError } from '../../shared/error-handler.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ══════════════════════════════════════════════════════════════════════════════
// PRIVATE HELPERS
// ══════════════════════════════════════════════════════════════════════════════

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
  const isDefaultDir = resolvedPath === getDefaultContext().baseDir;

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
    const { readLocalMetadata } = await import('../../marketplace-manager.js');
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

  // Check for misplaced photon files in subdirectories
  const subdirs = files.filter((f) => {
    try {
      return lstatSync(path.join(resolvedPath, f)).isDirectory() && !f.startsWith('.');
    } catch {
      return false; // stat failed (permission denied, broken symlink)
    }
  });
  const misplaced: string[] = [];
  for (const dir of subdirs) {
    const subfiles = await fs.readdir(path.join(resolvedPath, dir));
    for (const f of subfiles) {
      if (f.endsWith('.photon.ts')) {
        const rootExists = photonFiles.includes(f);
        if (!rootExists) {
          misplaced.push(`${dir}/${f}`);
        }
      }
    }
  }
  if (misplaced.length > 0) {
    const fileList = misplaced.join(', ');
    const names = misplaced.map((f) => f.split('/').pop()).join(', ');
    exitWithError(`Photon files must live at the root, not in subdirectories: ${fileList}`, {
      exitCode: ExitCode.VALIDATION_ERROR,
      suggestion: `Move to root: ${names}. Subdirectories are for assets only (ui/, etc.)`,
    });
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
  const { TemplateManager } = await import('../../template-manager.js');
  const templateMgr = new TemplateManager(resolvedPath);

  console.error('📝 Ensuring templates...');
  await templateMgr.ensureTemplates();

  // Ensure .gitignore excludes templates
  await ensureGitignore(resolvedPath);

  console.error('');

  // Extract metadata from each Photon
  console.error('📄 Extracting documentation...');
  const { calculateFileHash, calculatePhotonHash } = await import('../../marketplace-manager.js');
  const { PhotonDocExtractor } = await import('../../photon-doc-extractor.js');

  const photons: any[] = [];

  for (const file of photonFiles.sort()) {
    const filePath = path.join(resolvedPath, file);

    // Extract full metadata
    const extractor = new PhotonDocExtractor(filePath);
    const metadata = await extractor.extractFullMetadata();

    // contentHash = source-only (for download integrity verification)
    const contentHash = await calculateFileHash(filePath);
    // hash = source + assets (for update detection)
    const hash = metadata.assets?.length
      ? await calculatePhotonHash(filePath, metadata.assets, resolvedPath)
      : contentHash;

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
      icon: metadata.icon || null,
      source: `../${file}`,
      hash,
      contentHash,
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

  // Read existing manifest to preserve owner and detect unbumped versions
  let existingOwner: { name: string; email?: string; url?: string } | undefined;
  let existingPhotons: any[] = [];
  if (existsSync(manifestPath)) {
    try {
      const existingManifest = JSON.parse(await fs.readFile(manifestPath, 'utf-8'));
      if (!options.owner) {
        existingOwner = existingManifest.owner;
      }
      existingPhotons = existingManifest.photons || [];
    } catch {
      // Ignore parse errors
    }
  }

  // Warn about content changes without version bumps
  if (existingPhotons.length > 0) {
    const existingByName = new Map(existingPhotons.map((p: any) => [p.name, p]));
    let hasWarnings = false;
    for (const p of photons) {
      const prev = existingByName.get(p.name);
      if (prev && prev.hash && p.hash && prev.hash !== p.hash && prev.version === p.version) {
        if (!hasWarnings) {
          console.error('');
          hasWarnings = true;
        }
        console.error(
          `⚠ ${p.name}: content changed but version is still ${p.version} — consider bumping`
        );
      }
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
  const { ReadmeSyncer } = await import('../../readme-syncer.js');
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

  // Ensure .data/ is in .gitignore (runtime data should never be committed)
  const gitignorePath = path.join(absolutePath, '.gitignore');
  let gitignore = '';
  try {
    gitignore = await fs.readFile(gitignorePath, 'utf-8');
  } catch {
    /* doesn't exist */
  }
  const patterns = ['.data/', 'node_modules/', '.DS_Store'];
  const missing = patterns.filter(
    (p) =>
      !gitignore
        .split('\n')
        .map((l) => l.trim())
        .includes(p)
  );
  if (missing.length > 0) {
    const append = (gitignore && !gitignore.endsWith('\n') ? '\n' : '') + missing.join('\n') + '\n';
    await fs.appendFile(gitignorePath, append);
    console.error('✅ Added .data/ to .gitignore');
  }

  // Run initial sync (don't filter installed for marketplace repos)
  console.error('\n🔄 Running initial marketplace sync...\n');
  await performMarketplaceSync(absolutePath, options);

  console.error('\n✅ Marketplace initialized successfully!');
  console.error('\nNext steps:');
  console.error('1. Add your .photon.ts files to this directory');
  console.error('2. Run `photon beam` from here to develop and test');
  console.error('   Runtime data is stored in .data/ (gitignored automatically)');
  console.error('3. Commit your changes (hooks will auto-sync the manifest)');
  console.error('4. Push to GitHub to share your marketplace');
  console.error('\nContributors can setup hooks with:');
  console.error('  bash .githooks/setup.sh');
}

/**
 * Return the inline photon template (fallback when file template is absent)
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

// ══════════════════════════════════════════════════════════════════════════════
// COMMAND REGISTRATION
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Scaffold a new .photon.ts file from the bundled template.
 * Shared between `photon maker new` and the `photon new` top-level shortcut.
 */
async function scaffoldPhoton(name: string, options: { global?: boolean }): Promise<void> {
  try {
    // --global always means ~/.photon, independent of CWD auto-detection.
    // Default (no --global) scaffolds into CWD so users get create-next-app-style
    // local project layout.
    const workingDir = options.global ? path.join(os.homedir(), '.photon') : process.cwd();

    // Ensure working directory exists (only needed for ~/.photon; CWD always exists)
    if (options.global) {
      await ensureWorkingDir(workingDir);
    }

    const fileName = `${name}.photon.ts`;
    const filePath = path.join(workingDir, fileName);

    // Check if file already exists
    try {
      await fs.access(filePath);
      exitWithError(`File already exists: ${filePath}`, {
        suggestion: `Choose a different name or delete the existing file`,
      });
    } catch (err) {
      if (!isNodeError(err, 'ENOENT')) {
        exitWithError(`Cannot access ${filePath}: ${getErrorMessage(err)}`);
      }
      // ENOENT = file doesn't exist — good, proceed
    }

    // Read template
    const templatePath = path.join(__dirname, '..', '..', '..', 'templates', 'photon.template.ts');
    let template: string;

    try {
      template = await fs.readFile(templatePath, 'utf-8');
    } catch (err) {
      logger.debug(`Template not found at ${templatePath}, using inline template`);
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

    // Print a short, path-aware success message
    const displayPath = options.global ? filePath : `./${fileName}`;
    console.error(`✅ Created ${displayPath}`);
    if (options.global) {
      console.error(`Run with: photon mcp ${name} --dev`);
    } else {
      console.error(`Next: photon mcp ${name} --dev  (run the MCP server from this directory)`);
    }
  } catch (error) {
    logger.error(`Error: ${getErrorMessage(error)}`);
    process.exit(1);
  }
}

/**
 * Register the `photon new <name>` top-level shortcut for `photon maker new`.
 *
 * Kept as a separate registration so the shortcut can appear under the
 * Development section of top-level --help while `maker new` stays for
 * back-compat and scripting.
 */
export function registerNewCommand(program: Command): void {
  program
    .command('new')
    .argument('<name>', 'Name for the new photon')
    .option(
      '--global',
      'Scaffold into ~/.photon (auto-discovered by the daemon) instead of the current directory'
    )
    .description('Create a new photon from template (shortcut for `photon maker new`)')
    .action(async (name: string, options: { global?: boolean }) => {
      await scaffoldPhoton(name, options);
    });
}

/**
 * Register the `maker` command group and all its subcommands
 */
export function registerMakerCommands(program: Command): void {
  const maker = program
    .command('maker', { hidden: true })
    .description('Commands for creating photons and marketplaces');

  // maker new: create a new photon from template
  maker
    .command('new')
    .argument('<name>', 'Name for the new photon')
    .option(
      '--global',
      'Scaffold into ~/.photon (auto-discovered by the daemon) instead of the current directory'
    )
    .description('Create a new photon from template')
    .action(async (name: string, options: { global?: boolean }) => {
      await scaffoldPhoton(name, options);
    });

  // maker validate: validate photon syntax and schemas
  maker
    .command('validate')
    .argument('<name>', 'Photon name (without .photon.ts extension)')
    .description('Validate photon syntax and schemas')
    .action(async (name: string, options: any, command: Command) => {
      try {
        // Get working directory from global options
        const workingDir = getDefaultContext().baseDir;

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
        const { PhotonLoader } = await import('../../loader.js');
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
        const filterInstalled = resolvedPath === getDefaultContext().baseDir;
        await performMarketplaceSync(dirPath, { ...options, filterInstalled });

        // Generate Claude Code plugin if requested
        if (options.claudeCode) {
          const { generateClaudeCodePlugin } = await import('../../claude-code-plugin.js');
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

  // maker init: initialize a directory as a Photon marketplace with git hooks
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
        const { PhotonDocExtractor } = await import('../../photon-doc-extractor.js');

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
        const { PhotonDocExtractor } = await import('../../photon-doc-extractor.js');

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
}

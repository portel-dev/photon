/**
 * Cloudflare Workers deployment for Photon
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { existsSync, readFileSync } from 'fs';
import { execSync, spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { homedir } from 'node:os';
import { detectPM, detectRunner } from '../shared-utils.js';
import { SchemaExtractor } from '@portel/photon-core';
import { PHOTON_VERSION } from '../version.js';
import { logger } from '../shared/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Find package root (where templates folder is)
function getPackageRoot(): string {
  // When running from dist/, go up to package root
  let dir = __dirname;
  while (dir !== path.dirname(dir)) {
    if (existsSync(path.join(dir, 'package.json'))) {
      try {
        const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf-8'));
        if (pkg.name === '@portel/photon') {
          return dir;
        }
      } catch {
        // Not found or invalid - continue searching parent directories
      }
    }
    dir = path.dirname(dir);
  }
  // Fallback: assume we're in dist/deploy/
  return path.join(__dirname, '..', '..');
}

/**
 * Resolve a Cloudflare API token for wrangler, preferring an explicit
 * CLOUDFLARE_API_TOKEN env var then falling back to the OAuth access token
 * stored by the `cf` CLI at ~/.cf/config.toml. Returns undefined if no
 * token is discoverable; callers fall through to the interactive
 * `wrangler login` flow.
 *
 * The `cf` CLI's OAuth access token is accepted by the Cloudflare API as a
 * Bearer credential, so wrangler recognizes it as a valid API token. This
 * lets users who have authenticated once via `cf auth login` skip the
 * separate `wrangler login` browser prompt.
 */
function resolveCloudflareApiToken(): { token: string; source: 'env' | 'cf-cli' } | null {
  if (process.env.CLOUDFLARE_API_TOKEN) {
    return { token: process.env.CLOUDFLARE_API_TOKEN, source: 'env' };
  }
  const cfConfigPath = path.join(homedir(), '.cf', 'config.toml');
  if (!existsSync(cfConfigPath)) return null;

  // `cf auth whoami` has the side effect of refreshing an expired OAuth
  // access token on disk using the stored refresh token. Run it silently
  // first so wrangler receives a live token rather than an expired one.
  // No error if `cf` is not installed; we fall through to reading whatever
  // is on disk in that case.
  try {
    execSync('cf auth whoami', { stdio: 'pipe' });
  } catch {
    // cf missing or refresh failed; try the on-disk token anyway.
  }

  try {
    const toml = readFileSync(cfConfigPath, 'utf-8');
    const match = toml.match(/^access_token\s*=\s*"([^"]+)"\s*$/m);
    return match ? { token: match[1], source: 'cf-cli' } : null;
  } catch {
    return null;
  }
}

/**
 * Build a subprocess env that includes the bridged Cloudflare API token
 * when one is available. Callers use this when spawning wrangler so the
 * token flows through without touching the parent process env.
 */
function wranglerEnv(): NodeJS.ProcessEnv {
  const resolved = resolveCloudflareApiToken();
  if (!resolved) return process.env;
  return { ...process.env, CLOUDFLARE_API_TOKEN: resolved.token };
}

export interface CloudflareDeployOptions {
  photonPath: string;
  outputDir?: string;
  devMode?: boolean;
  dryRun?: boolean;
}

export async function deployToCloudflare(options: CloudflareDeployOptions): Promise<void> {
  const { photonPath, devMode = false, dryRun = false } = options;

  // Resolve photon file
  const absolutePath = path.resolve(photonPath);
  if (!existsSync(absolutePath)) {
    throw new Error(`Photon file not found: ${absolutePath}`);
  }

  // Extract photon name from filename
  const filename = path.basename(absolutePath);
  const photonName = filename.replace(/\.photon\.ts$/, '').replace(/[^a-z0-9-]/gi, '-');

  logger.info(`Preparing ${photonName} for Cloudflare Workers...`);

  // Create output directory
  const outputDir = options.outputDir || path.join(process.cwd(), `.cf-${photonName}`);
  await fs.mkdir(outputDir, { recursive: true });
  await fs.mkdir(path.join(outputDir, 'src'), { recursive: true });

  // Extract tool definitions using SchemaExtractor
  logger.debug('Extracting tool definitions...');
  const extractor = new SchemaExtractor();
  const sourceCode = await fs.readFile(absolutePath, 'utf-8');
  const extracted = extractor.extractFromSource(sourceCode);

  const toolDefs = extracted.map((tool: any) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }));

  logger.info(`Found ${toolDefs.length} tools`);

  // Read worker template
  const packageRoot = getPackageRoot();
  const templatePath = path.join(packageRoot, 'templates', 'cloudflare', 'worker.ts.template');
  let workerCode = await fs.readFile(templatePath, 'utf-8');

  // Replace placeholders
  workerCode = workerCode
    .replace(/__TOOL_DEFINITIONS__/g, JSON.stringify(toolDefs, null, 2))
    .replace(/__PHOTON_NAME__/g, photonName)
    .replace(/__DEV_MODE__/g, String(devMode));

  // Copy photon file and rename import
  const photonCode = await fs.readFile(absolutePath, 'utf-8');

  // Transform photon code for Workers compatibility
  // 1. Remove @portel/photon-core import and Photon/PhotonMCP extension
  // 2. Remove Node.js-specific imports
  let transformedPhoton = photonCode
    // Remove photon-core import (both Photon and PhotonMCP)
    .replace(
      /import\s+{\s*(?:Photon|PhotonMCP)\s*}\s+from\s+['"]@portel\/photon-core['"];?\n?/g,
      ''
    )
    // Remove extends Photon or extends PhotonMCP
    .replace(/extends\s+(?:Photon|PhotonMCP)\s*{/g, '{')
    // Remove Node.js imports
    .replace(/import\s+\*\s+as\s+fs\s+from\s+['"]fs['"]/g, '// fs not available in Workers')
    .replace(/import\s+\*\s+as\s+path\s+from\s+['"]path['"]/g, '// path not available in Workers')
    .replace(/import\s+{\s*[^}]+\s*}\s+from\s+['"]fs['"]/g, '// fs not available in Workers')
    .replace(
      /import\s+{\s*[^}]+\s*}\s+from\s+['"]fs\/promises['"]/g,
      '// fs not available in Workers'
    )
    .replace(/import\s+{\s*[^}]+\s*}\s+from\s+['"]path['"]/g, '// path not available in Workers')
    // Remove @dependencies comment
    .replace(/\s*\*\s*@dependencies[^\n]*/g, '');

  // Write files
  await fs.writeFile(path.join(outputDir, 'src', 'worker.ts'), workerCode);
  await fs.writeFile(path.join(outputDir, 'src', 'photon.ts'), transformedPhoton);

  // Create wrangler.toml
  const wranglerTemplatePath = path.join(
    packageRoot,
    'templates',
    'cloudflare',
    'wrangler.toml.template'
  );
  let wranglerConfig = await fs.readFile(wranglerTemplatePath, 'utf-8');
  wranglerConfig = wranglerConfig.replace(/__PHOTON_NAME__/g, photonName);
  await fs.writeFile(path.join(outputDir, 'wrangler.toml'), wranglerConfig);

  // Create package.json
  const packageJson = {
    name: photonName,
    version: PHOTON_VERSION,
    private: true,
    scripts: {
      dev: 'wrangler dev',
      deploy: 'wrangler deploy',
    },
    devDependencies: {
      '@cloudflare/workers-types': '^4.0.0',
      wrangler: '^4.0.0',
      typescript: '^5.0.0',
    },
  };
  await fs.writeFile(path.join(outputDir, 'package.json'), JSON.stringify(packageJson, null, 2));

  // Create tsconfig.json
  const tsconfig = {
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'bundler',
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      types: ['@cloudflare/workers-types'],
    },
    include: ['src/**/*'],
  };
  await fs.writeFile(path.join(outputDir, 'tsconfig.json'), JSON.stringify(tsconfig, null, 2));

  logger.info(`Project generated at: ${outputDir}`);

  if (dryRun) {
    logger.info('Dry run - skipping deployment');
    logger.info('\nTo deploy manually:');
    logger.info(`  cd ${outputDir}`);
    const pm = detectPM();
    logger.info(`  ${pm} install`);
    logger.info(`  ${pm} run dev      # Local development`);
    logger.info(`  ${pm} run deploy   # Deploy to Cloudflare`);
    return;
  }

  // Check if wrangler is available
  logger.info('Installing dependencies...');
  try {
    execSync(detectPM() + ' install', { cwd: outputDir, stdio: 'pipe' });
  } catch (error) {
    logger.error('Failed to install dependencies');
    logger.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    logger.error('💡 Check your package manager installation and network connection');
    throw new Error(
      `Dependency installation failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  // Check for wrangler authentication. If an OAuth token is available from
  // the `cf` CLI, log that we're bridging it so the user sees why the
  // interactive `wrangler login` prompt was skipped.
  logger.info('Checking Cloudflare authentication...');
  const resolvedToken = resolveCloudflareApiToken();
  if (resolvedToken?.source === 'cf-cli') {
    logger.info('Using OAuth token from ~/.cf/config.toml for wrangler authentication');
  }
  const envForWrangler = wranglerEnv();
  try {
    execSync(`${detectRunner()} wrangler whoami`, {
      cwd: outputDir,
      stdio: 'pipe',
      env: envForWrangler,
    });
  } catch {
    logger.warn('Not logged in to Cloudflare');
    logger.info('Running: wrangler login');

    // Run wrangler login interactively
    const login = spawn(detectRunner(), ['wrangler', 'login'], {
      cwd: outputDir,
      stdio: 'inherit',
      env: envForWrangler,
    });

    await new Promise<void>((resolve, reject) => {
      login.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error('Login failed'));
      });
    });
  }

  // Deploy
  logger.info('Deploying to Cloudflare Workers...');

  const deploy = spawn(detectRunner(), ['wrangler', 'deploy'], {
    cwd: outputDir,
    stdio: 'inherit',
    env: envForWrangler,
  });

  await new Promise<void>((resolve, reject) => {
    deploy.on('close', (code) => {
      if (code === 0) {
        logger.info('Deployment complete!');
        logger.info(`\nYour MCP server is live at:`);
        logger.info(`https://${photonName}.<your-subdomain>.workers.dev`);
        if (devMode) {
          logger.info(
            `\nPlayground: https://${photonName}.<your-subdomain>.workers.dev/playground`
          );
        }
        resolve();
      } else {
        reject(new Error('Deployment failed'));
      }
    });
  });
}

export async function devCloudflare(options: CloudflareDeployOptions): Promise<void> {
  // Generate with dev mode, then run wrangler dev
  await deployToCloudflare({ ...options, devMode: true, dryRun: true });

  const photonName = path
    .basename(options.photonPath)
    .replace(/\.photon\.ts$/, '')
    .replace(/[^a-z0-9-]/gi, '-');
  const outputDir = options.outputDir || path.join(process.cwd(), `.cf-${photonName}`);

  logger.info('Installing dependencies...');
  execSync(detectPM() + ' install', { cwd: outputDir, stdio: 'pipe' });

  logger.info('Starting local Cloudflare Workers dev server...');

  const dev = spawn(detectRunner(), ['wrangler', 'dev'], {
    cwd: outputDir,
    stdio: 'inherit',
    env: wranglerEnv(),
  });

  await new Promise<void>((resolve) => {
    dev.on('close', () => resolve());
    process.on('SIGINT', () => {
      dev.kill();
      resolve();
    });
  });
}

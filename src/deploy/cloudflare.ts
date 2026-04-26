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

/**
 * NPM packages known to be incompatible with the Cloudflare Workers runtime.
 * Most break because they depend on Node-only built-ins (fs, vm, native
 * bindings) or full DOM polyfills. The deploy aborts with a clear message
 * listing offenders so users redirect to a Workers-friendly alternative
 * before they hit a cryptic bundle error from wrangler.
 *
 * Keep this list conservative — only add packages with no realistic Workers
 * path. Pure-JS libraries (cheerio, linkedom, @extractus/article-extractor,
 * etc.) work fine and must NOT be blocked.
 */
const WORKERS_INCOMPATIBLE_DEPS: Record<string, string> = {
  jsdom: 'needs full Node built-ins (fs, vm, Buffer); use linkedom or @extractus/article-extractor',
  'better-sqlite3': 'native binding; use Cloudflare D1 or DO storage',
  sharp: 'native binding; use Cloudflare Images',
  canvas: 'native binding; not available on Workers',
  puppeteer: 'full Chromium; use Cloudflare Browser Rendering',
  playwright: 'full browsers; use Cloudflare Browser Rendering',
  'node-fetch': 'unnecessary on Workers — fetch is global',
};

interface ParsedDependency {
  name: string;
  version: string;
}

/**
 * Extract `@dependencies foo@^1, bar@^2` entries from photon JSDoc blocks.
 * Mirrors the runtime loader's parser so deploy and runtime see the same
 * dependency set. Versionless entries default to "*" (latest).
 */
function parsePhotonDependencies(source: string): ParsedDependency[] {
  const deps: ParsedDependency[] = [];
  const seen = new Set<string>();
  const jsdocBlocks = source.match(/\/\*\*[\s\S]*?\*\//g) || [];
  const jsdocText = jsdocBlocks.join('\n');
  const regex = /@dependencies\s+([^\r\n]+)/g;
  let match;
  while ((match = regex.exec(jsdocText)) !== null) {
    const entries = match[1]
      .replace(/\*\/$/, '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
    for (const entry of entries) {
      const atIndex = entry.lastIndexOf('@');
      const isScoped = entry.startsWith('@');
      let name: string;
      let version: string;
      if (atIndex <= 0 || (isScoped && atIndex === 0)) {
        name = entry.trim();
        version = '*';
      } else {
        name = entry.slice(0, atIndex).trim();
        version = entry.slice(atIndex + 1).trim();
      }
      if (version.endsWith('?')) version = version.slice(0, -1);
      if (!/^(@[a-z0-9-]+\/)?[a-z0-9._-]+$/.test(name)) continue;
      if (seen.has(name)) continue;
      seen.add(name);
      deps.push({ name, version: version || '*' });
    }
  }
  return deps;
}

/**
 * Node built-in modules that wrangler can supply via `nodejs_compat` and
 * therefore don't need a `@dependencies` entry. Includes both bare names
 * (`fs`) and prefixed names (`node:fs`); the prefix form is stripped before
 * the lookup.
 */
const NODE_BUILTINS = new Set([
  'assert',
  'async_hooks',
  'buffer',
  'child_process',
  'cluster',
  'console',
  'constants',
  'crypto',
  'dgram',
  'diagnostics_channel',
  'dns',
  'domain',
  'events',
  'fs',
  'http',
  'http2',
  'https',
  'inspector',
  'module',
  'net',
  'os',
  'path',
  'perf_hooks',
  'process',
  'punycode',
  'querystring',
  'readline',
  'repl',
  'stream',
  'string_decoder',
  'sys',
  'timers',
  'tls',
  'trace_events',
  'tty',
  'url',
  'util',
  'v8',
  'vm',
  'wasi',
  'worker_threads',
  'zlib',
]);

/**
 * Extract bare-import package names from photon source.
 *
 * - `import x from 'pkg'` → `pkg`
 * - `import x from 'pkg/sub/path'` → `pkg`
 * - `import x from '@scope/pkg/sub'` → `@scope/pkg`
 * - Relative imports (`./`, `../`, `/`) and `node:` builtins are skipped.
 *
 * Used by the deploy pre-flight to flag imports the user forgot to declare
 * in `@dependencies` — wrangler's bundle would fail later with a less
 * actionable error.
 */
function extractImportedPackages(source: string): string[] {
  const seen = new Set<string>();
  const importRe = /^\s*(?:import|export)(?:\s[\s\S]*?)?\s+from\s+['"]([^'"]+)['"]/gm;
  const requireRe = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  const dynamicRe = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const re of [importRe, requireRe, dynamicRe]) {
    let m;
    while ((m = re.exec(source)) !== null) {
      const spec = m[1];
      if (spec.startsWith('.') || spec.startsWith('/')) continue;
      const stripped = spec.startsWith('node:') ? spec.slice(5) : spec;
      const firstSlash = stripped.indexOf('/');
      const pkg = stripped.startsWith('@')
        ? stripped.split('/').slice(0, 2).join('/')
        : firstSlash === -1
          ? stripped
          : stripped.slice(0, firstSlash);
      if (NODE_BUILTINS.has(pkg)) continue;
      seen.add(pkg);
    }
  }
  return Array.from(seen);
}

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
  /**
   * Enable Cloudflare Workers Logs in the generated `wrangler.toml`.
   * When true, every Worker invocation is captured in the CF dashboard
   * with ~3-day retention. Off by default — Workers Logs is opt-in so
   * deployments stay minimal until the user explicitly wants observability.
   */
  withLogs?: boolean;
}

export async function deployToCloudflare(options: CloudflareDeployOptions): Promise<void> {
  const { photonPath, devMode = false, dryRun = false, withLogs = false } = options;

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
    ...(tool.simpleParams ? { simpleParams: true } : {}),
  }));

  logger.info(`Found ${toolDefs.length} tools`);

  // Extract `@dependencies` from the photon source. These get bundled into
  // the Worker by wrangler, so they must land in package.json's dependencies
  // (not devDependencies). Fail fast on packages that are known to break on
  // the Workers runtime so users get a clear pointer instead of a cryptic
  // wrangler bundle error.
  const photonDeps = parsePhotonDependencies(sourceCode);
  const blocked = photonDeps.filter((dep) => dep.name in WORKERS_INCOMPATIBLE_DEPS);
  if (blocked.length > 0) {
    const lines = blocked.map((dep) => `  - ${dep.name}: ${WORKERS_INCOMPATIBLE_DEPS[dep.name]}`);
    throw new Error(
      `${photonName} declares dependencies that do not run on Cloudflare Workers:\n${lines.join('\n')}\n\n` +
        `Replace them with Workers-compatible alternatives, or deploy this photon to a runtime that supports Node built-ins.`
    );
  }
  if (photonDeps.length > 0) {
    logger.info(
      `Bundling ${photonDeps.length} dependencies: ${photonDeps.map((d) => d.name).join(', ')}`
    );
  }

  // Pre-flight: warn about imports that aren't declared in @dependencies.
  // Without a declared version, the generated package.json won't include the
  // package, wrangler's bundle step will fail with a less actionable error,
  // and the deploy will look broken even though the photon source compiles
  // locally (where node_modules already has the package).
  const declaredNames = new Set(photonDeps.map((d) => d.name));
  const importedPkgs = extractImportedPackages(sourceCode);
  const undeclared = importedPkgs.filter((pkg) => !declaredNames.has(pkg));
  if (undeclared.length > 0) {
    logger.warn(
      `${photonName} imports ${undeclared.length} package(s) not declared in @dependencies: ${undeclared.join(', ')}`
    );
    logger.warn(
      `  These will not be installed in the deployed Worker and bundling will likely fail.`
    );
    logger.warn(
      `  Add them to the photon's JSDoc: @dependencies ${undeclared.map((p) => `${p}@^x.y.z`).join(', ')}`
    );
  }

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
  // `__OBSERVABILITY__` is replaced with a `[observability]` block when the
  // user passes `--logs`, otherwise stripped so the rendered wrangler.toml
  // stays minimal. Workers Logs has a small free tier; opt-in keeps quota
  // usage explicit.
  const observabilityReplacement = withLogs ? '\n[observability]\nenabled = true\n' : '';
  let wranglerConfig = await fs.readFile(wranglerTemplatePath, 'utf-8');
  wranglerConfig = wranglerConfig
    .replace(/__PHOTON_NAME__/g, photonName)
    .replace(/__OBSERVABILITY__\n?/g, observabilityReplacement);
  await fs.writeFile(path.join(outputDir, 'wrangler.toml'), wranglerConfig);

  // Create package.json. Photon-declared dependencies land in `dependencies`
  // so wrangler bundles them into the Worker; build tooling stays in
  // `devDependencies`.
  const runtimeDeps: Record<string, string> = {};
  for (const dep of photonDeps) {
    runtimeDeps[dep.name] = dep.version;
  }
  const packageJson = {
    name: photonName,
    version: PHOTON_VERSION,
    private: true,
    scripts: {
      dev: 'wrangler dev',
      deploy: 'wrangler deploy',
    },
    ...(Object.keys(runtimeDeps).length > 0 && { dependencies: runtimeDeps }),
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

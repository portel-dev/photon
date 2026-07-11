/**
 * Cloudflare Workers deployment for Photon
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { existsSync, readFileSync } from 'fs';
import { execSync, spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { homedir, tmpdir } from 'node:os';
import { detectPM, detectRunner } from '../shared-utils.js';
import { SchemaExtractor, bindingNameFor } from '@portel/photon-core';
import { parseCfBindings } from '../cf-bindings-parser.js';
import { mergeBindings, type CfBindingsConfig } from '../runtime/cf-local.js';
import { scanCfUsage } from '../cf-usage-scanner.js';
import { PHOTON_VERSION } from '../version.js';
import { logger } from '../shared/logger.js';
import { extractHttpRoutesFromSource, type HttpRouteDef } from '../shared/http-route-extractor.js';
import { extractExposesFromSource, type ExposeDef } from '../shared/expose-route-extractor.js';
import { AssetResolver } from '../asset-resolver.js';
import { compileTsxSync } from '../tsx-compiler.js';
import type { PhotonAuthIssuer } from '../auth/mcp-jwt.js';

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
 * Extract `@photons foo, bar` entries from photon JSDoc blocks. These name
 * sibling photon dependencies — the deploy adapter resolves each to a
 * `.photon.ts` file and bundles it as its own Durable Object class so the
 * host photon's `this.call('foo.method', params)` works on Cloudflare.
 */
function parsePhotonPhotons(source: string): string[] {
  const seen = new Set<string>();
  const jsdocBlocks = source.match(/\/\*\*[\s\S]*?\*\//g) || [];
  const jsdocText = jsdocBlocks.join('\n');
  const regex = /@photons\s+([^\r\n]+)/g;
  let match;
  while ((match = regex.exec(jsdocText)) !== null) {
    const entries = match[1]
      .replace(/\*\/$/, '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
    for (const entry of entries) {
      if (!/^[a-z0-9_-]+$/i.test(entry)) continue;
      seen.add(entry);
    }
  }
  return Array.from(seen);
}

function parseToolScopesFromSource(source: string): Record<string, string[]> {
  const scopesByMethod: Record<string, string[]> = {};
  const classRe = /(\/\*\*[\s\S]*?\*\/)\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+/g;
  const classScopes: string[] = [];
  let classMatch;
  while ((classMatch = classRe.exec(source)) !== null) {
    for (const s of extractScopes(classMatch[1])) {
      if (!classScopes.includes(s)) classScopes.push(s);
    }
  }
  const methodRe =
    /(\/\*\*[\s\S]*?\*\/)\s*(?:async\s+)?(?:public\s+|protected\s+|private\s+)?([A-Za-z_$][\w$]*)\s*\(/g;
  let match;
  while ((match = methodRe.exec(source)) !== null) {
    const name = match[2];
    if (name === 'constructor') continue;
    const methodScopes = extractScopes(match[1]);
    const merged: string[] = [];
    for (const s of classScopes) if (!merged.includes(s)) merged.push(s);
    for (const s of methodScopes) if (!merged.includes(s)) merged.push(s);
    if (merged.length > 0) scopesByMethod[name] = merged;
  }
  return scopesByMethod;
}

function renderConstructorArgs(
  source: string,
  photonName: string,
  extractor: SchemaExtractor
): string {
  if (typeof extractor.resolveInjections !== 'function') {
    return '';
  }
  const injections = extractor.resolveInjections(source, photonName);
  return injections
    .map((injection) => {
      if (injection.injectionType !== 'env') return 'undefined';
      return `readConstructorEnv(env, ${JSON.stringify(injection.envVarName)}, ${JSON.stringify(injection.param?.type ?? 'string')})`;
    })
    .join(', ');
}

function extractScopes(jsdoc: string): string[] {
  const scopes: string[] = [];
  const re = /@scope\s+([^\r\n*]+)/g;
  let match;
  while ((match = re.exec(jsdoc)) !== null) {
    for (const scope of match[1].trim().split(/\s+/)) {
      if (scope && !scopes.includes(scope)) scopes.push(scope);
    }
  }
  return scopes;
}

function inferToolScopes(
  tool: { name: string; readOnlyHint?: boolean },
  explicitScopes?: string[]
): string[] {
  if (explicitScopes && explicitScopes.length > 0) return explicitScopes;
  return [`${tool.name}:${tool.readOnlyHint ? 'read' : 'write'}`];
}

function normalizeAssetRelativePath(value: string): string {
  return value.split(path.sep).join('/');
}

async function collectAssetFiles(root: string, prefix = ''): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  if (!existsSync(root)) return result;
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const absolute = path.join(root, entry.name);
    const relative = prefix ? path.join(prefix, entry.name) : entry.name;
    if (entry.isDirectory()) {
      Object.assign(result, await collectAssetFiles(absolute, relative));
      continue;
    }
    if (!entry.isFile()) continue;
    const key = normalizeAssetRelativePath(relative);
    result[key] = readFileSync(absolute).toString('base64');
  }
  return result;
}

/**
 * Resolve a sibling photon name to its `.photon.ts` file. Searches alongside
 * the caller first, then PHOTON_DIR / `~/.photon`. Returns null if not
 * found so the caller can fail with an actionable message.
 */
function resolveSiblingPhoton(name: string, callerPath: string): string | null {
  const sibling = path.join(path.dirname(callerPath), `${name}.photon.ts`);
  if (existsSync(sibling)) return sibling;
  const baseDir = process.env.PHOTON_DIR || path.join(homedir(), '.photon');
  const flat = path.join(baseDir, `${name}.photon.ts`);
  if (existsSync(flat)) return flat;
  return null;
}

/** Convert a photon name to its DO class name (`web-lite` → `WebLitePhotonDO`). */
function photonNameToDoClass(name: string): string {
  return (
    name
      .split(/[-_]/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join('') + 'PhotonDO'
  );
}

/** Convert a photon name to its env binding name (`web-lite` → `PHOTON_WEB_LITE`). */
function photonNameToBinding(name: string): string {
  return 'PHOTON_' + name.toUpperCase().replace(/-/g, '_');
}

/**
 * Strip Node-only and photon-core-specific bits from a photon source so it
 * can run inside a Worker. Same transformation is applied to the host
 * photon and every `@photons` sibling.
 */
function transformPhotonSource(source: string): string {
  return (
    source
      // Remove photon-core import (both Photon and PhotonMCP)
      .replace(
        /import\s+{\s*(?:Photon|PhotonMCP)\s*}\s+from\s+['"]@portel\/photon-core['"];?\n?/g,
        ''
      )
      // Remove `extends Photon` / `extends PhotonMCP`
      .replace(/extends\s+(?:Photon|PhotonMCP)\s*{/g, '{')
      // Stub Node-only imports
      .replace(/import\s+\*\s+as\s+fs\s+from\s+['"]fs['"]/g, '// fs not available in Workers')
      .replace(/import\s+\*\s+as\s+path\s+from\s+['"]path['"]/g, '// path not available in Workers')
      .replace(/import\s+{\s*[^}]+\s*}\s+from\s+['"]fs['"]/g, '// fs not available in Workers')
      .replace(
        /import\s+{\s*[^}]+\s*}\s+from\s+['"]fs\/promises['"]/g,
        '// fs not available in Workers'
      )
      .replace(/import\s+{\s*[^}]+\s*}\s+from\s+['"]path['"]/g, '// path not available in Workers')
      // Strip the @dependencies docblock line so it doesn't show up in the
      // bundled source — the version is already pinned in package.json.
      .replace(/\s*\*\s*@dependencies[^\n]*/g, '')
  );
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
/**
 * Count regular files under a directory, recursively. Used by the [assets]
 * deploy step to report how many files the wrangler upload will include.
 * Symlinks and broken entries are skipped silently — the deploy never
 * follows links out of the asset root.
 */
async function countFiles(root: string): Promise<number> {
  let count = 0;
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) stack.push(path.join(current, entry.name));
      else if (entry.isFile()) count += 1;
    }
  }
  return count;
}

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
  publicUrl?: string;
  customDomain?: string;
  routePattern?: string;
  mcpAuth?: 'jwt' | 'bearer' | 'open';
  mcpAudience?: string;
  /**
   * Enable Cloudflare Workers Logs in the generated `wrangler.toml`.
   * When true, every Worker invocation is captured in the CF dashboard
   * with ~3-day retention. Off by default — Workers Logs is opt-in so
   * deployments stay minimal until the user explicitly wants observability.
   */
  withLogs?: boolean;
}

interface CloudflareRouteConfig {
  toml: string;
  publicUrl?: string;
}

interface DeployJwtConfig {
  mode: 'jwt';
  issuer: string;
  audience: string;
  jwks: { keys: unknown[] };
}

async function loadDeployJwtConfig(photonName: string, audience: string): Promise<DeployJwtConfig> {
  const authDir = path.join(
    process.env.PHOTON_DIR || path.join(homedir(), '.photon'),
    'auth',
    photonName
  );
  const issuer = JSON.parse(
    await fs.readFile(path.join(authDir, 'issuer.json'), 'utf-8')
  ) as PhotonAuthIssuer;
  const jwks = JSON.parse(await fs.readFile(path.join(authDir, 'jwks.json'), 'utf-8')) as {
    keys: unknown[];
  };
  return { mode: 'jwt', issuer: issuer.issuer, audience, jwks };
}

function renderCloudflareRouteConfig(options: CloudflareDeployOptions): CloudflareRouteConfig {
  const targets = [options.publicUrl, options.customDomain, options.routePattern].filter(Boolean);
  if (targets.length > 1) {
    throw new Error('Choose only one Cloudflare deploy target: --url, --domain, or --route.');
  }

  if (options.customDomain) {
    const domain = normalizeHostname(options.customDomain, '--domain');
    return {
      publicUrl: `https://${domain}`,
      toml: renderRoutesToml([{ pattern: domain, customDomain: true }]),
    };
  }

  if (options.routePattern) {
    const pattern = normalizeRoutePattern(options.routePattern);
    return {
      publicUrl: routePatternToDisplayUrl(pattern),
      toml: renderRoutesToml([{ pattern, customDomain: false }]),
    };
  }

  if (!options.publicUrl) return { toml: '' };

  const parsed = parsePublicUrl(options.publicUrl);
  if (parsed.hostname.endsWith('.workers.dev')) {
    return { publicUrl: parsed.origin, toml: '' };
  }

  if (parsed.pathname === '/') {
    return {
      publicUrl: parsed.origin,
      toml: renderRoutesToml([{ pattern: parsed.hostname, customDomain: true }]),
    };
  }

  const pathname = parsed.pathname.replace(/\/$/, '');
  const pattern = `${parsed.hostname}${pathname}*`;
  return {
    publicUrl: `${parsed.origin}${pathname}`,
    toml: renderRoutesToml([{ pattern, customDomain: false }]),
  };
}

function parsePublicUrl(value: string): { hostname: string; origin: string; pathname: string } {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid --url value: ${value}`);
  }

  if (url.protocol !== 'https:') {
    throw new Error(`Cloudflare deploy --url must use https: ${value}`);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('Cloudflare deploy --url must not include credentials, query, or hash.');
  }

  const hostname = normalizeHostname(url.hostname, '--url');
  const pathname = url.pathname || '/';
  return { hostname, origin: `https://${hostname}`, pathname };
}

function normalizeHostname(value: string, flagName: string): string {
  const trimmed = value
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '')
    .toLowerCase();
  if (!/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(trimmed) || !trimmed.includes('.')) {
    throw new Error(`Invalid ${flagName} hostname: ${value}`);
  }
  return trimmed;
}

function normalizeRoutePattern(value: string): string {
  const trimmed = value.trim().replace(/^https?:\/\//, '');
  if (!trimmed || trimmed.includes('?') || trimmed.includes('#')) {
    throw new Error(`Invalid --route pattern: ${value}`);
  }
  if (!trimmed.includes('.')) {
    throw new Error(`Cloudflare --route must include a hostname: ${value}`);
  }
  return trimmed;
}

function routePatternToDisplayUrl(pattern: string): string | undefined {
  const withoutWildcard = pattern.replace(/\*+$/, '').replace(/\/+$/, '');
  if (!withoutWildcard) return undefined;
  return `https://${withoutWildcard}`;
}

function renderRoutesToml(routes: Array<{ pattern: string; customDomain: boolean }>): string {
  const renderedRoutes = routes
    .map((route) => {
      const entries = [`pattern = ${JSON.stringify(route.pattern)}`];
      if (route.customDomain) entries.push('custom_domain = true');
      return `  { ${entries.join(', ')} }`;
    })
    .join(',\n');
  return `workers_dev = false\nroutes = [\n${renderedRoutes}\n]\n`;
}

function parseInstanceAliases(): Record<string, string> {
  const raw = process.env.PHOTON_INSTANCE_ALIASES;
  if (!raw?.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed)
        .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
        .map(([from, to]) => [from.toLowerCase(), to])
    );
  } catch (err) {
    throw new Error(
      `PHOTON_INSTANCE_ALIASES must be a JSON object mapping aliases to canonical instances: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
}

/**
 * Generate the wrangler.toml binding blocks for a deployment.
 *
 * Each bundled photon contributes auto-named bindings derived from its
 * own usage: the source scanner discovers every literal qualifier the
 * photon passes to `cf.kv(...)`, `cf.r2(...)`, etc., and
 * `bindingNameFor` composes the wrangler-legal name (`<photon>_kv`,
 * `<photon>_cache_kv`, ...). The same convention drives miniflare seed
 * names locally and the worker template's runtime resolution, so
 * bindings always line up across runtimes.
 *
 * `protected cfBindings` is now an optional override layer keyed by
 * qualifier. Authors set it only when they need to point a specific
 * binding at a pre-existing CF resource (typically a real D1 UUID or
 * a shared org-wide bucket). The host photon's local override JSON
 * (`<baseDir>/.data/cf-overrides/<photon>.json`) is layered on top so
 * `photon cf set ...` edits flow into the deployed config without
 * touching photon source.
 *
 * Shared categories (ai/images/browser) emit a single block once per
 * Worker if any bundled photon either references them in source or
 * sets the corresponding boolean flag in `protected cfBindings`.
 */
export async function renderCfBindingsToml(
  photons: { name: string; source: string }[],
  hostPhotonName: string,
  hostPhotonDir: string
): Promise<string> {
  void hostPhotonName;
  const blocks: string[] = [];
  let anyAi = false;
  let anyImages = false;
  let anyBrowser = false;
  const seenBindings = new Set<string>();

  for (const p of photons) {
    const usage = scanCfUsage(p.source);
    const declared = parseCfBindings(p.source);
    let overrides: CfBindingsConfig = declared ?? {};
    try {
      const overridePath = path.join(hostPhotonDir, '.data', 'cf-overrides', `${p.name}.json`);
      const raw = await fs.readFile(overridePath, 'utf-8');
      overrides = mergeBindings(overrides, JSON.parse(raw) as CfBindingsConfig);
    } catch {
      // No override JSON — fine, fall through to declared-only or empty.
    }

    // Scoped categories — auto-named per (photon, category, qualifier).
    for (const category of ['kv', 'r2', 'd1', 'queue', 'vectorize'] as const) {
      for (const qualifier of usage.qualifiers[category]) {
        const bindingName = bindingNameFor(p.name, category, qualifier || undefined);
        if (seenBindings.has(bindingName)) continue;
        seenBindings.add(bindingName);
        const overrideKey = qualifier === '' ? 'default' : qualifier;
        const overrideValue = overrides[category]?.[overrideKey];
        blocks.push(formatScopedBlock(category, bindingName, overrideValue));
      }
    }

    if (usage.shared.ai || overrides.ai === true) anyAi = true;
    if (usage.shared.images || overrides.images === true) anyImages = true;
    if (usage.shared.browser || overrides.browser === true) anyBrowser = true;
  }

  if (anyAi) blocks.push('[ai]\nbinding = "AI"');
  if (anyImages) blocks.push('[images]\nbinding = "IMAGES"');
  if (anyBrowser) blocks.push('[browser]\nbinding = "BROWSER"');

  return blocks.length > 0
    ? '\n# Auto-generated from photon source (this.cf.* / Cloudflare injection)\n' +
        blocks.join('\n\n') +
        '\n'
    : '';
}

/**
 * Render a single `[[<table>]]` block for a scoped binding. Resource id
 * defaults to the binding name so `wrangler d1 create`-style preflows
 * (and miniflare sandboxes) work without an explicit override; production
 * users override with `protected cfBindings = { kv: { cache: '<id>' } }`
 * to point at a real CF resource.
 */
function formatScopedBlock(
  category: 'kv' | 'r2' | 'd1' | 'queue' | 'vectorize',
  bindingName: string,
  override: string | { name: string; id: string } | undefined
): string {
  switch (category) {
    case 'r2': {
      const bucket = typeof override === 'string' ? override : bindingName;
      return `[[r2_buckets]]\nbinding = "${bindingName}"\nbucket_name = "${bucket}"`;
    }
    case 'kv': {
      const id = typeof override === 'string' ? override : bindingName;
      return `[[kv_namespaces]]\nbinding = "${bindingName}"\nid = "${id}"`;
    }
    case 'd1': {
      let dbName: string;
      let dbId: string;
      if (typeof override === 'string') {
        dbName = override;
        dbId = override;
      } else if (override && typeof override === 'object') {
        dbName = override.name;
        dbId = override.id;
      } else {
        dbName = bindingName;
        dbId = bindingName;
      }
      return `[[d1_databases]]\nbinding = "${bindingName}"\ndatabase_name = "${dbName}"\ndatabase_id = "${dbId}"`;
    }
    case 'queue': {
      const queueName = typeof override === 'string' ? override : bindingName;
      return `[[queues.producers]]\nbinding = "${bindingName}"\nqueue = "${queueName}"`;
    }
    case 'vectorize': {
      const indexName = typeof override === 'string' ? override : bindingName;
      return `[[vectorize]]\nbinding = "${bindingName}"\nindex_name = "${indexName}"`;
    }
  }
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
  // Durable Object class name derived from the photon name. Wrangler binds DOs
  // to a JS class identifier, so e.g. `web-lite` → `WebLitePhotonDO`.
  const photonDoClassName =
    photonName
      .split(/[-_]/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join('') + 'PhotonDO';

  logger.info(`Preparing ${photonName} for Cloudflare Workers...`);

  // Create output directory. When the user passes --output we treat the path
  // as theirs to keep; otherwise the project goes into a per-process scratch
  // dir under the OS tmp dir and gets cleaned up after a successful deploy.
  // (On failure or dry-run we keep it so the user can debug or inspect.)
  const userProvidedOutputDir = Boolean(options.outputDir);
  const outputDir =
    options.outputDir || path.join(tmpdir(), `photon-cf-${photonName}-${process.pid}`);
  await fs.mkdir(outputDir, { recursive: true });
  await fs.mkdir(path.join(outputDir, 'src'), { recursive: true });

  // Extract tool definitions using SchemaExtractor
  logger.debug('Extracting tool definitions...');
  const extractor = new SchemaExtractor();
  const sourceCode = await fs.readFile(absolutePath, 'utf-8');
  const metadata = extractor.extractAllFromSource(sourceCode);

  // Route extraction must NOT trust photon-core's metadata.httpRoutes —
  // the published photon-core SchemaExtractor (≤2.25.0) doesn't return
  // it, which silently shipped empty subclass route tables in 1.27.0 and
  // 1.28.0. Always source-extract here. See tests/cf-deploy-codegen.test.ts.
  const routeDefs: HttpRouteDef[] = extractHttpRoutesFromSource(sourceCode);
  // Route handlers must not also surface as MCP tools — they're HTTP-only.
  const routeHandlerNames = new Set(routeDefs.map((r) => r.handler));
  // Track C: `@expose` adds an HTTP route at `/api/<kebab>` but keeps the
  // method in the MCP tool catalog (mirrors the local server). Drop any
  // `@expose` that collides with an explicit `@get`/`@post` so the
  // explicit declaration wins exactly as in `src/loader.ts`.
  const exposeDefs: ExposeDef[] = extractExposesFromSource(sourceCode).filter(
    (e) => !routeHandlerNames.has(e.handler)
  );
  const hostScopes = parseToolScopesFromSource(sourceCode);
  const toolDefs = metadata.tools
    .filter((tool: { name: string }) => !routeHandlerNames.has(tool.name))
    .map((tool: any) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      ...(tool.simpleParams ? { simpleParams: true } : {}),
      scopes: inferToolScopes(tool, hostScopes[tool.name]),
    }));

  const cfAccessEnabled = metadata.auth === 'cf-access';
  const jwtAudience = options.mcpAudience || process.env.PHOTON_MCP_JWT_AUDIENCE;
  if (options.mcpAuth === 'jwt' && !jwtAudience) {
    throw new Error(
      'MCP JWT auth requires an audience. Pass --mcp-audience <url> or set PHOTON_MCP_JWT_AUDIENCE.'
    );
  }
  const jwtConfig =
    options.mcpAuth === 'jwt' ? await loadDeployJwtConfig(photonName, jwtAudience!) : null;
  if (jwtConfig) {
    logger.warn(
      'MCP JWT auth is enabled. Existing PHOTON_MCP_BEARER clients will not authenticate unless they switch to JWT.'
    );
  }

  logger.info(
    `Found ${toolDefs.length} tools, ${routeDefs.length} HTTP routes, ${exposeDefs.length} @expose'd methods`
  );
  const routeConfig = renderCloudflareRouteConfig(options);
  if (routeConfig.publicUrl && routeConfig.toml) {
    logger.info(`Deploy target: ${routeConfig.publicUrl} (workers.dev disabled)`);
  }

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

  // Resolve `@photons` siblings — each becomes its own DO class in the
  // same Worker so the host photon's `this.call('sibling.method', args)`
  // hops via env.PHOTON_<SIBLING>.idFromName(...).fetch(internal-rpc).
  // Single-level resolution for v1 (we don't recursively follow the
  // siblings' own @photons; warn loudly if any are present).
  const siblingNames = parsePhotonPhotons(sourceCode);
  type PhotonSpec = {
    name: string;
    /** TS-identifier import name, e.g. `WebLitePhoton` */
    importName: string;
    /** Module specifier inside the generated worker, e.g. `'./dep-web-lite'` */
    importPath: string;
    /** DO class name, e.g. `WebLitePhotonDO` */
    doClass: string;
    /** Wrangler binding name, e.g. `PHOTON_WEB_LITE` (host always uses bare `PHOTON`) */
    binding: string;
    /** Tool definitions for this photon's MCP surface */
    toolDefs: any[];
    /** HTTP routes from route tags */
    routeDefs: any[];
    /** @expose'd methods bound to /api/<kebab> with a SameSite check */
    exposeDefs: ExposeDef[];
    /** Transformed source written to outputDir/src */
    source: string;
    /** Constructor argument expressions for Worker env injection */
    constructorArgs: string;
    /** Where the source lives in outputDir/src/ */
    sourceFileBase: string;
    /** Whether this is the externally-routed host photon */
    isHost: boolean;
  };

  function nameToImportSymbol(n: string): string {
    return (
      n
        .split(/[-_]/)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join('') + 'Photon'
    );
  }

  const transformedHost = transformPhotonSource(sourceCode);
  const photons: PhotonSpec[] = [
    {
      name: photonName,
      importName: nameToImportSymbol(photonName),
      importPath: './photon',
      doClass: photonDoClassName,
      binding: 'PHOTON',
      toolDefs,
      routeDefs,
      exposeDefs,
      source: transformedHost,
      constructorArgs: renderConstructorArgs(sourceCode, photonName, extractor),
      sourceFileBase: 'photon.ts',
      isHost: true,
    },
  ];

  for (const sibName of siblingNames) {
    const sibPath = resolveSiblingPhoton(sibName, absolutePath);
    if (!sibPath) {
      throw new Error(
        `@photons '${sibName}' could not be resolved. Looked next to ${absolutePath} and in PHOTON_DIR.\n` +
          `Make sure ${sibName}.photon.ts exists and is reachable.`
      );
    }
    const sibSource = await fs.readFile(sibPath, 'utf-8');
    const sibMeta = extractor.extractAllFromSource(sibSource);
    // Same source-extract rule as the host: don't trust photon-core for routes.
    const sibRoutes: HttpRouteDef[] = extractHttpRoutesFromSource(sibSource);
    const sibRouteHandlers = new Set(sibRoutes.map((r) => r.handler));
    const sibExposes: ExposeDef[] = extractExposesFromSource(sibSource).filter(
      (e) => !sibRouteHandlers.has(e.handler)
    );
    const sibScopes = parseToolScopesFromSource(sibSource);
    const sibTools = sibMeta.tools
      .filter((tool: { name: string }) => !sibRouteHandlers.has(tool.name))
      .map((tool: any) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        ...(tool.simpleParams ? { simpleParams: true } : {}),
        scopes: inferToolScopes(tool, sibScopes[tool.name]),
      }));
    // Sibling-level @photons are not recursively bundled in v1 — flag so the
    // user knows their indirect dependency isn't carried along.
    const sibSiblings = parsePhotonPhotons(sibSource);
    if (sibSiblings.length > 0) {
      logger.warn(
        `@photons sibling '${sibName}' itself declares @photons: ${sibSiblings.join(', ')}. ` +
          `Transitive @photons are not bundled in v1 — declare them on the host photon instead.`
      );
    }
    // Sibling @dependencies must be bundled too. Merge into runtimeDeps below.
    const sibDeps = parsePhotonDependencies(sibSource);
    photonDeps.push(
      ...sibDeps.filter((d) => !photonDeps.find((existing) => existing.name === d.name))
    );

    photons.push({
      name: sibName,
      importName: nameToImportSymbol(sibName),
      importPath: `./dep-${sibName}`,
      doClass: photonNameToDoClass(sibName),
      binding: photonNameToBinding(sibName),
      toolDefs: sibTools,
      routeDefs: sibRoutes,
      exposeDefs: sibExposes,
      source: transformPhotonSource(sibSource),
      constructorArgs: renderConstructorArgs(sibSource, sibName, extractor),
      sourceFileBase: `dep-${sibName}.ts`,
      isHost: false,
    });
  }

  if (photons.length > 1) {
    logger.info(
      `Bundling ${photons.length - 1} @photons sibling(s): ${photons
        .slice(1)
        .map((p) => p.name)
        .join(', ')}`
    );
  }

  // Read worker template and substitute multi-photon blocks
  const packageRoot = getPackageRoot();
  const templatePath = path.join(packageRoot, 'templates', 'cloudflare', 'worker.ts.template');
  let workerCode = await fs.readFile(templatePath, 'utf-8');

  const photonImports = photons
    .map((p) => `import ${p.importName} from '${p.importPath}';`)
    .join('\n');
  const photonBindingsMap = JSON.stringify(
    Object.fromEntries(photons.map((p) => [p.name, p.binding]))
  );
  const photonDoClasses = photons
    .map(
      (p) => `export class ${p.doClass} extends BasePhotonDO {
  protected readonly photonName = ${JSON.stringify(p.name)};
  protected readonly toolDefinitions: any[] = ${JSON.stringify(p.toolDefs, null, 2)};
  protected readonly httpRoutes: any[] = ${JSON.stringify(p.routeDefs, null, 2)};
  protected readonly exposes: any[] = ${JSON.stringify(p.exposeDefs, null, 2)};
  protected createPhoton(env: Env) { return new ${p.importName}(${p.constructorArgs}); }
}`
    )
    .join('\n\n');

  workerCode = workerCode
    .replace(/__PHOTON_IMPORTS__/g, photonImports)
    .replace(/__PHOTON_BINDINGS_MAP__/g, photonBindingsMap)
    .replace(/__PHOTON_DO_CLASSES__/g, photonDoClasses)
    .replace(/__HOST_PHOTON_NAME__/g, photonName)
    .replace(/__HOST_BINDING__/g, 'PHOTON')
    .replace(/__DEV_MODE__/g, String(devMode))
    .replace(/__CF_ACCESS_ENABLED__/g, String(cfAccessEnabled))
    .replace(/__INSTANCE_ALIASES__/g, JSON.stringify(parseInstanceAliases()))
    .replace(/__MCP_AUTH_MODE__/g, JSON.stringify(jwtConfig?.mode ?? options.mcpAuth ?? 'legacy'))
    .replace(/__MCP_JWT_ISSUER__/g, JSON.stringify(jwtConfig?.issuer ?? ''))
    .replace(/__MCP_JWT_AUDIENCE__/g, JSON.stringify(jwtConfig?.audience ?? ''))
    .replace(/__MCP_JWT_JWKS__/g, JSON.stringify(jwtConfig?.jwks ?? null));

  // Write photon source files (host + each sibling)
  await fs.writeFile(path.join(outputDir, 'src', 'worker.ts'), workerCode);
  for (const p of photons) {
    await fs.writeFile(path.join(outputDir, 'src', p.sourceFileBase), p.source);
  }

  // Track E: bundle each photon's companion folder into the Worker. The local
  // runtime resolves `this.assets('x')` relative to `<name>/` when that folder
  // exists, and falls back to legacy `<name>/assets/` contents. Keep both
  // layouts available on Cloudflare so deployed photons preserve local
  // `this.assets()` behavior while older [assets] URLs remain stable.
  const assetSourceDirs: { photonName: string; companionDir?: string; legacyAssetsDir?: string }[] =
    [];
  const hostPhotonDir = path.dirname(absolutePath);
  const candidateDirs: { photonName: string; sourcePhotonPath: string }[] = [
    { photonName, sourcePhotonPath: absolutePath },
  ];
  for (const sibName of siblingNames) {
    const sibPath = resolveSiblingPhoton(sibName, absolutePath);
    if (sibPath) candidateDirs.push({ photonName: sibName, sourcePhotonPath: sibPath });
  }
  for (const { photonName: name, sourcePhotonPath } of candidateDirs) {
    const photonBaseName = path.basename(sourcePhotonPath, '.photon.ts');
    const companionDir = path.join(path.dirname(sourcePhotonPath), photonBaseName);
    const legacyAssetsDir = path.join(companionDir, 'assets');
    if (existsSync(companionDir) || existsSync(legacyAssetsDir)) {
      assetSourceDirs.push({
        photonName: name,
        companionDir: existsSync(companionDir) ? companionDir : undefined,
        legacyAssetsDir: existsSync(legacyAssetsDir) ? legacyAssetsDir : undefined,
      });
    }
  }

  // uiId → precompiled-asset descriptor, injected into the worker so
  // `GET /api/ui/<id>` resolves to the cache-busted shell + hashed bundle
  // exactly like the local server and Beam. Without this the Worker would
  // fall through to the [assets] binding and serve raw, unrunnable .tsx.
  const uiManifest: Record<string, { base: string; js: string; hash: string }> = {};

  let assetsBlock = '';
  const publicDir = path.join(outputDir, 'public');
  // Compile and bundle companion UI project if present
  const uiDir = path.join(path.dirname(absolutePath), 'ui');
  if (existsSync(uiDir)) {
    try {
      logger.info('📦 Found companion UI project. Compiling UI...');
      const pm = existsSync(path.join(path.dirname(absolutePath), 'bun.lockb')) ? 'bun' : 'npm';
      const buildCmd = pm === 'bun' ? 'bun run build' : 'npm run build';
      execSync(buildCmd, { cwd: uiDir, stdio: 'inherit' });

      const distDir = existsSync(path.join(uiDir, 'dist', 'browser'))
        ? path.join(uiDir, 'dist', 'browser')
        : path.join(uiDir, 'dist');

      if (existsSync(distDir)) {
        await fs.mkdir(publicDir, { recursive: true });
        logger.info(
          `📦 Copying compiled UI assets from ${distDir} to Cloudflare Assets public root...`
        );
        await fs.cp(distDir, publicDir, { recursive: true });
      } else {
        throw new Error(`Compiled UI output directory not found under ${uiDir}/dist/`);
      }
    } catch (e: any) {
      logger.error(`❌ UI compilation failed: ${e.message || e}`);
      throw e;
    }
  }

  const embeddedAssetContents: Record<string, Record<string, string>> = {};

  // Copy companion folders and legacy `assets/**` contents into public/.
  for (const { photonName: name, companionDir, legacyAssetsDir } of assetSourceDirs) {
    await fs.mkdir(publicDir, { recursive: true });
    embeddedAssetContents[name] = {};

    if (companionDir) {
      await fs.cp(companionDir, path.join(publicDir, name), { recursive: true });
      Object.assign(embeddedAssetContents[name], await collectAssetFiles(companionDir));
    }

    if (legacyAssetsDir) {
      await fs.cp(legacyAssetsDir, path.join(publicDir, name), { recursive: true });
      Object.assign(embeddedAssetContents[name], await collectAssetFiles(legacyAssetsDir));
    }
  }

  // Precompile every @ui .tsx view: esbuild runs here on the deploy
  // machine (it cannot run inside a Worker). Emit the shell + hashed
  // bundle into public/, drop the raw .tsx so source isn't shipped.
  // Done via discoverAssets so BOTH the legacy `ui/` and the canonical
  // `assets/ui/` layouts are covered — not just photons with an
  // `assets/` folder.
  const resolver = new AssetResolver(() => {});
  for (const { photonName: name, sourcePhotonPath } of candidateDirs) {
    let assets;
    try {
      const src = readFileSync(sourcePhotonPath, 'utf-8');
      assets = await resolver.discover(sourcePhotonPath, src);
    } catch {
      continue;
    }
    for (const ui of assets?.ui ?? []) {
      if (!ui.resolvedPath?.endsWith('.tsx')) continue;
      const compiled = compileTsxSync(ui.resolvedPath);
      const relDir = path.posix.join(name, '.photon-ui', ui.id);
      const outDir = path.join(publicDir, name, '.photon-ui', ui.id);
      await fs.mkdir(outDir, { recursive: true });
      await fs.writeFile(path.join(outDir, 'index.html'), compiled.html);
      if (compiled.js) {
        await fs.writeFile(path.join(outDir, compiled.jsFileName), compiled.js);
      }
      // If the raw .tsx got copied in via an `assets/` folder, drop it —
      // the browser runs the precompiled bundle, never the source.
      const rawCopy = path.join(
        publicDir,
        name,
        path.relative(path.join(path.dirname(sourcePhotonPath), name), ui.resolvedPath)
      );
      await fs.rm(rawCopy, { force: true }).catch(() => {});
      uiManifest[ui.id] = {
        base: '/' + relDir,
        js: compiled.jsFileName,
        hash: compiled.hash,
      };
    }
  }

  if (existsSync(publicDir)) {
    const totalCopied = await countFiles(publicDir);
    logger.info(`Bundling ${totalCopied} static asset(s) under public/ for the [assets] binding`);
    // The [assets] block guards against unintended file-system scans by
    // pinning the directory to the deploy-local public/. Binding name is
    // fixed at ASSETS so the worker template's typeof guard resolves
    // without any per-deploy substitution.
    assetsBlock = `\n[assets]\ndirectory = "./public"\nbinding = "ASSETS"\n`;
  }
  // Inject the precompiled-UI manifest now that asset processing is done,
  // then rewrite the worker so `/api/ui/<id>` resolves on Cloudflare.
  workerCode = workerCode
    .replace(/__UI_ASSET_MANIFEST__/g, JSON.stringify(uiManifest))
    .replace(/__PHOTON_ASSET_CONTENTS__/g, JSON.stringify(embeddedAssetContents));
  await fs.writeFile(path.join(outputDir, 'src', 'worker.ts'), workerCode);

  // Reference for clarity in the wrangler.toml: hostPhotonDir is unused for
  // path generation but kept above for symmetry with sibling resolution.
  void hostPhotonDir;

  // Create wrangler.toml — one binding per photon, all classes in one migration
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
  const doBindingsToml = photons
    .map(
      (p) => `[[durable_objects.bindings]]
name = "${p.binding}"
class_name = "${p.doClass}"`
    )
    .join('\n\n');
  const sqliteClassesToml = JSON.stringify(photons.map((p) => p.doClass));

  // Aggregate `protected cfBindings` across the host and any siblings so
  // every binding referenced by `this.cf.*` appears in the generated
  // wrangler.toml. The local override JSON layered on the host photon
  // wins over the source declaration so renames done with `photon cf set`
  // propagate to deploys.
  const cfBindingsToml = await renderCfBindingsToml(
    photons.map((p) => ({ name: p.name, source: p.source })),
    photonName,
    path.dirname(absolutePath)
  );

  let wranglerConfig = await fs.readFile(wranglerTemplatePath, 'utf-8');
  wranglerConfig = wranglerConfig
    .replace(/__PHOTON_NAME__/g, photonName)
    .replace(/__ROUTE_CONFIG__\n?/g, routeConfig.toml)
    .replace(/__DURABLE_OBJECT_BINDINGS__/g, doBindingsToml)
    .replace(/__SQLITE_CLASSES__/g, sqliteClassesToml)
    .replace(/__OBSERVABILITY__\n?/g, observabilityReplacement)
    .replace(/__ASSETS_BLOCK__\n?/g, assetsBlock)
    .replace(/__CF_BINDINGS__\n?/g, cfBindingsToml);
  await fs.writeFile(path.join(outputDir, 'wrangler.toml'), wranglerConfig);

  // Create package.json. Photon-declared dependencies land in `dependencies`
  // so wrangler bundles them into the Worker; build tooling stays in
  // `devDependencies`. The runtime shim's auto-injected deps (cron-parser
  // for `this.schedule`) get merged in here too — pure-JS, work on Workers.
  const runtimeDeps: Record<string, string> = {
    'cron-parser': '^5.0.0',
  };
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
    dependencies: runtimeDeps,
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
        logger.info(routeConfig.publicUrl || `https://${photonName}.<your-subdomain>.workers.dev`);
        if (devMode) {
          logger.info(
            `\nPlayground: ${routeConfig.publicUrl || `https://${photonName}.<your-subdomain>.workers.dev`}/playground`
          );
        }
        // Clean up the scratch project dir on success, but only if the user
        // didn't ask for a specific --output path. Failures keep the dir so
        // the next-steps block below can point at it. Fire-and-forget — we
        // don't block resolution on rm.
        if (!userProvidedOutputDir) {
          fs.rm(outputDir, { recursive: true, force: true }).catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            logger.debug(`Could not clean up scratch dir ${outputDir}: ${msg}`);
          });
        }
        resolve();
      } else {
        // Wrangler's stderr already printed above (stdio: 'inherit'). Add a
        // next-steps block so the user knows where to look without searching.
        const runner = detectRunner();
        logger.error(`\nDeployment failed (exit code ${code}).`);
        logger.error(`\nTo debug:`);
        logger.error(`  cd ${outputDir}`);
        logger.error(`  ${runner} wrangler deploy --verbose    # more detail on what failed`);
        logger.error(`  ${runner} wrangler whoami              # confirm auth + account_id`);
        logger.error(
          `  ${runner} wrangler tail ${photonName}  # runtime errors (if a prior deploy exists)`
        );
        logger.error(`\nCommon causes:`);
        logger.error(`  - Auth: run \`${runner} wrangler login\` (or set CLOUDFLARE_API_TOKEN)`);
        logger.error(
          `  - Bundling: an imported package isn't in @dependencies (see warnings above)`
        );
        logger.error(
          `  - Worker name conflict: \`${photonName}\` already taken by another account`
        );
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

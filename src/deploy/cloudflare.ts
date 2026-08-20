/**
 * Cloudflare Workers deployment for Photon
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { existsSync, readFileSync } from 'fs';
import { execSync, spawn, spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { homedir, tmpdir } from 'node:os';
import { detectPM, detectRunner } from '../shared-utils.js';
import { SchemaExtractor, bindingNameFor, toEnvVarName } from '@portel/photon-core';
import { parseCfBindings } from '../cf-bindings-parser.js';
import { mergeBindings, type CfBindingsConfig } from '../runtime/cf-local.js';
import { scanCfUsage } from '../cf-usage-scanner.js';
import { PHOTON_VERSION } from '../version.js';
import { logger } from '../shared/logger.js';
import { extractHttpRoutesFromSource, type HttpRouteDef } from '../shared/http-route-extractor.js';
import { extractExposesFromSource, type ExposeDef } from '../shared/expose-route-extractor.js';
import { AssetResolver } from '../asset-resolver.js';
import {
  extractAccessClassNames,
  extractAccessMetadata,
  exposeAccessClasses,
} from '../access-control.js';
import { compileTsxSync } from '../tsx-compiler.js';
import type { PhotonAuthIssuer } from '../auth/mcp-jwt.js';
import { extractPhotonAuthDirectiveFromSource } from '../auth/directive.js';
import { buildPhotonRenderMeta } from '../auto-ui/types.js';
import { resolvePhotonStylesheetAssets } from '../auto-ui/stylesheet-assets.js';
import {
  browserInvocableMethodNames,
  extractApplicationManifest,
} from '../auto-ui/app-manifest.js';
import { generateStandaloneWebShell } from '../auto-ui/standalone-web/app-shell.js';
import { extractClassMetadataFromSource } from '../auto-ui/beam/class-metadata.js';
import { contractsForTools } from '../capability-contract.js';
import { generateRenderersScript } from '../auto-ui/bridge/renderers.js';
import { injectIntoHead, ResourceServer } from '../resource-server.js';
import { cleanMcpToolDescription } from '../shared/mcp-tool-metadata.js';
import {
  injectCloudflareMcpOAuth,
  renderCloudflareMcpOAuthBindings,
} from './oauth/cloudflare-mcp-oauth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * The extractor can represent a named object parameter as `{ params: {...} }`
 * while also marking the method as `simpleParams`. That combination is
 * ambiguous on the wire: simple-parameter spreading would pass
 * `arguments.params` as the method's only argument, while the public schema
 * suggests that `params` itself is a field. MCP callers should see the
 * object's fields directly and the Worker should pass that object unchanged.
 */
export function normalizeCloudflareMcpToolDefinition(tool: any): any {
  const properties = tool?.inputSchema?.properties;
  if (
    !tool?.simpleParams ||
    !properties ||
    typeof properties !== 'object' ||
    Object.keys(properties).length !== 1 ||
    !Object.prototype.hasOwnProperty.call(properties, 'params')
  ) {
    return tool;
  }
  const nested = properties.params;
  if (
    !nested ||
    nested.type !== 'object' ||
    !nested.properties ||
    typeof nested.properties !== 'object'
  ) {
    return tool;
  }
  const { simpleParams: _simpleParams, ...rest } = tool;
  return {
    ...rest,
    inputSchema: {
      type: 'object',
      properties: nested.properties,
      ...(Array.isArray(nested.required) ? { required: nested.required } : {}),
      ...(nested.additionalProperties !== undefined
        ? { additionalProperties: nested.additionalProperties }
        : {}),
      ...(nested.description ? { description: nested.description } : {}),
    },
  };
}

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
  extractor: SchemaExtractor,
  envPrefix = photonName
): string {
  if (typeof extractor.resolveInjections !== 'function') {
    return '';
  }
  const injections = extractor.resolveInjections(source, photonName);
  return injections
    .map((injection) => {
      if (injection.injectionType !== 'env') return 'undefined';
      const legacyEnvVar = injection.envVarName!;
      const preferredEnvVar = injection.param?.name
        ? toEnvVarName(envPrefix, injection.param.name)
        : legacyEnvVar;
      const type = JSON.stringify(injection.param?.type ?? 'string');
      if (preferredEnvVar === legacyEnvVar) {
        return `readConstructorEnv(env, ${JSON.stringify(legacyEnvVar)}, ${type})`;
      }
      // Prefer the public Worker namespace while retaining the source-file
      // namespace as a migration fallback for existing deployments.
      return `(readConstructorEnv(env, ${JSON.stringify(preferredEnvVar)}, ${type}) ?? readConstructorEnv(env, ${JSON.stringify(legacyEnvVar)}, ${type}))`;
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
 * Read the browser runtimes used by the generated standalone shell. These
 * files are built as part of Photon itself, so the deployed Worker never
 * needs a public CDN or a runtime package install to render forms/results.
 */
async function readCanonicalWebAssets(packageRoot: string): Promise<Record<string, string>> {
  const formCandidates = [
    path.join(packageRoot, 'dist', 'photon-form.bundle.js'),
    path.join(packageRoot, 'dist', 'beam-form.bundle.js'),
  ];
  let formBundle: string | undefined;
  for (const candidate of formCandidates) {
    try {
      formBundle = await fs.readFile(candidate, 'utf8');
      break;
    } catch {
      // Try the compatibility filename when the canonical bundle is absent.
    }
  }
  if (!formBundle) {
    throw new Error(
      'Photon standalone web assets are unavailable. Run `npm run build` before deploying to Cloudflare.'
    );
  }

  return {
    'photon-form.bundle.js': formBundle,
    'beam-form.bundle.js': formBundle,
    'api/photon-renderers.js': generateRenderersScript(),
  };
}

/**
 * Cloudflare serves MCP App resources from embedded strings, so the normal
 * ResourceServer path (which injects the Photon bridge while reading a UI
 * resource) is not involved. Inject the same bridge at deploy time so a
 * photon written with window.photon/window.openai works identically on local,
 * Beam, and Cloudflare hosts.
 */
function injectCloudflareUiBridge(
  contents: Record<string, string>,
  photonName: string,
  ui: { id: string; linkedTool?: string; linkedTools?: string[]; resolvedPath?: string },
  companionDir?: string,
  legacyAssetsDir?: string
): void {
  if (!ui.resolvedPath) return;
  const candidates = [
    companionDir ? path.relative(companionDir, ui.resolvedPath) : '',
    legacyAssetsDir ? path.relative(legacyAssetsDir, ui.resolvedPath) : '',
    path.basename(ui.resolvedPath),
  ]
    .filter(Boolean)
    .map((key) => key.split(path.sep).join('/'));
  const key =
    candidates.find((candidate) => contents[candidate]) ||
    Object.keys(contents).find((candidate) =>
      candidate.endsWith('/' + path.basename(ui.resolvedPath!))
    );
  if (!key) return;

  const html = Buffer.from(contents[key], 'base64').toString('utf8');
  // A custom UI may mention the MCP Apps handshake without embedding the
  // Photon bridge itself. Only skip injection when the generated bridge
  // marker is present; checking for `ui/initialize` caused Cloudflare builds
  // to silently omit Photon theme tokens and host-context handling.
  const resourceServer = new ResourceServer({} as any, { filePath: '' });
  const hasBridge =
    html.includes('window.photon =') || html.includes('window.__MCP_APPS_CONTEXT__ = true');
  const hasFormRuntime =
    html.includes('data-photon-form-runtime') ||
    html.includes('customElements.define("invoke-form"');
  const hasRenderer = html.includes('data-photon-renderer-runtime');
  if (hasBridge && hasFormRuntime && hasRenderer) return;
  // Reuse the ResourceServer browser pieces that local MCP/HTTP hosts use.
  // A custom UI may already ship its own MCP bridge while still relying on
  // photon.render(), so install the renderer independently when necessary.
  const bridge = [
    hasBridge
      ? ''
      : resourceServer.generateMcpAppsBridge({
          name: photonName,
          injectedPhotons: [],
        } as any),
    hasFormRuntime ? '' : resourceServer.generatePhotonFormRuntime(),
    hasRenderer ? '' : resourceServer.generatePhotonRendererRuntime(),
  ]
    .filter(Boolean)
    .join('\n');
  const stylesheetById = new Map<string, string>();
  for (const [assetKey, encoded] of Object.entries(contents)) {
    const normalized = assetKey.replace(/^assets\//, '');
    if (
      normalized !== 'photon.css' &&
      !/^formats\/[A-Za-z0-9][A-Za-z0-9_-]*\.css$/.test(normalized)
    ) {
      continue;
    }
    const id =
      normalized === 'photon.css' ? 'photon' : `format:${path.basename(normalized, '.css')}`;
    // Canonical and legacy copy roots can expose the same stylesheet under
    // two keys. Inject each semantic stylesheet once.
    if (!stylesheetById.has(id)) stylesheetById.set(id, encoded);
  }
  const styleEntries = [...stylesheetById.entries()]
    .map(([id, encoded]) => {
      const css = Buffer.from(encoded, 'base64')
        .toString('utf8')
        .replace(/<\/style/gi, '<\\/style');
      return `<style data-photon-style="${id}">\n${css}\n</style>`;
    })
    .join('\n');
  const browserRuntime = [styleEntries, bridge].filter(Boolean).join('\n');
  const injected = injectIntoHead(html, browserRuntime);
  contents[key] = Buffer.from(injected, 'utf8').toString('base64');
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

async function copyLocalWorkerImports(
  source: string,
  sourcePath: string,
  outputDir: string,
  sourceRoot: string,
  visited = new Set<string>()
): Promise<void> {
  const importRe = /(?:from\s+|import\s*\(\s*)(['"])(\.[^'"]+)\1/g;
  for (const match of source.matchAll(importRe)) {
    const specifier = match[2];
    let importedPath = path.resolve(path.dirname(sourcePath), specifier);
    if (!path.extname(importedPath)) importedPath += '.ts';
    if (!existsSync(importedPath) || visited.has(importedPath)) continue;
    visited.add(importedPath);
    const relative = path.relative(sourceRoot, importedPath);
    const destination = path.join(outputDir, 'src', relative);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    const importedSource = await fs.readFile(importedPath, 'utf-8');
    await fs.writeFile(destination, transformPhotonSource(importedSource));
    await copyLocalWorkerImports(importedSource, importedPath, outputDir, sourceRoot, visited);
  }
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
  /** Cloudflare Worker script name; defaults to the Photon filename. */
  workerName?: string;
  outputDir?: string;
  devMode?: boolean;
  dryRun?: boolean;
  publicUrl?: string;
  customDomain?: string;
  routePattern?: string;
  mcpAuth?: 'jwt' | 'bearer' | 'open' | 'oauth';
  mcpAudience?: string;
  /**
   * Enable Cloudflare Workers Logs in the generated `wrangler.toml`.
   * When true, every Worker invocation is captured in the CF dashboard
   * with ~3-day retention. Off by default — Workers Logs is opt-in so
   * deployments stay minimal until the user explicitly wants observability.
   */
  withLogs?: boolean;
}

type CloudflareOAuthAuthMode = 'optional' | 'required';

/**
 * Read the shared class-level OAuth directive used by every Photon runtime.
 * Non-OAuth tags retain legacy behavior; malformed or duplicate metadata
 * fails deployment closed.
 */
function parseCloudflareOAuthAuthMode(source: string): CloudflareOAuthAuthMode | undefined {
  const result = extractPhotonAuthDirectiveFromSource(source);
  if (!result) return undefined;
  if (result.error || !result.directive) {
    throw new Error(`Invalid class-level @auth metadata: ${result.error ?? 'unknown error'}`);
  }
  return result.directive.scheme === 'oauth' ? result.directive.mode : undefined;
}

interface CloudflareRouteConfig {
  toml: string;
  publicUrl?: string;
  /**
   * A legacy zone route can override a custom-domain binding. Keep the exact
   * route target alongside the generated TOML so deploy can reconcile that
   * stale route after upload.
   */
  reconcile?: {
    pattern: string;
    zoneName: string;
  };
}

interface CloudflareVersionSummary {
  id: string;
  metadata?: { created_on?: string };
}

interface CloudflareWorkerVersionDetails extends CloudflareVersionSummary {
  resources?: {
    script?: { bindings?: Array<Record<string, unknown>> };
    bindings?: Array<Record<string, unknown>>;
  };
}

/**
 * Select the newest uploaded Worker version from Wrangler's JSON output.
 *
 * `wrangler deploy` can finish after uploading a version without making that
 * version the one serving traffic (notably when versioned deployments are in
 * use). Promotion is therefore an explicit second step in the deploy flow.
 */
export function selectLatestCloudflareVersion(output: string): string {
  let versions: CloudflareVersionSummary[] | undefined;
  let sawJsonArray = false;
  const end = output.lastIndexOf(']');
  if (end < 0) {
    throw new Error('Could not parse Wrangler version list output as JSON.');
  }
  for (
    let start = output.indexOf('[');
    start >= 0 && start < end;
    start = output.indexOf('[', start + 1)
  ) {
    try {
      const candidate = JSON.parse(output.slice(start, end + 1));
      if (Array.isArray(candidate)) {
        sawJsonArray = true;
        const validCandidate = candidate.filter(
          (version): version is CloudflareVersionSummary =>
            !!version &&
            typeof version === 'object' &&
            typeof (version as { id?: unknown }).id === 'string' &&
            (version as { id: string }).id.length > 0
        );
        // Bun may prefix `bunx` output with a progress array such as `[2]`.
        // Keep scanning until we find the actual Wrangler version payload.
        if (validCandidate.length > 0) {
          versions = validCandidate;
          break;
        }
      }
    } catch {
      // Wrangler may prefix JSON with notices or ANSI-formatted log lines.
    }
  }
  if (!sawJsonArray) {
    throw new Error('Could not parse Wrangler version list output as JSON.');
  }
  if (!versions || versions.length === 0) {
    throw new Error('Wrangler returned no deployable Worker versions.');
  }

  versions.sort((a, b) => {
    const aTime = Date.parse(a.metadata?.created_on || '');
    const bTime = Date.parse(b.metadata?.created_on || '');
    return (Number.isNaN(aTime) ? 0 : aTime) - (Number.isNaN(bTime) ? 0 : bTime);
  });
  return versions[versions.length - 1].id;
}

export function ensureNewCloudflareVersion(versionId: string, previousVersionId?: string): string {
  if (previousVersionId && versionId === previousVersionId) {
    throw new Error('Cloudflare has not exposed the newly uploaded Worker version yet.');
  }
  return versionId;
}

export interface CloudflareDurableObjectSpec {
  binding: string;
  doClass: string;
}

/** Resolve the Cloudflare script name without requiring deployment metadata in the Photon source. */
export function resolveCloudflareWorkerName(photonName: string, workerName?: string): string {
  return (workerName?.trim() || photonName).replace(/[^a-z0-9-]/gi, '-');
}

/**
 * Keep generated Durable Object bindings compatible with a Worker that was
 * deployed with Wrangler class-renaming migrations in an earlier Photon
 * release. Wrangler validates the complete migration history on every upload;
 * dropping that history makes an otherwise valid deploy fail with code 10064.
 */
export function reconcileCloudflareDurableObjectMigrationArtifacts(
  wranglerConfig: string,
  workerCode: string,
  specs: CloudflareDurableObjectSpec[],
  currentClasses: Record<string, string>
): { wranglerConfig: string; workerCode: string; changed: boolean } {
  const renames = new Map<number, string[]>();
  let nextConfig = wranglerConfig;
  let nextWorker = workerCode;
  let changed = false;

  for (const spec of specs) {
    const current = currentClasses[spec.binding];
    if (!current || current === spec.doClass) continue;
    const suffix = current.match(new RegExp(`^${escapeRegExp(spec.doClass)}_v(\\d+)$`));

    // A Photon filename is its default runtime identity. When that identity
    // changes, the generated DO class changes too. Preserve the old class's
    // migration history and add one final rename rather than asking Wrangler
    // to replace a class that existing DO instances still reference.
    const currentVersionMatch = current.match(/^(.+)_v(\d+)$/);
    const currentBase = currentVersionMatch?.[1] || current;
    const currentVersion = Number(currentVersionMatch?.[2] || 1);
    const isPhotonIdentityRename = !suffix && spec.binding === 'PHOTON';

    if (isPhotonIdentityRename && Number.isInteger(currentVersion) && currentVersion >= 1) {
      const sqliteClassRe = new RegExp(
        `(new_sqlite_classes\\s*=\\s*\\[)"${escapeRegExp(spec.doClass)}"(\\])`
      );
      if (!sqliteClassRe.test(nextConfig)) continue;
      nextConfig = nextConfig.replace(sqliteClassRe, `$1"${currentBase}"$2`);

      for (let migration = 2; migration <= currentVersion; migration += 1) {
        const from = migration === 2 ? currentBase : `${currentBase}_v${migration - 1}`;
        const to = `${currentBase}_v${migration}`;
        const entries = renames.get(migration) ?? [];
        entries.push(`{ from = "${from}", to = "${to}" }`);
        renames.set(migration, entries);
      }

      const renameMigration = currentVersion + 1;
      const entries = renames.get(renameMigration) ?? [];
      entries.push(`{ from = "${current}", to = "${spec.doClass}" }`);
      renames.set(renameMigration, entries);
      changed = true;
      continue;
    }

    if (!suffix) continue;
    const version = Number(suffix[1]);
    if (!Number.isInteger(version) || version < 2) continue;

    const bindingRe = new RegExp(
      `(name\\s*=\\s*"${escapeRegExp(spec.binding)}"\\s*\\n\\s*class_name\\s*=\\s*)"${escapeRegExp(spec.doClass)}"`
    );
    if (!bindingRe.test(nextConfig)) continue;
    nextConfig = nextConfig.replace(bindingRe, `$1"${current}"`);
    nextWorker = nextWorker.replace(
      new RegExp(`export class ${escapeRegExp(spec.doClass)} extends BasePhotonDO`),
      `export class ${current} extends BasePhotonDO`
    );

    for (let migration = 2; migration <= version; migration += 1) {
      const from = migration === 2 ? spec.doClass : `${spec.doClass}_v${migration - 1}`;
      const to = `${spec.doClass}_v${migration}`;
      const entries = renames.get(migration) ?? [];
      entries.push(`{ from = "${from}", to = "${to}" }`);
      renames.set(migration, entries);
    }
    changed = true;
  }

  if (changed && renames.size > 0) {
    const history = Array.from(renames.entries())
      .sort(([a], [b]) => a - b)
      .map(
        ([version, entries]) =>
          `\n[[migrations]]\ntag = "v${version}"\nrenamed_classes = [${entries.join(', ')}]\n`
      )
      .join('');
    nextConfig += history;
  }

  return { wranglerConfig: nextConfig, workerCode: nextWorker, changed };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&');
}

export function parseCloudflareDurableObjectVersion(output: string): Record<string, string> {
  const firstObject = output.indexOf('{');
  const lastObject = output.lastIndexOf('}');
  if (firstObject >= 0 && lastObject > firstObject) {
    try {
      const parsed = JSON.parse(output.slice(firstObject, lastObject + 1));
      const bindings = parsed?.resources?.bindings ?? parsed?.resources?.script?.bindings;
      if (Array.isArray(bindings)) {
        const classes: Record<string, string> = {};
        for (const binding of bindings) {
          if (
            binding?.type === 'durable_object_namespace' &&
            typeof binding.name === 'string' &&
            typeof binding.class_name === 'string'
          ) {
            classes[binding.name] = binding.class_name;
          }
        }
        if (Object.keys(classes).length > 0) return classes;
      }
    } catch {
      // Fall back to the human-readable view below for older Wrangler versions.
    }
  }
  const classes: Record<string, string> = {};
  const bindingRe = /env\.([A-Z0-9_]+)\s+\(([^)]+)\)\s+Durable Object/g;
  for (const match of output.matchAll(bindingRe)) classes[match[1]] = match[2];
  return classes;
}

function extractCloudflareAccountId(output: string): string | undefined {
  const firstObject = output.indexOf('{');
  const lastObject = output.lastIndexOf('}');
  if (firstObject < 0 || lastObject <= firstObject) return undefined;
  try {
    const parsed = JSON.parse(output.slice(firstObject, lastObject + 1));
    const account = parsed?.accounts?.[0];
    return typeof account?.id === 'string' && account.id.length > 0 ? account.id : undefined;
  } catch {
    return undefined;
  }
}

function cloudflareAccountId(outputDir: string, env: NodeJS.ProcessEnv): string | undefined {
  const configured = env.CLOUDFLARE_ACCOUNT_ID || env.CF_ACCOUNT_ID;
  if (configured) return configured;
  const whoami = spawnSync(detectRunner(), ['wrangler', 'whoami', '--json'], {
    cwd: outputDir,
    encoding: 'utf-8',
    env,
  });
  return extractCloudflareAccountId(`${whoami.stdout || ''}\n${whoami.stderr || ''}`);
}

async function fetchCloudflareWorkerVersionIds(
  outputDir: string,
  workerName: string,
  env: NodeJS.ProcessEnv
): Promise<string[]> {
  const resolved = resolveCloudflareApiToken();
  const accountId = cloudflareAccountId(outputDir, env);
  if (!resolved || !accountId) return [];
  try {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${encodeURIComponent(workerName)}/versions`,
      { headers: { Authorization: `Bearer ${resolved.token}` } }
    );
    if (!response.ok) return [];
    const payload = (await response.json()) as {
      result?: {
        items?: Array<{
          id?: unknown;
          metadata?: { created_on?: string };
        }>;
      };
    };
    return (payload.result?.items ?? [])
      .filter((version) => typeof version.id === 'string' && version.id.length > 0)
      .sort((a, b) => {
        const aTime = Date.parse(a.metadata?.created_on || '');
        const bTime = Date.parse(b.metadata?.created_on || '');
        return (Number.isNaN(bTime) ? 0 : bTime) - (Number.isNaN(aTime) ? 0 : aTime);
      })
      .map((version) => version.id as string);
  } catch {
    return [];
  }
}

async function fetchCloudflareWorkerVersion(
  outputDir: string,
  workerName: string,
  versionId: string,
  env: NodeJS.ProcessEnv
): Promise<CloudflareWorkerVersionDetails | undefined> {
  const resolved = resolveCloudflareApiToken();
  const accountId = cloudflareAccountId(outputDir, env);
  if (!resolved || !accountId) return undefined;
  try {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${encodeURIComponent(workerName)}/versions/${encodeURIComponent(versionId)}`,
      { headers: { Authorization: `Bearer ${resolved.token}` } }
    );
    if (!response.ok) return undefined;
    const payload = (await response.json()) as { result?: CloudflareWorkerVersionDetails };
    return payload.result;
  } catch {
    return undefined;
  }
}

function durableObjectClassesFromVersion(
  version: CloudflareWorkerVersionDetails | undefined
): Record<string, string> {
  const bindings = version?.resources?.bindings ?? version?.resources?.script?.bindings;
  if (!Array.isArray(bindings)) return {};
  const classes: Record<string, string> = {};
  for (const binding of bindings) {
    if (
      binding?.type === 'durable_object_namespace' &&
      typeof binding.name === 'string' &&
      typeof binding.class_name === 'string'
    ) {
      classes[binding.name] = binding.class_name;
    }
  }
  return classes;
}

async function discoverCloudflareDurableObjectClasses(
  outputDir: string,
  workerName: string,
  env: NodeJS.ProcessEnv
): Promise<Record<string, string>> {
  const list = spawnSync(
    detectRunner(),
    ['wrangler', 'versions', 'list', '--name', workerName, '--json'],
    { cwd: outputDir, encoding: 'utf-8', env }
  );
  const versionOutput = `${list.stdout || ''}\n${list.stderr || ''}`;
  let versionIds = Array.from(versionOutput.matchAll(/"id"\s*:\s*"([^"]+)"/g))
    .map((match) => match[1])
    .filter((id, index, all) => all.indexOf(id) === index)
    .reverse();
  if (versionIds.length === 0) {
    versionIds = await fetchCloudflareWorkerVersionIds(outputDir, workerName, env);
  }
  logger.info(
    `Cloudflare version discovery found ${versionIds.length} version(s) for ${workerName}.`
  );

  // Secret-only versions can occasionally omit the binding summary while the
  // version is still propagating. Walk recent versions until one exposes the
  // Durable Object bindings instead of treating that transient state as a
  // first deployment.
  for (const versionId of versionIds.slice(0, 5)) {
    const view = spawnSync(
      detectRunner(),
      ['wrangler', 'versions', 'view', versionId, '--name', workerName, '--json'],
      { cwd: outputDir, encoding: 'utf-8', env }
    );
    if (view.status === 0) {
      const output = `${view.stdout || ''}\n${view.stderr || ''}`;
      const classes = parseCloudflareDurableObjectVersion(output);
      if (Object.keys(classes).length > 0) return classes;
    }

    const details = await fetchCloudflareWorkerVersion(outputDir, workerName, versionId, env);
    const apiClasses = durableObjectClassesFromVersion(details);
    if (Object.keys(apiClasses).length > 0) {
      logger.info(`Cloudflare version ${versionId} exposes Durable Object bindings.`);
      return apiClasses;
    }
  }
  return {};
}

async function readLatestCloudflareVersionId(
  outputDir: string,
  workerName: string,
  env: NodeJS.ProcessEnv
): Promise<string | undefined> {
  const list = spawnSync(
    detectRunner(),
    ['wrangler', 'versions', 'list', '--name', workerName, '--json'],
    { cwd: outputDir, encoding: 'utf-8', env }
  );
  if (list.status !== 0) return undefined;
  try {
    return selectLatestCloudflareVersion(`${list.stdout || ''}\n${list.stderr || ''}`);
  } catch {
    return (await fetchCloudflareWorkerVersionIds(outputDir, workerName, env))[0];
  }
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

export function renderCloudflareRouteConfig(
  options: CloudflareDeployOptions
): CloudflareRouteConfig {
  const targets = [options.publicUrl, options.customDomain, options.routePattern].filter(Boolean);
  if (targets.length > 1) {
    throw new Error('Choose only one Cloudflare deploy target: --url, --domain, or --route.');
  }

  if (options.customDomain) {
    const domain = normalizeHostname(options.customDomain, '--domain');
    return {
      publicUrl: `https://${domain}`,
      toml: renderRoutesToml([{ pattern: domain, customDomain: true }]),
      reconcile: {
        pattern: `${domain}/*`,
        zoneName: zoneNameForRoutePattern(domain),
      },
    };
  }

  if (options.routePattern) {
    const pattern = normalizeRoutePattern(options.routePattern);
    return {
      publicUrl: routePatternToDisplayUrl(pattern),
      toml: renderRoutesToml([
        { pattern, customDomain: false, zoneName: zoneNameForRoutePattern(pattern) },
      ]),
      reconcile: {
        pattern,
        zoneName: zoneNameForRoutePattern(pattern),
      },
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
      reconcile: {
        pattern: `${parsed.hostname}/*`,
        zoneName: zoneNameForRoutePattern(parsed.hostname),
      },
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

function zoneNameForRoutePattern(pattern: string): string {
  const hostname = pattern.split('/')[0].toLowerCase();
  const labels = hostname.split('.').filter(Boolean);
  if (labels.length < 2) {
    throw new Error(`Cloudflare --route must include a valid hostname: ${pattern}`);
  }
  return labels.slice(-2).join('.');
}

function renderRoutesToml(
  routes: Array<{ pattern: string; customDomain: boolean; zoneName?: string }>
): string {
  const renderedRoutes = routes
    .map((route) => {
      const entries = [`pattern = ${JSON.stringify(route.pattern)}`];
      if (route.customDomain) entries.push('custom_domain = true');
      else if (route.zoneName) entries.push(`zone_name = ${JSON.stringify(route.zoneName)}`);
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
  const workerName = resolveCloudflareWorkerName(photonName, options.workerName);
  if (!workerName) throw new Error('Cloudflare Worker name must not be empty');
  // Durable Object class name derived from the photon name. Wrangler binds DOs
  // to a JS class identifier, so e.g. `web-lite` → `WebLitePhotonDO`.
  const photonDoClassName =
    photonName
      .split(/[-_]/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join('') + 'PhotonDO';

  logger.info(`Preparing ${photonName} for Cloudflare Workers as Worker ${workerName}...`);

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
  const assetResolver = new AssetResolver(() => {});
  const hostAssets = await assetResolver.discover(absolutePath, sourceCode);
  const hostStylesheets = await resolvePhotonStylesheetAssets(absolutePath, sourceCode);
  const oauthCustomCss = hostStylesheets.oauth
    ? await fs.readFile(hostStylesheets.oauth.resolvedPath, 'utf8')
    : undefined;
  const uiByTool = new Map<string, string>();
  for (const ui of hostAssets?.ui ?? []) {
    for (const toolName of ui.linkedTools ?? (ui.linkedTool ? [ui.linkedTool] : [])) {
      uiByTool.set(toolName, ui.id);
    }
  }

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
  const hostAccess = extractAccessMetadata(sourceCode);
  const toolDefs = metadata.tools
    .filter((tool: { name: string }) => !routeHandlerNames.has(tool.name))
    .map((tool: any) => {
      const toolDef: any = {
        name: tool.name,
        description: cleanMcpToolDescription(tool.description),
        inputSchema: tool.inputSchema,
        ...(tool.simpleParams ? { simpleParams: true } : {}),
        scopes: inferToolScopes(tool, hostScopes[tool.name]),
        ...(hostAccess[tool.name] ? { access: hostAccess[tool.name] } : {}),
      };
      if (tool.outputSchema) toolDef.outputSchema = tool.outputSchema;
      if (uiByTool.has(tool.name)) toolDef.linkedUi = uiByTool.get(tool.name);
      const annotations: Record<string, unknown> = {};
      // Keep safety classifications explicit for MCP clients. In particular,
      // an omitted destructiveHint is interpreted as destructive by some
      // approval UIs, even when readOnlyHint is true.
      annotations.readOnlyHint = tool.readOnlyHint === true;
      annotations.destructiveHint = tool.destructiveHint === true;
      annotations.idempotentHint = tool.idempotentHint === true;
      if (tool.openWorldHint !== undefined) annotations.openWorldHint = tool.openWorldHint;
      if (Object.keys(annotations).length > 0) toolDef.annotations = annotations;
      const renderMeta = buildPhotonRenderMeta(tool);
      if (renderMeta) toolDef._meta = { 'photon/render': renderMeta };
      return normalizeCloudflareMcpToolDefinition(toolDef);
    });

  // The generated web shell is deliberately a composition hint, not a
  // second tool catalog. Build its navigation from the canonical capability
  // contracts, then let the shell reconcile that manifest with this caller's
  // runtime `tools/list` response. Access/role filtering therefore remains a
  // Worker/MCP concern rather than becoming deploy-time HTML state.
  const manifestTools = (metadata.tools as any[]).filter(
    (tool) => !routeHandlerNames.has(tool.name)
  );
  const browserInvocableMethods = browserInvocableMethodNames(
    contractsForTools(manifestTools as any)
  );
  const manifestMethods = manifestTools.map((tool: any) => ({
    name: tool.name,
    description: cleanMcpToolDescription(tool.description),
    ...(uiByTool.has(tool.name) ? { linkedUi: uiByTool.get(tool.name) } : {}),
    ...(tool.title ? { title: tool.title } : {}),
    ...(tool.buttonLabel ? { buttonLabel: tool.buttonLabel } : {}),
    ...(tool.icon ? { icon: tool.icon } : {}),
    ...(tool.internal ? { internal: true } : {}),
    ...(tool.isTemplate ? { isTemplate: true } : {}),
    ...(tool.scheduled ? { scheduled: tool.scheduled } : {}),
    ...(tool.webhook ? { webhook: tool.webhook } : {}),
    ...(tool.visibility ? { visibility: tool.visibility } : {}),
  }));
  const classMetadata = extractClassMetadataFromSource(sourceCode);
  const appEntry =
    manifestMethods.find((method) => method.name === 'main')?.name ||
    manifestMethods.find((method) => method.linkedUi)?.name;
  const appManifest = extractApplicationManifest(manifestMethods, {
    entry: appEntry,
    settings: (metadata as any).settingsSchema?.hasSettings === true,
    name: classMetadata.label,
    autoScreens: true,
    browserInvocableMethods,
  });
  const hasExplicitHttpRoot = routeDefs.some(
    (route) => route.method === 'GET' && route.path === '/'
  );
  const hasCustomUi = (hostAssets?.ui?.length ?? 0) > 0;
  const standaloneWebShell =
    appManifest && !hasExplicitHttpRoot && !hasCustomUi
      ? generateStandaloneWebShell({
          photonName,
          title: classMetadata.label || photonName,
          description: classMetadata.description,
          icon: classMetadata.icon,
          manifest: appManifest,
          browserInvocableMethods,
        })
      : undefined;

  const declaredOAuthMode = parseCloudflareOAuthAuthMode(sourceCode);
  // An explicit CLI value is authoritative. When it is omitted, the
  // class-level Photon contract can opt the generated Worker into OAuth.
  const effectiveMcpAuth = options.mcpAuth ?? (declaredOAuthMode ? 'oauth' : undefined);
  const oauthAuthMode: CloudflareOAuthAuthMode | undefined =
    effectiveMcpAuth === 'oauth' ? (declaredOAuthMode ?? 'required') : undefined;
  const cfAccessEnabled = metadata.auth === 'cf-access';
  const jwtAudience = options.mcpAudience || process.env.PHOTON_MCP_JWT_AUDIENCE;
  if (effectiveMcpAuth === 'jwt' && !jwtAudience) {
    throw new Error(
      'MCP JWT auth requires an audience. Pass --mcp-audience <url> or set PHOTON_MCP_JWT_AUDIENCE.'
    );
  }
  const jwtConfig =
    effectiveMcpAuth === 'jwt' ? await loadDeployJwtConfig(photonName, jwtAudience!) : null;
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
  const oauthIssuer = process.env.PHOTON_MCP_OAUTH_ISSUER || routeConfig.publicUrl;
  if (effectiveMcpAuth === 'oauth') {
    if (!oauthIssuer) {
      throw new Error(
        'MCP OAuth requires a stable issuer. Pass --domain/--url/--route or set PHOTON_MCP_OAUTH_ISSUER.'
      );
    }
    let parsedIssuer: URL;
    try {
      parsedIssuer = new URL(oauthIssuer);
    } catch {
      throw new Error(`Invalid MCP OAuth issuer: ${oauthIssuer}`);
    }
    if (
      parsedIssuer.protocol !== 'https:' ||
      parsedIssuer.username ||
      parsedIssuer.password ||
      parsedIssuer.search ||
      parsedIssuer.hash
    ) {
      throw new Error('MCP OAuth issuer must be an HTTPS URL without credentials, query, or hash.');
    }
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
    /** Named policy classes exported from this generated source module. */
    accessClassImports: string[];
    /** Embedded MCP App UI assets for this photon. */
    uiAssets: Array<{ id: string; file?: string }>;
    /** Generated secure web shell, present only when no explicit web UI wins. */
    standaloneWebShell?: string;
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
  const exposedHostSource = exposeAccessClasses(transformedHost);
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
      source: exposedHostSource,
      constructorArgs: renderConstructorArgs(sourceCode, photonName, extractor, workerName),
      sourceFileBase: 'photon.ts',
      isHost: true,
      accessClassImports: extractAccessClassNames(sourceCode).filter((name) =>
        exposedHostSource.includes(`export { ${name}`)
      ),
      uiAssets: (hostAssets?.ui ?? []).map((ui) => ({
        id: ui.id,
        file: ui.resolvedPath ? path.basename(ui.resolvedPath) : undefined,
      })),
      standaloneWebShell,
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
      .map((tool: any) =>
        normalizeCloudflareMcpToolDefinition({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          ...(tool.simpleParams ? { simpleParams: true } : {}),
          scopes: inferToolScopes(tool, sibScopes[tool.name]),
        })
      );
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
      constructorArgs: renderConstructorArgs(sibSource, sibName, extractor, sibName),
      sourceFileBase: `dep-${sibName}.ts`,
      isHost: false,
      accessClassImports: [],
      uiAssets: [],
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
  const standaloneWebShells = Object.fromEntries(
    photons
      .filter((photon) => photon.standaloneWebShell)
      .map((photon) => [photon.name, photon.standaloneWebShell])
  );
  const canonicalWebAssets = Object.keys(standaloneWebShells).length
    ? await readCanonicalWebAssets(packageRoot)
    : {};

  const photonImports = photons
    .map(
      (p) =>
        `import ${p.importName}${p.accessClassImports.length ? `, { ${p.accessClassImports.join(', ')} }` : ''} from '${p.importPath}';`
    )
    .join('\n');
  const photonBindingsMap = JSON.stringify(
    Object.fromEntries(photons.map((p) => [p.name, p.binding]))
  );
  const photonUiAssets = JSON.stringify(
    Object.fromEntries(photons.map((p) => [p.name, p.uiAssets]))
  );
  const photonDoClasses = photons
    .map(
      (p) => `export class ${p.doClass} extends BasePhotonDO {
  protected readonly photonName = ${JSON.stringify(p.name)};
  protected readonly toolDefinitions: any[] = ${JSON.stringify(p.toolDefs, null, 2)};
  protected readonly httpRoutes: any[] = ${JSON.stringify(p.routeDefs, null, 2)};
  protected readonly exposes: any[] = ${JSON.stringify(p.exposeDefs, null, 2)};
  protected createPhoton(env: Env) {
    const photon = new ${p.importName}(${p.constructorArgs});
    Object.defineProperty(photon, '__accessClasses', {
      value: { ${p.importName}, ${p.accessClassImports.join(', ')} },
      enumerable: false,
    });
    return photon;
  }
}`
    )
    .join('\n\n');

  workerCode = workerCode
    .replace(/__PHOTON_IMPORTS__/g, photonImports)
    .replace(/__PHOTON_BINDINGS_MAP__/g, photonBindingsMap)
    .replace(/__PHOTON_UI_ASSETS__/g, photonUiAssets)
    .replace(/__STANDALONE_WEB_SHELLS__/g, () => JSON.stringify(standaloneWebShells))
    .replace(/__CANONICAL_WEB_ASSETS__/g, () => JSON.stringify(canonicalWebAssets))
    .replace(/__PHOTON_DO_CLASSES__/g, photonDoClasses)
    .replace(/__HOST_PHOTON_NAME__/g, photonName)
    .replace(/__HOST_BINDING__/g, 'PHOTON')
    .replace(/__DEV_MODE__/g, String(devMode))
    .replace(/__CF_ACCESS_ENABLED__/g, String(cfAccessEnabled))
    .replace(/__INSTANCE_ALIASES__/g, JSON.stringify(parseInstanceAliases()))
    .replace(/__MCP_AUTH_MODE__/g, JSON.stringify(jwtConfig?.mode ?? effectiveMcpAuth ?? 'legacy'))
    .replace(/__MCP_JWT_ISSUER__/g, JSON.stringify(jwtConfig?.issuer ?? ''))
    .replace(/__MCP_JWT_AUDIENCE__/g, JSON.stringify(jwtConfig?.audience ?? ''))
    .replace(/__MCP_JWT_JWKS__/g, JSON.stringify(jwtConfig?.jwks ?? null))
    .replace(/__PHOTON_VERSION__/g, JSON.stringify(PHOTON_VERSION));

  if (effectiveMcpAuth === 'oauth') {
    const oauthScopes = Array.from(
      new Set(
        toolDefs.flatMap((tool: any) =>
          Array.isArray(tool.scopes)
            ? tool.scopes.filter((scope: unknown): scope is string => typeof scope === 'string')
            : []
        )
      )
    );
    workerCode = injectCloudflareMcpOAuth(workerCode, {
      photonName,
      photonDisplayName: classMetadata.label || photonName,
      photonIcon: classMetadata.icon,
      photonDescription: classMetadata.description,
      scopes: oauthScopes,
      issuer: oauthIssuer!,
      oauthAuthMode: oauthAuthMode!,
      kvNamespaceId: process.env.PHOTON_MCP_OAUTH_KV_ID,
      oauthCustomCss,
    });
  }

  // Write photon source files (host + each sibling)
  await fs.writeFile(path.join(outputDir, 'src', 'worker.ts'), workerCode);
  for (const p of photons) {
    await fs.writeFile(path.join(outputDir, 'src', p.sourceFileBase), p.source);
  }
  await copyLocalWorkerImports(sourceCode, absolutePath, outputDir, path.dirname(absolutePath));

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

    const sourcePhotonPath = candidateDirs.find(
      (candidate) => candidate.photonName === name
    )?.sourcePhotonPath;
    if (sourcePhotonPath) {
      const source = readFileSync(sourcePhotonPath, 'utf-8');
      const assets = await assetResolver.discover(sourcePhotonPath, source);
      for (const ui of assets?.ui ?? []) {
        if (/\.html?$/i.test(ui.resolvedPath || '')) {
          injectCloudflareUiBridge(
            embeddedAssetContents[name],
            name,
            ui,
            companionDir,
            legacyAssetsDir
          );
        }
      }
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
  if (workerName !== photonName) {
    wranglerConfig = wranglerConfig.replace(/^name = .*$/m, `name = ${JSON.stringify(workerName)}`);
  }
  if (effectiveMcpAuth === 'oauth') {
    wranglerConfig += `\n\n${renderCloudflareMcpOAuthBindings(process.env.PHOTON_MCP_OAUTH_KV_ID)}\n`;
  }
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
    name: workerName,
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

  // Existing Workers can carry Durable Object class-renaming migrations from
  // an earlier Photon release. Reconcile the scratch artifacts before
  // Wrangler validates the upload so a normal redeploy remains safe.
  const currentDoClasses = await discoverCloudflareDurableObjectClasses(
    outputDir,
    workerName,
    envForWrangler
  );
  if (Object.keys(currentDoClasses).length > 0) {
    const configPath = path.join(outputDir, 'wrangler.toml');
    const workerPath = path.join(outputDir, 'src', 'worker.ts');
    const artifacts = reconcileCloudflareDurableObjectMigrationArtifacts(
      await fs.readFile(configPath, 'utf8'),
      await fs.readFile(workerPath, 'utf8'),
      photons.map((photon) => ({ binding: photon.binding, doClass: photon.doClass })),
      currentDoClasses
    );
    if (artifacts.changed) {
      await fs.writeFile(configPath, artifacts.wranglerConfig);
      await fs.writeFile(workerPath, artifacts.workerCode);
      logger.info('Preserved the existing Durable Object migration history for this Worker.');
    }
  }

  // Cloudflare may expose the newly uploaded version a few seconds after
  // `wrangler deploy` exits. Remember the version that existed before the
  // upload so promotion cannot accidentally re-select an older deployment.
  const previousVersionId = await readLatestCloudflareVersionId(
    outputDir,
    workerName,
    envForWrangler
  );

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
        void reconcileCloudflareRoute(routeConfig, workerName)
          .then(() =>
            promoteLatestCloudflareVersion(outputDir, workerName, envForWrangler, previousVersionId)
          )
          .then(() => {
            logger.info('Deployment complete and latest version is serving 100% of traffic!');
            logger.info(`\nYour MCP server is live at:`);
            logger.info(
              routeConfig.publicUrl || `https://${workerName}.<your-subdomain>.workers.dev`
            );
            if (devMode) {
              logger.info(
                `\nPlayground: ${routeConfig.publicUrl || `https://${workerName}.<your-subdomain>.workers.dev`}/playground`
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
          })
          .catch((error: unknown) => {
            logger.error(
              `\nUpload succeeded, but version promotion failed: ${error instanceof Error ? error.message : String(error)}`
            );
            logger.error(`The uploaded Worker is not considered live until promotion succeeds.`);
            logger.error(`\nTo retry promotion:`);
            logger.error(`  cd ${outputDir}`);
            logger.error(`  ${detectRunner()} wrangler versions list --name ${workerName} --json`);
            logger.error(
              `  ${detectRunner()} wrangler versions deploy --name ${workerName} --version-id <version-id> --percentage 100 --yes`
            );
            reject(error instanceof Error ? error : new Error(String(error)));
          });
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
          `  ${runner} wrangler tail ${workerName}  # runtime errors (if a prior deploy exists)`
        );
        logger.error(`\nCommon causes:`);
        logger.error(`  - Auth: run \`${runner} wrangler login\` (or set CLOUDFLARE_API_TOKEN)`);
        logger.error(
          `  - Bundling: an imported package isn't in @dependencies (see warnings above)`
        );
        logger.error(
          `  - Worker name conflict: \`${workerName}\` already taken by another account`
        );
        reject(new Error('Deployment failed'));
      }
    });
  });
}

async function promoteLatestCloudflareVersion(
  outputDir: string,
  photonName: string,
  env: NodeJS.ProcessEnv,
  previousVersionId?: string
): Promise<void> {
  logger.info('Confirming the uploaded Cloudflare version is serving traffic...');
  let versionList = '';
  let lastListError: unknown;
  let lastObservedVersionId: string | undefined;
  const attempts = previousVersionId ? 10 : 3;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const result = spawnSync(
      detectRunner(),
      ['wrangler', 'versions', 'list', '--name', photonName, '--json'],
      { cwd: outputDir, encoding: 'utf-8', env }
    );
    // Wrangler has emitted the JSON payload on either stdout or stderr across
    // releases. Combine both streams before parsing and retry briefly while a
    // just-uploaded version becomes visible in the API.
    versionList = `${result.stdout || ''}\n${result.stderr || ''}`;
    try {
      let latestVersionId: string;
      try {
        latestVersionId = selectLatestCloudflareVersion(versionList);
      } catch {
        latestVersionId =
          (await fetchCloudflareWorkerVersionIds(outputDir, photonName, env))[0] || '';
      }
      if (!latestVersionId) {
        throw new Error('Cloudflare has not exposed a deployable Worker version yet.');
      }
      lastObservedVersionId = latestVersionId;
      const versionId = ensureNewCloudflareVersion(latestVersionId, previousVersionId);
      logger.info(`Promoting Worker version ${versionId} to 100%...`);
      await new Promise<void>((resolve, reject) => {
        const promotion = spawn(
          detectRunner(),
          [
            'wrangler',
            'versions',
            'deploy',
            '--name',
            photonName,
            '--version-id',
            versionId,
            '--percentage',
            '100',
            '--yes',
          ],
          { cwd: outputDir, stdio: 'inherit', env }
        );
        promotion.on('error', reject);
        promotion.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`wrangler version promotion failed with exit code ${code}`));
        });
      });
      return;
    } catch (error) {
      lastListError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  // Wrangler can complete an idempotent deploy without creating a second
  // version. That is a successful deployment: the existing version remains
  // live, and there is nothing to promote. Only fail when there was no prior
  // deployable version to keep serving.
  if (previousVersionId && lastObservedVersionId === previousVersionId) {
    logger.info('Cloudflare kept the existing Worker version; no promotion was needed.');
    return;
  }

  throw new Error(
    `could not list Worker versions: ${lastListError instanceof Error ? lastListError.message : String(lastListError)}`
  );
}

/**
 * Reconcile a legacy zone route after a Worker upload.
 *
 * Cloudflare permits a zone route and a custom-domain binding to coexist. If
 * the zone route still points at an older Worker, the new deployment appears
 * healthy in Wrangler while the public hostname serves stale code. Updating
 * the exact route to the Worker just deployed makes the deploy operation
 * converge instead of requiring a dashboard cleanup.
 */
async function reconcileCloudflareRoute(
  routeConfig: CloudflareRouteConfig,
  workerName: string
): Promise<void> {
  const target = routeConfig.reconcile;
  if (!target) return;

  const resolved = resolveCloudflareApiToken();
  if (!resolved) {
    logger.warn(
      `Could not reconcile Cloudflare route ${target.pattern}: no API token was available. ` +
        'The Worker was uploaded, but verify the hostname does not have a stale zone route.'
    );
    return;
  }

  const headers = {
    Authorization: `Bearer ${resolved.token}`,
    'Content-Type': 'application/json',
  };
  const zoneResponse = await fetch(
    `https://api.cloudflare.com/client/v4/zones?name=${encodeURIComponent(target.zoneName)}&status=active`,
    { headers }
  );
  if (!zoneResponse.ok) {
    throw new Error(`Cloudflare zone lookup failed with HTTP ${zoneResponse.status}`);
  }
  const zonePayload = (await zoneResponse.json()) as {
    success?: boolean;
    result?: Array<{ id?: string }>;
    errors?: unknown;
  };
  const zoneId = zonePayload.result?.[0]?.id;
  if (!zoneId) {
    throw new Error(
      `Cloudflare zone '${target.zoneName}' was not found while reconciling the route`
    );
  }

  const routesResponse = await fetch(
    `https://api.cloudflare.com/client/v4/zones/${zoneId}/workers/routes`,
    { headers }
  );
  if (!routesResponse.ok) {
    throw new Error(`Cloudflare route lookup failed with HTTP ${routesResponse.status}`);
  }
  const routesPayload = (await routesResponse.json()) as {
    result?: Array<{ id?: string; pattern?: string; script?: string | null }>;
  };
  const existing = routesPayload.result?.find((route) => route.pattern === target.pattern);
  if (!existing?.id || existing.script === workerName) return;

  const updateResponse = await fetch(
    `https://api.cloudflare.com/client/v4/zones/${zoneId}/workers/routes/${existing.id}`,
    {
      method: 'PUT',
      headers,
      body: JSON.stringify({ pattern: target.pattern, script: workerName }),
    }
  );
  if (!updateResponse.ok) {
    throw new Error(`Cloudflare route reconciliation failed with HTTP ${updateResponse.status}`);
  }
  logger.info(`Reconciled Cloudflare route ${target.pattern} → Worker ${workerName}`);
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

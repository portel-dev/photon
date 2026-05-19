/**
 * TSX View Compiler
 *
 * Transpiles and bundles .tsx view files into self-contained HTML documents
 * using esbuild. Ships a tiny built-in JSX runtime (~1KB) that maps directly
 * to DOM calls — no React, no Preact, no virtual DOM.
 *
 * Users can override with `@jsxImportSource` pragma or tsconfig.json in the
 * ui/ folder to use React/Preact/Solid if they prefer.
 */

import * as crypto from 'crypto';
import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// ─── Built-in JSX Runtime ──────────────────────────────────────────────────
// Tiny DOM-based JSX factory. `h()` returns real DOM nodes, not virtual nodes.
// Injected into every TSX build unless the user overrides via tsconfig.

const JSX_RUNTIME = `
export function h(type, props, ...children) {
  if (type === Fragment) {
    const frag = document.createDocumentFragment();
    _append(frag, children);
    return frag;
  }
  if (typeof type === 'function') {
    return type(Object.assign({}, props, { children: children.length <= 1 ? children[0] : children }));
  }
  const el = document.createElement(type);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (k === 'children' || v == null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') {
        el.addEventListener(k[2].toLowerCase() + k.slice(3), v);
      } else if (k === 'style' && typeof v === 'object') {
        Object.assign(el.style, v);
      } else if (k === 'className') {
        el.setAttribute('class', v);
      } else if (k === 'htmlFor') {
        el.setAttribute('for', v);
      } else if (k === 'dangerouslySetInnerHTML') {
        el.innerHTML = v.__html;
      } else if (v === true) {
        el.setAttribute(k, '');
      } else {
        el.setAttribute(k, String(v));
      }
    }
  }
  _append(el, children);
  return el;
}

export function Fragment() {}

export function _append(parent, children) {
  for (const child of children) {
    if (child == null || child === false || child === true) continue;
    if (Array.isArray(child)) { _append(parent, child); continue; }
    parent.append(typeof child === 'object' ? child : String(child));
  }
}

export function render(element, container) {
  if (typeof container === 'string') container = document.querySelector(container);
  container.replaceChildren(element);
  return element;
}
`.trim();

// Write runtime to a temp file once per process for esbuild inject
let _runtimePath: string | null = null;
function getRuntimePath(): string {
  if (!_runtimePath) {
    _runtimePath = path.join(os.tmpdir(), `photon-jsx-runtime-${process.pid}.js`);
    fs.writeFileSync(_runtimePath, JSX_RUNTIME);
  }
  return _runtimePath;
}

/**
 * Result of compiling a .tsx view.
 *
 * The bundled JS is written to a content-hashed sidecar file rather than
 * inlined, so every serving path (local server, Beam, `photon build`, the
 * Cloudflare [assets] binding) gets URL-level cache-busting for free: the
 * hash changes whenever the source or the esbuild toolchain changes, so a
 * browser never executes a stale bundle. The tiny HTML shell carries no
 * code and is served with revalidation; the hashed JS is immutable.
 */
export interface CompiledTsx {
  /** sha256 of (bundle + esbuild version), 12 hex chars. Empty on build error. */
  hash: string;
  /** Hashed JS filename the shell references, e.g. `app.1a2b3c4d5e6f.js`. */
  jsFileName: string;
  /** The HTML shell (references `./<jsFileName>`). On error this is the error page. */
  html: string;
  /** The bundled browser JS. Empty on build error. */
  js: string;
  /** On-disk cache directory holding `<jsFileName>` and `index.html`. */
  dir: string;
  /** Absolute path to the written HTML shell. */
  htmlPath: string;
  /** Absolute path to the written hashed JS (empty string on build error). */
  jsPath: string;
  /** Absolute paths of every module in the bundle (entry + imports). */
  inputs: string[];
}

// In-memory cache: filePath → { sig, result }. `sig` is the newest mtime
// across the whole input graph, so a change to any imported module — not
// just the entry file — invalidates the cache.
const cache = new Map<string, { sig: number; result: CompiledTsx }>();

/** Resolve esbuild metafile input keys to absolute paths. */
function resolveInputs(metafile: { inputs: Record<string, unknown> } | undefined): string[] {
  if (!metafile) return [];
  const out: string[] = [];
  for (const key of Object.keys(metafile.inputs)) {
    // Skip esbuild virtual/injected entries (e.g. the JSX runtime shim).
    if (key.includes('<') || key.startsWith('\0')) continue;
    out.push(path.resolve(process.cwd(), key));
  }
  return out;
}

/** Newest mtime across the input graph; -1 if any input is missing. */
function inputsSignature(inputs: string[]): number {
  let newest = 0;
  for (const f of inputs) {
    try {
      newest = Math.max(newest, fs.statSync(f).mtimeMs);
    } catch {
      return -1; // a vanished input forces a rebuild
    }
  }
  return newest;
}

/** Stable per-source cache directory under the OS temp dir. */
function cacheDirFor(filePath: string): string {
  const key = crypto.createHash('sha256').update(path.resolve(filePath)).digest('hex').slice(0, 16);
  return path.join(os.tmpdir(), 'photon-tsx-cache', key);
}

/** Content hash of the bundle, salted with the esbuild version. */
function hashBundle(js: string): string {
  return crypto
    .createHash('sha256')
    .update(`${js}:::esbuild@${esbuild.version}`)
    .digest('hex')
    .slice(0, 12);
}

/**
 * Write the shell + hashed JS to the cache dir and return the descriptor.
 * Stale `*.js` from a previous hash are pruned so the dir stays bounded
 * and a `photon build` copy never ships an orphaned old bundle.
 */
function writeArtifactsSync(filePath: string, js: string, inputs: string[]): CompiledTsx {
  const dir = cacheDirFor(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const base = path.basename(filePath, path.extname(filePath)).replace(/[^a-zA-Z0-9_-]/g, '_');
  const hash = hashBundle(js);
  const jsFileName = `${base}.${hash}.js`;
  const html = wrapInHtml(jsFileName);
  for (const entry of fs.readdirSync(dir)) {
    if (entry.endsWith('.js') && entry !== jsFileName) {
      try {
        fs.unlinkSync(path.join(dir, entry));
      } catch {
        // best-effort prune
      }
    }
  }
  const jsPath = path.join(dir, jsFileName);
  const htmlPath = path.join(dir, 'index.html');
  fs.writeFileSync(jsPath, js);
  fs.writeFileSync(htmlPath, html);
  const entryAbs = path.resolve(filePath);
  const allInputs = inputs.length ? Array.from(new Set([entryAbs, ...inputs])) : [entryAbs];
  return { hash, jsFileName, html, js, dir, htmlPath, jsPath, inputs: allInputs };
}

/** Build-error descriptor: an HTML error page, no JS sidecar. */
function errorResult(filePath: string, error: unknown): CompiledTsx {
  const dir = cacheDirFor(filePath);
  const html = wrapError(filePath, error);
  let htmlPath = '';
  try {
    fs.mkdirSync(dir, { recursive: true });
    htmlPath = path.join(dir, 'index.html');
    fs.writeFileSync(htmlPath, html);
  } catch {
    // serving paths fall back to the in-memory `html`
  }
  return {
    hash: '',
    jsFileName: '',
    html,
    js: '',
    dir,
    htmlPath,
    jsPath: '',
    inputs: [path.resolve(filePath)],
  };
}

/**
 * Find the nearest tsconfig.json walking up from startDir.
 * Stops at the photon asset folder root (parent of ui/).
 */
function findTsconfig(startDir: string): string | undefined {
  let dir = startDir;
  const root = path.dirname(dir); // stop at parent of ui/
  while (true) {
    const candidate = path.join(dir, 'tsconfig.json');
    if (fs.existsSync(candidate)) return candidate;
    if (dir === root || dir === path.dirname(dir)) break;
    dir = path.dirname(dir);
  }
  return undefined;
}

function stripJsonComments(text: string): string {
  let out = '';
  let inString = false;
  let stringQuote = '';
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (inString) {
      out += char;
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === stringQuote) {
        inString = false;
        stringQuote = '';
      }
      continue;
    }

    if (char === '"' || char === "'") {
      inString = true;
      stringQuote = char;
      out += char;
      continue;
    }

    if (char === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
      continue;
    }

    if (char === '/' && next === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i++;
      continue;
    }

    out += char;
  }

  return out;
}

function tsconfigHasJsxOverride(tsconfigPath: string): boolean {
  try {
    const text = stripJsonComments(fs.readFileSync(tsconfigPath, 'utf8'));
    const compilerOptionsMatch = text.match(/["']compilerOptions["']\s*:\s*\{([\s\S]*?)\}/);
    const compilerOptions = compilerOptionsMatch?.[1] ?? text;
    return /["'](?:jsx|jsxFactory|jsxFragmentFactory|jsxImportSource)["']\s*:/.test(
      compilerOptions
    );
  } catch {
    return false;
  }
}

/**
 * Build esbuild options for a TSX file.
 * Uses built-in DOM-based JSX runtime by default.
 * Users can override via tsconfig.json (jsx/jsxImportSource settings).
 */
function buildOptions(filePath: string, tsconfigPath?: string): esbuild.BuildOptions {
  const uiDir = path.dirname(filePath);

  const hasJsxOverride = tsconfigPath ? tsconfigHasJsxOverride(tsconfigPath) : false;

  return {
    entryPoints: [filePath],
    bundle: true,
    write: false,
    // Needed to invalidate the cache on any imported module change, not
    // just the entry file — `metafile.inputs` lists the full graph.
    metafile: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2020',
    ...(tsconfigPath ? { tsconfig: tsconfigPath } : {}),
    // Built-in runtime: classic transform with injected h/Fragment
    ...(!hasJsxOverride
      ? {
          jsx: 'transform',
          jsxFactory: 'h',
          jsxFragment: 'Fragment',
          inject: [getRuntimePath()],
        }
      : {
          // Let explicit tsconfig JSX settings control jsx mode and import source
        }),
    nodePaths: [
      path.join(uiDir, 'node_modules'),
      path.join(uiDir, '..', 'node_modules'),
      path.join(uiDir, '..', '..', 'node_modules'),
      path.join(uiDir, '..', '..', '..', 'node_modules'),
    ],
    logLevel: 'silent',
  };
}

/**
 * The HTML shell. Carries no application code — it only references the
 * content-hashed bundle as a sibling module, so the document itself is
 * tiny and safe to serve with short-lived/revalidated caching while the
 * hashed bundle is cached immutably. The reference is relative so it
 * resolves to `/api/ui/<id>/<jsFileName>` (and the equivalent CF asset
 * path) regardless of the mount point.
 */
function wrapInHtml(jsFileName: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>*, *::before, *::after { box-sizing: border-box; } body { margin: 0; font-family: system-ui, -apple-system, sans-serif; }</style>
</head>
<body>
<div id="root"></div>
<script type="module" src="./${jsFileName}"></script>
</body>
</html>`;
}

/**
 * Self-contained document with the bundle inlined. Used only by the MCP
 * resource path (Claude Desktop apps): an MCP-app webview renders the
 * returned HTML with no HTTP origin, so a `./<hash>.js` sibling reference
 * would not resolve. Cache-busting is irrelevant there — the client
 * re-reads the resource on every `resources/read`.
 */
export function inlineHtml(js: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>*, *::before, *::after { box-sizing: border-box; } body { margin: 0; font-family: system-ui, -apple-system, sans-serif; }</style>
</head>
<body>
<div id="root"></div>
<script type="module">
${js}
</script>
</body>
</html>`;
}

/** Immutable: hash in the URL changes whenever the bundle changes. */
export const TSX_JS_CACHE_CONTROL = 'public, max-age=31536000, immutable';
/** Tiny, code-free shell — always revalidate so a new hash is picked up. */
export const TSX_SHELL_CACHE_CONTROL = 'no-cache';

export interface TsxHttpResponse {
  status: 200 | 404;
  /** Response body. */
  body: string;
  headers: Record<string, string>;
}

/**
 * Resolve an HTTP request for a compiled `.tsx` view into a response.
 *
 * - `restPath` empty / `index.html` → the HTML shell (revalidated, ETag).
 * - `restPath` === the hashed JS filename → the bundle (immutable).
 * - anything else → 404 (caller may then try its own sibling resolution).
 *
 * Used by every browser-facing serving path (local server, Beam,
 * streamable-http, and — via precompiled files — the Cloudflare
 * [assets] binding) so the cache contract is identical everywhere.
 */
export function tsxHttpResponse(result: CompiledTsx, restPath: string): TsxHttpResponse {
  const rest = restPath.replace(/^\/+/, '');
  if (rest === '' || rest === 'index.html') {
    const headers: Record<string, string> = {
      'Content-Type': 'text/html',
      'Cache-Control': TSX_SHELL_CACHE_CONTROL,
    };
    // No hash on a build-error page — let it always revalidate without a tag.
    if (result.hash) headers['ETag'] = `"${result.hash}"`;
    return { status: 200, body: result.html, headers };
  }
  if (result.jsFileName && rest === result.jsFileName) {
    return {
      status: 200,
      body: result.js,
      headers: {
        'Content-Type': 'text/javascript; charset=utf-8',
        'Cache-Control': TSX_JS_CACHE_CONTROL,
      },
    };
  }
  return { status: 404, body: 'Not found', headers: {} };
}

/**
 * Detect the "esbuild binary not installed" failure shape. Fires when
 * Bun blocked esbuild's postinstall (default for non-trusted packages),
 * so the platform-specific native binary was never downloaded. The
 * message is actionable rather than mysterious.
 */
function esbuildBinaryMissingHint(message: string): string | null {
  if (
    /binary was not found|Cannot find module '@esbuild\/|prebuilt|ELIFECYCLE|postinstall/i.test(
      message
    )
  ) {
    return (
      'esbuild native binary is missing — its install script was blocked.\n' +
      '  Fix (Bun):  bun pm -g trust esbuild\n' +
      '  Fix (npm):  npm rebuild esbuild\n' +
      'This blocks .tsx view compilation and `photon build`. Other commands still work.'
    );
  }
  return null;
}

/**
 * Wrap an esbuild error in a developer-friendly HTML error page.
 */
function wrapError(filePath: string, error: unknown): string {
  const rawMessage = error instanceof Error ? error.message : String(error);
  const hint = esbuildBinaryMissingHint(rawMessage);
  const message = hint ? `${hint}\n\nOriginal error:\n${rawMessage}` : rawMessage;
  const escaped = message.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
body { margin: 0; padding: 24px; font-family: ui-monospace, monospace; background: #1a0000; color: #ff6b6b; }
h2 { margin: 0 0 16px; font-size: 14px; color: #ff4444; }
pre { white-space: pre-wrap; word-break: break-word; font-size: 13px; line-height: 1.5; }
.file { color: #888; font-size: 12px; margin-bottom: 8px; }
</style>
</head>
<body>
<h2>TSX Build Error</h2>
<div class="file">${path.basename(filePath)}</div>
<pre>${escaped}</pre>
</body>
</html>`;
}

/**
 * Compile a TSX file into a hashed JS bundle plus an HTML shell.
 */
export async function compileTsx(filePath: string): Promise<CompiledTsx> {
  const tsconfigPath = findTsconfig(path.dirname(filePath));

  try {
    const result = await esbuild.build(buildOptions(filePath, tsconfigPath));
    const js = result.outputFiles?.[0]?.text ?? '';
    return writeArtifactsSync(filePath, js, resolveInputs(result.metafile));
  } catch (err) {
    return errorResult(filePath, err);
  }
}

/**
 * Compile with dependency-graph-aware caching. Re-transpiles when the
 * entry file OR any imported module changes (the previous mtime-only
 * cache silently served a stale bundle after an imported-component edit).
 */
export async function compileTsxCached(filePath: string): Promise<CompiledTsx> {
  const cached = cache.get(filePath);
  if (cached) {
    const sig = inputsSignature(cached.result.inputs);
    if (sig !== -1 && sig === cached.sig) {
      return cached.result;
    }
  }
  const result = await compileTsx(filePath);
  cache.set(filePath, { sig: inputsSignature(result.inputs), result });
  return result;
}

/**
 * Synchronous variant for the build command (uses esbuild.buildSync).
 */
export function compileTsxSync(filePath: string): CompiledTsx {
  const tsconfigPath = findTsconfig(path.dirname(filePath));

  try {
    const result = esbuild.buildSync(buildOptions(filePath, tsconfigPath));
    const js = result.outputFiles?.[0]?.text ?? '';
    return writeArtifactsSync(filePath, js, resolveInputs(result.metafile));
  } catch (err) {
    return errorResult(filePath, err);
  }
}

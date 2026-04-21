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

import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as fsAsync from 'fs/promises';
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

// In-memory cache: filePath → { mtimeMs, html }
const cache = new Map<string, { mtimeMs: number; html: string }>();

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

/**
 * Build esbuild options for a TSX file.
 * Uses built-in DOM-based JSX runtime by default.
 * Users can override via tsconfig.json (jsx/jsxImportSource settings).
 */
function buildOptions(filePath: string, tsconfigPath?: string): esbuild.BuildOptions {
  const uiDir = path.dirname(filePath);

  // If user has a tsconfig, let it control JSX settings
  // Otherwise use our built-in runtime via inject
  const hasUserTsconfig = !!tsconfigPath;

  return {
    entryPoints: [filePath],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: 'es2020',
    // Built-in runtime: classic transform with injected h/Fragment
    ...(!hasUserTsconfig
      ? {
          jsx: 'transform',
          jsxFactory: 'h',
          jsxFragment: 'Fragment',
          inject: [getRuntimePath()],
        }
      : {
          // Let tsconfig control jsx mode and import source
          tsconfig: tsconfigPath,
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
 * Wrap bundled JS in a self-contained HTML document.
 */
function wrapInHtml(js: string): string {
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
 * Compile a TSX file into a self-contained HTML document.
 */
export async function compileTsx(filePath: string): Promise<string> {
  const tsconfigPath = findTsconfig(path.dirname(filePath));

  try {
    const result = await esbuild.build(buildOptions(filePath, tsconfigPath));
    const js = result.outputFiles?.[0]?.text ?? '';
    return wrapInHtml(js);
  } catch (err) {
    return wrapError(filePath, err);
  }
}

/**
 * Compile with mtime-based caching. Re-transpiles only when the file changes.
 */
export async function compileTsxCached(filePath: string): Promise<string> {
  const stat = await fsAsync.stat(filePath);
  const cached = cache.get(filePath);
  if (cached && cached.mtimeMs === stat.mtimeMs) {
    return cached.html;
  }
  const html = await compileTsx(filePath);
  cache.set(filePath, { mtimeMs: stat.mtimeMs, html });
  return html;
}

/**
 * Synchronous variant for the build command (uses esbuild.buildSync).
 */
export function compileTsxSync(filePath: string): string {
  const tsconfigPath = findTsconfig(path.dirname(filePath));

  try {
    const result = esbuild.buildSync(buildOptions(filePath, tsconfigPath));
    const js = result.outputFiles?.[0]?.text ?? '';
    return wrapInHtml(js);
  } catch (err) {
    return wrapError(filePath, err);
  }
}

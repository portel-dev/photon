/**
 * Format registry — single source of truth for `name ↔ MIME ↔ renderer` mappings.
 *
 * Plan reference: server-provided-what-a-reactive-globe.md → Track A.
 *
 * Today's runtime has three separate format systems:
 *   - CLI rendering in @portel/cli's cli-formatter.js
 *   - Beam HTML rendering in src/auto-ui/bridge/renderers.ts (FORMAT_CATALOG)
 *   - MCP `_metaFormatted` content shaping
 *
 * This module unifies the HTTP target. Other targets adopt incrementally —
 * the registry shape is target-pluggable via `FormatSpec.render`.
 *
 * v1.29 Track A scope: HTTP target renderers + content negotiation hooks.
 * Subsequent tracks consume the registry without redefining `FormatSpec`.
 */

export type RenderTarget = 'cli' | 'http' | 'beam' | 'mcp';

export interface RenderResult {
  /** Bytes written to the response. UTF-8 strings work; Buffer for binary. */
  body: string | Uint8Array;
  /** MIME type sent on Content-Type. Charset suffix (`; charset=utf-8`) included. */
  mime: string;
}

/**
 * A format spec. Each format declares its primary target, an optional canonical
 * MIME (used for Accept-header lookup), and per-target render functions.
 *
 * If a target has no renderer registered, the registry falls back to JSON.
 */
export interface FormatSpec {
  name: string;
  primaryTarget: RenderTarget;
  /** Canonical MIME for HTTP content negotiation. Lookup key in `lookupByMime`. */
  httpMime?: string;
  /** Tie-breaker when multiple formats share a MIME (e.g. text/html). */
  isCanonicalForMime?: boolean;
  /** Per-target renderers. Missing entries fall back to JSON. */
  render: Partial<Record<RenderTarget, (value: unknown) => RenderResult>>;
  /** Explicit fallback contract — JSON is always available. */
  fallback: 'json';
}

export class FormatRegistry {
  private byName = new Map<string, FormatSpec>();
  private byMime = new Map<string, FormatSpec>();

  register(spec: FormatSpec): void {
    this.byName.set(spec.name, spec);
    if (spec.httpMime) {
      const existing = this.byMime.get(spec.httpMime);
      if (!existing || spec.isCanonicalForMime) {
        this.byMime.set(spec.httpMime, spec);
      }
    }
  }

  get(name: string): FormatSpec | undefined {
    return this.byName.get(name);
  }

  /** Return the canonical FormatSpec for an exact MIME, or undefined. */
  lookupByMime(mime: string): FormatSpec | undefined {
    return this.byMime.get(mime.toLowerCase());
  }

  list(): FormatSpec[] {
    return Array.from(this.byName.values());
  }
}

/**
 * Parse an Accept header into an ordered list of (mime, q) preferences.
 * Highest q first; ties keep input order.
 */
export function parseAccept(header: string | null | undefined): Array<{ mime: string; q: number }> {
  if (!header) return [{ mime: '*/*', q: 1 }];
  const parts = header
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const entries = parts.map((part, idx) => {
    const [rawMime, ...params] = part.split(';').map((s) => s.trim());
    let q = 1;
    for (const p of params) {
      const m = p.match(/^q\s*=\s*(-?[\d.]+)$/i);
      if (m) q = Math.max(0, Math.min(1, parseFloat(m[1])));
    }
    return { mime: rawMime.toLowerCase(), q, idx };
  });
  entries.sort((a, b) => b.q - a.q || a.idx - b.idx);
  return entries.map(({ mime, q }) => ({ mime, q }));
}

/** Does the offered concrete MIME satisfy the requested (possibly wildcarded) MIME? */
function mimeMatches(requested: string, offered: string): boolean {
  if (requested === '*/*' || requested === offered) return true;
  if (requested.endsWith('/*')) {
    const prefix = requested.slice(0, -1); // "text/"
    return offered.startsWith(prefix);
  }
  return false;
}

export interface NegotiateOptions {
  /** Accept header from request. */
  accept: string | null | undefined;
  /** Declared @format on the handler (e.g. 'table', 'json'). May be undefined. */
  declaredFormat?: string;
  /** The handler's return value. */
  value: unknown;
  /** Registry to consult. */
  registry: FormatRegistry;
}

/**
 * Negotiate a representation for `value` given the request's Accept header
 * and the handler's declared `@format`. Always succeeds — falls back to JSON
 * when no declared format / requested MIME / renderer combination produces output.
 *
 * Algorithm:
 *   1. Parse Accept into ordered (mime, q) preferences.
 *   2. For each preference, try (in order): the declared format's MIME match,
 *      then the registry's MIME lookup. The first that produces a non-error
 *      RenderResult wins.
 *   3. If nothing matched, render JSON.
 */
export function negotiateAccept(opts: NegotiateOptions): RenderResult {
  const { accept, declaredFormat, value, registry } = opts;
  const preferences = parseAccept(accept);

  const declared = declaredFormat ? registry.get(declaredFormat) : undefined;

  for (const pref of preferences) {
    if (declared && declared.httpMime && mimeMatches(pref.mime, declared.httpMime)) {
      const out = tryRender(declared, value);
      if (out) return out;
    }

    if (pref.mime === '*/*' || pref.mime.endsWith('/*')) {
      // Wildcard: prefer declared format, otherwise any spec whose MIME matches.
      if (declared) {
        const out = tryRender(declared, value);
        if (out) return out;
      }
      for (const spec of registry.list()) {
        if (spec.httpMime && mimeMatches(pref.mime, spec.httpMime)) {
          const out = tryRender(spec, value);
          if (out) return out;
        }
      }
    } else {
      const spec = registry.lookupByMime(pref.mime);
      if (spec) {
        const out = tryRender(spec, value);
        if (out) return out;
      }
    }
  }

  return renderJsonFallback(value);
}

function tryRender(spec: FormatSpec, value: unknown): RenderResult | undefined {
  const fn = spec.render.http;
  if (!fn) return undefined;
  try {
    return fn(value);
  } catch {
    return undefined;
  }
}

export function renderJsonFallback(value: unknown): RenderResult {
  return {
    body: JSON.stringify(value, null, 2),
    mime: 'application/json; charset=utf-8',
  };
}

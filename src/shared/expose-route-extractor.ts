/**
 * Source-level extractor for `@expose` declarations.
 *
 * v1.29 Track C. Methods tagged `@expose` are auto-bound to a kebab-cased
 * `/api/<method>` POST endpoint so a same-origin SPA can call them via
 * fetch without writing per-method `@post` directives. `@expose public`
 * widens this from "SameSite-cookie required" to "any caller" — useful
 * for anonymous public surfaces (iCal feeds, billing portals, etc.).
 *
 * Like `http-route-extractor.ts`, this runs against raw source so the
 * extractor doesn't depend on whatever shape the published photon-core
 * SchemaExtractor returns. Both the runtime dispatcher and the Cloudflare
 * deploy code-gen consume the same output.
 *
 *   /‍** @expose *‍/        async getCurrentUser() { ... }   → private
 *   /‍** @expose public *‍/ async billing()        { ... }   → public
 *   (no @expose tag)         async listUsers()    { ... }   → MCP-only
 */

export type ExposeVisibility = 'private' | 'public';

export interface ExposeDef {
  /** Method on the photon class. */
  handler: string;
  /** SameSite cookie required (`private`) or anonymous OK (`public`). */
  visibility: ExposeVisibility;
}

const JSDOC_BLOCK_RE = /\/\*\*([\s\S]*?)\*\//g;
const METHOD_RE = /^\s*(?:public\s+|private\s+|protected\s+)?(?:async\s+)?(\w+)\s*\(/;
// Anchor `@expose` to a JSDoc tag position — either the very start of the
// block body (single-line `/** @expose */`) or a JSDoc line that begins
// with `*`. Prevents prose mentions like `No @expose — MCP-only` from
// tripping the matcher. The visibility capture excludes `*` so it stops
// at the JSDoc terminator on single-line blocks.
const EXPOSE_TAG_RE = /(?:^\s*|\n\s*\*\s*)@expose\b(?:[ \t]+([^\s*]+))?/im;

export function extractExposesFromSource(source: string): ExposeDef[] {
  const exposes: ExposeDef[] = [];
  JSDOC_BLOCK_RE.lastIndex = 0;
  let block: RegExpExecArray | null;
  while ((block = JSDOC_BLOCK_RE.exec(source)) !== null) {
    const jsdocBody = block[1];
    const exposeMatch = jsdocBody.match(EXPOSE_TAG_RE);
    if (!exposeMatch) continue;
    const after = source.slice(block.index + block[0].length);
    const methodMatch = after.match(METHOD_RE);
    if (!methodMatch) continue;
    // The argument after @expose, if present, is one of: 'public' (widens
    // exposure to anonymous callers) or anything else (treated as no
    // visibility hint — defaults to private). This is intentionally loose:
    // adding new visibility levels later doesn't break existing callers
    // that already wrote `@expose public`.
    const visibility: ExposeVisibility =
      exposeMatch[1]?.trim().toLowerCase() === 'public' ? 'public' : 'private';
    exposes.push({ handler: methodMatch[1], visibility });
  }
  return exposes;
}

/**
 * Convert a method name to its kebab-cased route segment. Matches the
 * convention the bridge fetch fallback uses (`fetch('/api/<kebab>', ...)`).
 *
 *   getCurrentUser → get-current-user
 *   listUsers      → list-users
 *   billing        → billing
 */
export function methodToKebab(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
}

/**
 * Source-level extractor for HTTP route declarations.
 *
 * Both the runtime loader and the Cloudflare deploy code-gen need to know
 * which class methods are bound to HTTP routes. The photon-core
 * `SchemaExtractor` does not return route metadata in every published
 * version, so callers MUST NOT rely on it: this regex-based extractor
 * runs against the raw source and always produces a stable shape.
 *
 * Why a separate module: prior to v1.28.1 the regex lived inside the
 * loader as a private method, so the deploy path silently fell back to
 * `metadata.httpRoutes ?? []` from photon-core. With photon-core 2.25.0,
 * that field is always undefined — every Cloudflare deploy with HTTP route
 * routes (other than `@get /`) shipped an empty subclass route table and
 * 404'd in production. See tests/cf-deploy-codegen.test.ts.
 */
export interface HttpRouteDef {
  method: string;
  path: string;
  handler: string;
  /**
   * Optional `@format <name>` declared on the same JSDoc block. Used by the
   * HTTP dispatcher's content-negotiation path (Track A) when the handler
   * returns a plain value rather than a Response.
   */
  format?: string;
}

// Find each JSDoc close `*/` and the method declaration that follows.
// Crucially we use the JSDoc body BETWEEN the opener and THIS specific close —
// not greedy back to a far-earlier `/**`. That keeps tag scans (@format, ...)
// scoped to the SAME block as the route directive, rather than leaking from
// a class-level docblock that happens to mention `@format` in prose.
const JSDOC_BLOCK_RE = /\/\*\*([\s\S]*?)\*\//g;
const METHOD_RE = /^\s*(?:public\s+|private\s+|protected\s+)?(?:async\s+)?(\w+)\s*\(/;
const ROUTE_TAG_RE = /@(get|post|put|patch|delete)\s+(\/[^\s*]*)/i;
const FORMAT_RE = /@format\s+([\w:-]+)/i;

export function extractHttpRoutesFromSource(source: string): HttpRouteDef[] {
  const routes: HttpRouteDef[] = [];
  JSDOC_BLOCK_RE.lastIndex = 0;
  let block: RegExpExecArray | null;
  while ((block = JSDOC_BLOCK_RE.exec(source)) !== null) {
    const jsdocBody = block[1];
    const routeMatch = jsdocBody.match(ROUTE_TAG_RE);
    if (!routeMatch) continue;
    const after = source.slice(block.index + block[0].length);
    const methodMatch = after.match(METHOD_RE);
    if (!methodMatch) continue;
    const route: HttpRouteDef = {
      method: routeMatch[1].toUpperCase(),
      path: routeMatch[2],
      handler: methodMatch[1],
    };
    const formatMatch = jsdocBody.match(FORMAT_RE);
    if (formatMatch) route.format = formatMatch[1];
    routes.push(route);
  }
  return routes;
}

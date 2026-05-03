/**
 * Source-level extractor for `@get` and `@post` HTTP route declarations.
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
 * that field is always undefined — every Cloudflare deploy with @get/@post
 * routes (other than `@get /`) shipped an empty subclass route table and
 * 404'd in production. See tests/cf-deploy-codegen.test.ts.
 */
export interface HttpRouteDef {
  method: string;
  path: string;
  handler: string;
}

const ROUTE_RE = /\/\*\*[\s\S]*?@(get|post)\s+(\/[^\s*]*)[\s\S]*?\*\/\s*(?:async\s+)?(\w+)\s*\(/gi;

export function extractHttpRoutesFromSource(source: string): HttpRouteDef[] {
  const routes: HttpRouteDef[] = [];
  ROUTE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ROUTE_RE.exec(source)) !== null) {
    routes.push({ method: m[1].toUpperCase(), path: m[2], handler: m[3] });
  }
  return routes;
}

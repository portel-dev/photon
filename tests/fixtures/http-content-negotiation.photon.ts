/**
 * HTTP content negotiation fixture (v1.29 Track A).
 *
 * Single @get handler that returns a tabular plain value (not a Response).
 * The runtime should negotiate Accept against the declared @format and
 * registered renderers. This fixture exercises:
 *
 *   - Accept: text/html -> HTML table
 *   - Accept: application/json -> JSON
 *   - Accept: text/csv -> CSV
 *   - Accept wildcard with @format table -> HTML (table's primary HTTP MIME)
 *   - Accept: text/csv on a value the format can't render -> JSON fallback
 */
export default class ContentNegotiation {
  /**
   * List users — returns plain value; runtime negotiates representation.
   * @get /users
   * @format table
   */
  async users(_request: Request) {
    return [
      { name: 'Alice', role: 'Eng' },
      { name: 'Bob', role: 'PM' },
    ];
  }

  /**
   * A handler that returns a non-tabular object — exercises CSV fallback.
   * Path is /health (not /status) because /status collides with the runtime's
   * embedded-assets diagnostic route in some build modes.
   * @get /health
   * @format json
   */
  async health(_request: Request) {
    return { ok: true, version: '1.29-test' };
  }

  /**
   * Pass-through handler that returns a Response — must NOT be touched by
   * the negotiation path. Locked by tests/v128-byte-compat.test.ts; this
   * exists here so the negotiation test fixture also covers the contract.
   * @get /raw
   */
  async raw(_request: Request): Promise<Response> {
    return new Response('raw bytes', {
      status: 200,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }
}

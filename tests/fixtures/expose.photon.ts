/**
 * @expose / auto-RPC fixture (v1.29 Track C).
 *
 * Covers the full matrix the dispatcher must respect:
 *   - @expose                         → POST /api/<kebab>; same-origin only
 *   - @expose public                  → POST /api/<kebab>; anonymous OK
 *   - @get + @expose public           → @get path takes precedence
 *   - no @expose                      → MCP-only, no /api/<kebab> route
 *   - @expose + Response return value → bytes pass through unchanged
 */
export default class ExposeFixture {
  /**
   * Private @expose — same-origin SPA only.
   * @expose
   */
  async getCurrentUser(_request: Request) {
    return { user: 'me', private: true };
  }

  /**
   * Public @expose — any caller may invoke.
   * @expose public
   */
  async billing(_request: Request) {
    return { plan: 'enterprise' };
  }

  /**
   * Explicit @get wins over the default /api/<kebab> mapping.
   * @get /calendar.ics
   * @expose public
   */
  async calendar(_request: Request): Promise<Response> {
    return new Response('BEGIN:VCALENDAR\nEND:VCALENDAR\n', {
      status: 200,
      headers: { 'content-type': 'text/calendar; charset=utf-8' },
    });
  }

  /**
   * No @expose — MCP-only. Hitting /api/list-secrets must 404.
   */
  async listSecrets() {
    return ['secret-1', 'secret-2'];
  }

  /**
   * @expose handler returning a Response — bytes must pass through.
   * @expose public
   */
  async rawDownload(_request: Request): Promise<Response> {
    return new Response('raw-payload', {
      status: 200,
      headers: { 'content-type': 'application/octet-stream' },
    });
  }
}

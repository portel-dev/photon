/**
 * v128-compat — backward-compat regression fixture.
 *
 * Locks the v1.28 default-path surface so tracks landing in v1.29 don't
 * silently shift behaviour for photons that haven't opted into any new
 * feature. Covers:
 *
 *   - plain MCP tool method (deterministic output)
 *   - @prompt method
 *   - @resource method
 *   - @get HTTP route returning Response (handler bytes pass through)
 *   - @post HTTP route returning Response
 *   - @ui directive (HTML asset; standalone served without COOP/COEP unless opted in)
 *
 * Do NOT add @expose, @audience changes, or any future opt-in tag here.
 * The point of this fixture is "no new tags, default path stays byte-stable".
 *
 * @ui form ./ui/form.html
 */
export default class V128Compat {
  /**
   * Count words in text.
   * @param text Text to count words in
   */
  async wordCount(params: { text: string }): Promise<string> {
    const words = params.text
      .trim()
      .split(/\s+/)
      .filter((w) => w.length > 0);
    return `Word count: ${words.length}`;
  }

  /**
   * @prompt
   * Code review prompt.
   * @param language Programming language
   * @param code Code to review
   */
  async codeReview(params: { language: string; code: string }) {
    return {
      role: 'user' as const,
      content: {
        type: 'text' as const,
        text: `Please review this ${params.language} code:\n\n${params.code}`,
      },
    };
  }

  /**
   * @resource api://docs
   * API documentation.
   * @mimeType text/markdown
   */
  async apiDocs(_params: Record<string, never>) {
    return {
      mimeType: 'text/markdown' as const,
      text: '# API Documentation\n\nThis is the API docs.',
    };
  }

  /**
   * Static GET endpoint — handler returns a Response, bytes pass through unmodified.
   * @get /hello
   */
  async hello(_request: Request): Promise<Response> {
    return new Response('hello world', {
      status: 200,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  /**
   * Static POST endpoint — echoes the request body.
   * @post /echo
   */
  async echo(request: Request): Promise<Response> {
    const body = await request.text();
    return new Response(body, {
      status: 200,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }
}

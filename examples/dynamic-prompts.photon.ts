/**
 * Dynamic Prompts
 *
 * Demonstrates method-level `@prompt` — each tagged method becomes
 * an MCP prompt template the host renders in its slash menu. The
 * method receives the user-supplied arguments, returns either a
 * plain string or a `{ messages: [...] }` envelope.
 *
 * Try it from Claude Desktop:
 *   /summarize  → prompts the user for `text` then dispatches
 *   /commit     → prompts for `changes` then dispatches
 */
export default class DynamicPrompts {
  /**
   * Summarize a block of text in three bullet points.
   * @prompt
   * @param text Text to summarize
   */
  async summarize(params: { text: string }) {
    return {
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text:
              `Summarize the following in three bullet points. Each bullet ` +
              `should be self-contained and skimmable.\n\n${params.text}`,
          },
        },
      ],
    };
  }

  /**
   * Generate a conventional-commits message from a changelog snippet.
   * @prompt
   * @param changes One-line description of what changed
   * @param scope Optional scope (e.g. 'auth', 'api')
   */
  async commit(params: { changes: string; scope?: string }) {
    const scope = params.scope ? `(${params.scope})` : '';
    return (
      `Write a conventional-commits message for these changes. Use ` +
      `\`type${scope}: subject\` form. Keep the subject under 72 chars.\n\n` +
      `Changes: ${params.changes}`
    );
  }
}

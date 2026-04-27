/**
 * Smoke fixture for CF this.sample on the Durable Object SSE channel.
 * Exercises a server-initiated sampling/createMessage round-trip.
 *
 * @version 0.0.1
 * @icon 🧠
 */
export default class CfSampler {
  /**
   * Ask the calling client's LLM to summarize text in one sentence.
   * @param text - The text to summarize
   */
  async summarize(text: string): Promise<{ summary: string }> {
    const summary = (await (this as any).sample({
      prompt: `Summarize this in one sentence:\n\n${text}`,
      maxTokens: 64,
    })) as string;
    return { summary };
  }

  /**
   * Ask the user to confirm and report the answer.
   */
  async ask(): Promise<{ confirmed: boolean }> {
    const confirmed = (await (this as any).confirm('Proceed?')) as boolean;
    return { confirmed };
  }
}

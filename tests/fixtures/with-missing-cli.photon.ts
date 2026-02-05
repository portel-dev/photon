/**
 * CLI dependency test — references a tool that does not exist
 * @cli nonexistent-tool-xyz-99 - https://example.com/install
 */
export default class WithMissingCli {
  /**
   * Test tool
   * @param input Input value
   */
  async greet({ input }: { input: string }): Promise<{ result: string }> {
    return { result: `Hello, ${input}` };
  }
}

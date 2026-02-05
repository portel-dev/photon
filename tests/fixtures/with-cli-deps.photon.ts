/**
 * CLI dependency test photon
 * @cli node - https://nodejs.org
 * @cli git - https://git-scm.com/downloads
 */
export default class WithCliDeps {
  /**
   * Test tool
   * @param input Input value
   */
  async greet({ input }: { input: string }): Promise<{ result: string }> {
    return { result: `Hello, ${input}` };
  }
}

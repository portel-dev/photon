/**
 * Cross-call sibling for cf-greeter. Wraps a string in decorative brackets.
 *
 * @version 0.0.1
 * @icon ✨
 */
export default class CfFormatter {
  /**
   * Decorate a string for greeting display.
   *
   * @param text - The text to wrap
   */
  async decorate(text: string): Promise<{ decorated: string }> {
    return { decorated: `✦ ${text} ✦` };
  }
}

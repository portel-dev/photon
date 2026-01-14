/**
 * Calculator Photon - Test fixture for template engine
 *
 * This photon uses a custom UI template for testing the template binding system.
 * @ui calculator ./calculator.template.html
 */

export default class Calculator {
  private display: string = '0';

  /**
   * Press a digit button
   */
  async pressDigit(params: { digit: string }): Promise<string> {
    if (this.display === '0') {
      this.display = params.digit;
    } else {
      this.display += params.digit;
    }
    return this.display;
  }

  /**
   * Clear the display
   */
  async clear(): Promise<string> {
    this.display = '0';
    return this.display;
  }

  /**
   * Calculate the result
   */
  async calculate(): Promise<string> {
    try {
      // Simple eval for testing (in production, use proper parsing)
      const result = String(eval(this.display));
      this.display = result;
      return result;
    } catch {
      return 'Error';
    }
  }

  /**
   * Get current display value
   */
  async getDisplay(): Promise<string> {
    return this.display;
  }
}

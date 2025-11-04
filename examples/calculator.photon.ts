/**
 * Calculator Photon MCP - Basic arithmetic operations
 *
 * Demonstrates the Photon pattern:
 * - Class name "Calculator" → MCP name "calculator"
 * - Public methods → Tools
 * - JSDoc → Tool descriptions
 * - TypeScript types → Schemas
 *
 * Run with: npx photon calculator.photon.ts --dev
 *
 * @version 1.0.0
 * @author Portel
 * @license MIT
 */

export default class Calculator {
  /**
   * Add two numbers together
   * @param a First number to add
   * @param b Second number to add
   */
  async add(params: { a: number; b: number }) {
    return {
      result: params.a + params.b,
      operation: 'addition',
    };
  }

  /**
   * Subtract second number from first number
   * @param a Number to subtract from
   * @param b Number to subtract
   */
  async subtract(params: { a: number; b: number }) {
    return {
      result: params.a - params.b,
      operation: 'subtraction',
    };
  }

  /**
   * Multiply two numbers
   * @param a First number
   * @param b Second number
   */
  async multiply(params: { a: number; b: number }) {
    return {
      result: params.a * params.b,
      operation: 'multiplication',
    };
  }

  /**
   * Divide first number by second number
   * @param a Dividend
   * @param b Divisor (must not be zero)
   */
  async divide(params: { a: number; b: number }) {
    if (params.b === 0) {
      throw new Error('Division by zero is not allowed');
    }

    return {
      result: params.a / params.b,
      operation: 'division',
    };
  }

  /**
   * Calculate power of a number
   * @param base The base number
   * @param exponent The exponent
   */
  async power(params: { base: number; exponent: number }) {
    return {
      result: Math.pow(params.base, params.exponent),
      operation: 'exponentiation',
    };
  }
}

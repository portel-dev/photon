/**
 * Math Photon MCP - Advanced math expression evaluator
 *
 * Exposes a single, robust `calculate` method for AI/agent use.
 * Supports arithmetic, power, sqrt, log, trig, min, max, sum, mean, median, std, abs, floor, ceil, round, random, and constants (PI, E).
 *
 * Example: calculate({ expression: "mean([1,2,3,4]) + max(5, 10) - abs(-7)" })
 *
 * Run with: npx @portel/photon math --dev
 * 
 * or install globally with: 
 * 
 * npm install -g @portel/photon
 * 
 * photon math --dev
 *
 * @version 1.0.0
 * @author Portel
 * @license MIT
 */

export default class Math {
  /**
   * Calculate a math expression string.
   * Supports +, -, *, /, ^, parentheses, sqrt, log, sin, cos, tan, pow, min, max, sum, mean, median, std, abs, floor, ceil, round, random, PI, E.
   * Example: { expression: "mean([1,2,3,4]) + max(5, 10) - abs(-7)" }
   * @param expression The math expression to calculate
   */
  async calculate(params: { expression: string }) {
    // Helper functions for advanced math
    function sum(arr: number[]): number {
      return arr.reduce((a, b) => a + b, 0);
    }
    function mean(arr: number[]): number {
      return sum(arr) / arr.length;
    }
    function median(arr: number[]): number {
      const sorted = [...arr].sort((a, b) => a - b);
  const mid = globalThis.Math.floor(sorted.length / 2);
      return sorted.length % 2 !== 0
        ? sorted[mid]
        : (sorted[mid - 1] + sorted[mid]) / 2;
    }
    function std(arr: number[]): number {
      const m = mean(arr);
  return globalThis.Math.sqrt(mean(arr.map(x => (x - m) ** 2)));
    }
    // Allowed functions/constants for expressions
    const allowed = {
      sqrt: globalThis.Math.sqrt,
      log: globalThis.Math.log,
      sin: globalThis.Math.sin,
      cos: globalThis.Math.cos,
      tan: globalThis.Math.tan,
      pow: globalThis.Math.pow,
      min: globalThis.Math.min,
      max: globalThis.Math.max,
      abs: globalThis.Math.abs,
      floor: globalThis.Math.floor,
      ceil: globalThis.Math.ceil,
      round: globalThis.Math.round,
      random: globalThis.Math.random,
      sum,
      mean,
      median,
      std,
      PI: globalThis.Math.PI,
      E: globalThis.Math.E,
    };
    try {
      // Replace ^ with ** for exponentiation
      const expr = params.expression.replace(/\^/g, '**');
      // eslint-disable-next-line no-new-func
      const fn = new Function(...Object.keys(allowed), `return (${expr})`);
      const result = fn(...Object.values(allowed));
      if (typeof result !== 'number' || !isFinite(result)) {
        throw new Error('Invalid calculation result');
      }
      return { result, operation: 'calculate', expression: params.expression };
    } catch (e) {
      throw new Error('Failed to calculate expression: ' + (e as Error).message);
    }
  }
}

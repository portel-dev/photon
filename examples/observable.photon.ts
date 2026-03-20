/**
 * Observable Computation Service
 *
 * Demonstrates OpenTelemetry GenAI instrumentation.
 * When @opentelemetry/api is installed, all tool calls produce
 * gen_ai.tool.call spans with standardized attributes.
 * Without the package, everything works with zero overhead.
 *
 * @version 1.0.0
 * @runtime ^1.9.0
 */

import { startToolSpan, isTracingEnabled, waitForOtelProbe } from '../src/telemetry/otel.js';

export default class Observable {
  /**
   * Compute a math expression with OTel tracing
   *
   * Creates a gen_ai.tool.call span wrapping the computation.
   * The span includes attributes for tool name, agent name,
   * and operation name following CNCF GenAI conventions.
   *
   * @param expression Math expression to evaluate (e.g., "2 + 2")
   */
  async compute(params: { expression: string }) {
    const span = startToolSpan('observable', 'compute', params);

    try {
      // Simple safe math evaluation (no eval)
      const result = this.safeMath(params.expression);
      span.setAttribute('compute.result', result);
      span.setStatus('OK');

      return {
        expression: params.expression,
        result,
        traced: isTracingEnabled(),
      };
    } catch (err: any) {
      span.setStatus('ERROR', err.message);
      return {
        expression: params.expression,
        error: err.message,
        traced: isTracingEnabled(),
      };
    } finally {
      span.end();
    }
  }

  /**
   * Check tracing status
   *
   * Returns whether OpenTelemetry is available and active.
   * Useful for diagnostics and health checks.
   */
  async check() {
    await waitForOtelProbe();
    return {
      tracingEnabled: isTracingEnabled(),
      message: isTracingEnabled()
        ? 'OpenTelemetry tracing is active — spans are being collected'
        : 'OpenTelemetry not installed — using no-op spans (zero overhead)',
    };
  }

  private safeMath(expr: string): number {
    // Support basic arithmetic: +, -, *, /
    const cleaned = expr.replace(/[^0-9+\-*/.()\s]/g, '');
    if (!cleaned || cleaned !== expr.replace(/\s+/g, '').replace(/[^0-9+\-*/().]/g, '')) {
      throw new Error(`Invalid expression: "${expr}"`);
    }

    // Use Function constructor for safe arithmetic only
    const fn = new Function(`return (${cleaned})`);
    const result = fn();

    if (typeof result !== 'number' || !isFinite(result)) {
      throw new Error(`Expression did not produce a finite number: "${expr}"`);
    }

    return result;
  }
}

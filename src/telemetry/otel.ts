/**
 * OpenTelemetry GenAI Semantic Conventions for Photon
 *
 * Provides tracing spans following CNCF GenAI semantic conventions.
 * Zero required dependencies — dynamically imports @opentelemetry/api
 * and falls back to no-op spans when the SDK is not installed.
 */

export interface PhotonSpan {
  setAttribute(key: string, value: string | number | boolean): void;
  addEvent(name: string, attributes?: Record<string, string | number | boolean>): void;
  setStatus(code: 'OK' | 'ERROR', message?: string): void;
  recordException(error: unknown): void;
  end(): void;
}

const noopSpan: PhotonSpan = {
  setAttribute() {},
  addEvent() {},
  setStatus() {},
  recordException() {},
  end() {},
};

// Cached reference to the OTel API (undefined = not yet checked, null = not available)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let otelApi: any;

async function getOtelApi(): Promise<unknown> {
  if (otelApi !== undefined) return otelApi;
  try {
    // Use variable to prevent TypeScript from resolving the module at compile time
    const moduleName = '@opentelemetry/api';
    otelApi = await import(/* webpackIgnore: true */ moduleName);
    return otelApi;
  } catch {
    otelApi = null;
    return null;
  }
}

// Eagerly attempt to load on module init (non-blocking)
const otelReady = getOtelApi();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getTracerSync(): any {
  if (!otelApi) return null;
  try {
    const tracer = otelApi.trace.getTracer('photon', '1.0.0');
    return tracer;
  } catch {
    return null;
  }
}

function wrapOtelSpan(otelSpan: any, otelApi: any): PhotonSpan {
  return {
    setAttribute(key: string, value: string | number | boolean) {
      otelSpan.setAttribute(key, value);
    },
    addEvent(name: string, attributes?: Record<string, string | number | boolean>) {
      otelSpan.addEvent(name, attributes);
    },
    setStatus(code: 'OK' | 'ERROR', message?: string) {
      const statusCode = code === 'OK' ? otelApi.SpanStatusCode.OK : otelApi.SpanStatusCode.ERROR;
      otelSpan.setStatus({ code: statusCode, message });
      // Force-sample failed spans even under head-based sampling
      if (code === 'ERROR') {
        try {
          otelSpan.setAttribute('sampling.priority', 1);
        } catch {
          /* best-effort */
        }
      }
    },
    recordException(error: unknown) {
      try {
        if (error instanceof Error) {
          otelSpan.recordException(error);
        } else {
          otelSpan.recordException(new Error(String(error)));
        }
      } catch {
        /* best-effort */
      }
    },
    end() {
      otelSpan.end();
    },
  };
}

/**
 * Start a span for tool execution following GenAI semantic conventions.
 * @param traceId - Optional W3C-compatible trace ID (32 hex chars) for async executions.
 *   When provided, set as `photon.trace_id` on the span so async executions are
 *   correlated with the execution ID returned to the caller.
 */
export function startToolSpan(
  photon: string,
  tool: string,
  params?: Record<string, unknown>,
  traceId?: string,
  stateful?: boolean
): PhotonSpan {
  const tracer = getTracerSync();
  if (!tracer) return noopSpan;

  const span = tracer.startSpan(`gen_ai.tool.call ${photon}.${tool}`);
  span.setAttribute('gen_ai.tool.name', tool);
  span.setAttribute('gen_ai.agent.name', photon);
  span.setAttribute('gen_ai.operation.name', 'execute_tool');

  if (traceId) {
    span.setAttribute('photon.trace_id', traceId);
  }
  if (typeof stateful === 'boolean') {
    span.setAttribute('photon.stateful', stateful);
  }

  if (params) {
    const paramKeys = Object.keys(params);
    if (paramKeys.length > 0) {
      span.addEvent('gen_ai.tool.params', {
        'gen_ai.tool.param_count': paramKeys.length,
      });
    }
  }

  return wrapOtelSpan(span, otelApi);
}

/**
 * Start a span for agent-level invocation following GenAI semantic conventions.
 */
export function startAgentSpan(photon: string, description?: string): PhotonSpan {
  const tracer = getTracerSync();
  if (!tracer) return noopSpan;

  const span = tracer.startSpan(`gen_ai.agent.invoke ${photon}`);
  span.setAttribute('gen_ai.agent.name', photon);
  span.setAttribute('gen_ai.operation.name', 'invoke_agent');

  if (description) {
    span.setAttribute('gen_ai.agent.description', description);
  }

  return wrapOtelSpan(span, otelApi);
}

/**
 * Returns true if OpenTelemetry tracing is available and configured.
 */
export function isTracingEnabled(): boolean {
  return otelApi != null;
}

/**
 * Wait for the initial OTel API probe to complete.
 * Useful in tests to ensure the cached state is resolved.
 */
export async function waitForOtelProbe(): Promise<void> {
  await otelReady;
}

/**
 * Reset the cached OTel API reference. For testing only.
 */
export function _resetOtelCache(): void {
  otelApi = undefined;
}

/**
 * OpenTelemetry GenAI Metrics for Photon
 *
 * Zero-dependency metrics wrappers that no-op when @opentelemetry/api is not
 * installed. Mirrors the pattern in otel.ts for traces.
 *
 * Metric names follow OTel GenAI semantic conventions where applicable and
 * `photon.*` for runtime-specific instruments.
 */

export interface PhotonCounter {
  add(value: number, attributes?: Record<string, string | number | boolean>): void;
}

export interface PhotonHistogram {
  record(value: number, attributes?: Record<string, string | number | boolean>): void;
}

const noopCounter: PhotonCounter = { add() {} };
const noopHistogram: PhotonHistogram = { record() {} };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let otelApi: any;

async function loadOtelApi(): Promise<unknown> {
  if (otelApi !== undefined) return otelApi;
  try {
    const moduleName = '@opentelemetry/api';
    otelApi = await import(/* webpackIgnore: true */ moduleName);
    return otelApi;
  } catch {
    otelApi = null;
    return null;
  }
}

const metricsReady = loadOtelApi();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getMeterSync(): any {
  if (!otelApi) return null;
  try {
    return otelApi.metrics?.getMeter?.('photon', '1.0.0') ?? null;
  } catch {
    return null;
  }
}

// Cache instruments — creating them is cheap but caching makes hot paths snappier.
const counterCache = new Map<string, PhotonCounter>();
const histogramCache = new Map<string, PhotonHistogram>();

function wrapCounter(otelCounter: any): PhotonCounter {
  return {
    add(value: number, attributes?: Record<string, string | number | boolean>) {
      try {
        otelCounter.add(value, attributes);
      } catch {
        /* best-effort */
      }
    },
  };
}

function wrapHistogram(otelHistogram: any): PhotonHistogram {
  return {
    record(value: number, attributes?: Record<string, string | number | boolean>) {
      try {
        otelHistogram.record(value, attributes);
      } catch {
        /* best-effort */
      }
    },
  };
}

function getCounter(name: string, description: string, unit?: string): PhotonCounter {
  const cached = counterCache.get(name);
  if (cached) return cached;
  const meter = getMeterSync();
  if (!meter) return noopCounter;
  try {
    const counter = meter.createCounter(name, { description, unit });
    const wrapped = wrapCounter(counter);
    counterCache.set(name, wrapped);
    return wrapped;
  } catch {
    return noopCounter;
  }
}

function getHistogram(name: string, description: string, unit?: string): PhotonHistogram {
  const cached = histogramCache.get(name);
  if (cached) return cached;
  const meter = getMeterSync();
  if (!meter) return noopHistogram;
  try {
    const histogram = meter.createHistogram(name, { description, unit });
    const wrapped = wrapHistogram(histogram);
    histogramCache.set(name, wrapped);
    return wrapped;
  } catch {
    return noopHistogram;
  }
}

/**
 * Record a tool-call completion. Emits to both a latency histogram and a call
 * counter so operators can derive rate, error rate, and p95/p99 from one pair.
 */
export function recordToolCall(params: {
  photon: string;
  tool: string;
  durationMs: number;
  status: 'ok' | 'error';
  errorType?: string;
  stateful?: boolean;
}): void {
  const attrs: Record<string, string | number | boolean> = {
    'gen_ai.agent.name': params.photon,
    'gen_ai.tool.name': params.tool,
    'gen_ai.operation.name': 'execute_tool',
    status: params.status,
  };
  if (typeof params.stateful === 'boolean') attrs['photon.stateful'] = params.stateful;
  if (params.errorType) attrs['photon.error_type'] = params.errorType;

  getHistogram('photon.tool.duration', 'Tool-call duration', 'ms').record(params.durationMs, attrs);
  getCounter('photon.tool.calls', 'Tool-call count', '1').add(1, attrs);

  if (params.status === 'error') {
    getCounter('photon.tool.errors', 'Tool-call errors', '1').add(1, attrs);
  }
}

/**
 * Record a rate-limit rejection. Incremented every time a `@throttled`
 * or `@rateLimit` middleware throws `PhotonRateLimitError`.
 */
export function recordRateLimitRejection(params: {
  photon: string;
  tool: string;
  instance?: string;
}): void {
  const attrs: Record<string, string | number | boolean> = {
    'gen_ai.agent.name': params.photon,
    'gen_ai.tool.name': params.tool,
  };
  if (params.instance) attrs['photon.instance'] = params.instance;
  getCounter(
    'photon.rate_limit.rejections',
    'Rate-limit rejections (throttled middleware)',
    '1'
  ).add(1, attrs);
}

/**
 * Record a bulkhead rejection. Incremented every time the @bulkhead
 * middleware throws PhotonBulkheadFullError because concurrent-execution
 * cap was reached.
 */
export function recordBulkheadRejection(params: {
  photon: string;
  tool: string;
  instance?: string;
}): void {
  const attrs: Record<string, string | number | boolean> = {
    'gen_ai.agent.name': params.photon,
    'gen_ai.tool.name': params.tool,
  };
  if (params.instance) attrs['photon.instance'] = params.instance;
  getCounter(
    'photon.bulkhead.rejections',
    'Bulkhead rejections (concurrent-cap exceeded)',
    '1'
  ).add(1, attrs);
}

/**
 * Record a circuit-breaker state transition.
 * Attributes capture the photon/tool key and the new state so dashboards can
 * alert on "open" without sampling the call stream.
 */
export function recordCircuitStateChange(params: {
  photon: string;
  tool: string;
  instance?: string;
  from: 'closed' | 'open' | 'half-open';
  to: 'closed' | 'open' | 'half-open';
}): void {
  const attrs: Record<string, string | number | boolean> = {
    'gen_ai.agent.name': params.photon,
    'gen_ai.tool.name': params.tool,
    from: params.from,
    to: params.to,
  };
  if (params.instance) attrs['photon.instance'] = params.instance;
  getCounter('photon.circuit_breaker.transitions', 'Circuit-breaker state transitions', '1').add(
    1,
    attrs
  );
}

/**
 * Returns true if OpenTelemetry metrics are available.
 */
export function isMetricsEnabled(): boolean {
  return otelApi != null && getMeterSync() != null;
}

/**
 * Wait for the initial OTel probe. For tests.
 */
export async function waitForMetricsProbe(): Promise<void> {
  await metricsReady;
}

/**
 * Reset cached state. For tests only.
 */
export function _resetMetricsCache(): void {
  otelApi = undefined;
  counterCache.clear();
  histogramCache.clear();
}

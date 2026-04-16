/**
 * OpenTelemetry Logs bridge for Photon.
 *
 * Zero-dep no-op that upgrades gracefully when
 * `@opentelemetry/api-logs` is installed. Mirrors the dynamic-import
 * pattern used in otel.ts and metrics.ts so the runtime stays
 * dependency-free by default and production deployments can wire up
 * any OTLP-compatible log backend by installing the SDK.
 *
 * The photon Logger pushes each emitted record through `emitOtelLog`
 * after writing to its local stream. When the SDK is present the
 * record is forwarded to the OTel logs bridge with severity mapped
 * to the standard scale and ambient trace context auto-attached.
 */

import { getRequestContext } from './context.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let otelLogsApi: any;

async function loadOtelLogsApi(): Promise<unknown> {
  if (otelLogsApi !== undefined) return otelLogsApi;
  try {
    const moduleName = '@opentelemetry/api-logs';
    otelLogsApi = await import(/* webpackIgnore: true */ moduleName);
    return otelLogsApi;
  } catch {
    otelLogsApi = null;
    return null;
  }
}

const logsReady = loadOtelLogsApi();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cachedLogger: any;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getOtelLogger(): any {
  if (!otelLogsApi) return null;
  if (cachedLogger) return cachedLogger;
  try {
    cachedLogger = otelLogsApi.logs?.getLogger?.('photon', '1.0.0') ?? null;
    return cachedLogger;
  } catch {
    return null;
  }
}

// OTel SeverityNumber scale (RFC 5424-ish).
const SEVERITY: Record<string, number> = {
  debug: 5,
  info: 9,
  warn: 13,
  error: 17,
  fatal: 21,
};

export interface OtelLogRecord {
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  attributes?: Record<string, unknown>;
}

/**
 * Emit a log record to OpenTelemetry if the SDK is installed. No-op otherwise.
 * The ambient request context (photon/tool/traceId/callerId) is pulled lazily
 * so callers do not have to thread it through.
 */
export function emitOtelLog(record: OtelLogRecord): void {
  const otelLogger = getOtelLogger();
  if (!otelLogger) return;

  const attributes: Record<string, unknown> = { ...(record.attributes ?? {}) };
  const ctx = getRequestContext();
  if (ctx) {
    if (ctx.photon && attributes['photon.name'] == null) attributes['photon.name'] = ctx.photon;
    if (ctx.tool && attributes['photon.tool'] == null) attributes['photon.tool'] = ctx.tool;
    if (ctx.traceId && attributes['photon.trace_id'] == null)
      attributes['photon.trace_id'] = ctx.traceId;
    if (ctx.caller?.id && attributes['photon.caller_id'] == null)
      attributes['photon.caller_id'] = ctx.caller.id;
  }

  try {
    otelLogger.emit({
      severityNumber: SEVERITY[record.level] ?? SEVERITY.info,
      severityText: record.level.toUpperCase(),
      body: record.message,
      attributes,
    });
  } catch {
    /* best-effort */
  }
}

/**
 * Returns true if the OTel logs SDK is available.
 */
export function isOtelLogsEnabled(): boolean {
  return otelLogsApi != null && getOtelLogger() != null;
}

/**
 * Wait for the initial probe. For tests.
 */
export async function waitForLogsProbe(): Promise<void> {
  await logsReady;
}

/**
 * Reset cached state. For tests only.
 */
export function _resetLogsCache(): void {
  otelLogsApi = undefined;
  cachedLogger = undefined;
}

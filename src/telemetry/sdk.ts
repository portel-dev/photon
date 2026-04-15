/**
 * OpenTelemetry NodeSDK bootstrap for Photon.
 *
 * Zero required dependencies. When `OTEL_EXPORTER_OTLP_ENDPOINT` is set in
 * the environment AND `@opentelemetry/sdk-node` is installed, the runtime
 * wires up OTLP exporters for traces, metrics, and logs so every span,
 * counter, histogram, and log record emitted elsewhere in the codebase
 * lands in an OTLP-compatible backend (Jaeger, Grafana Tempo, SigNoz,
 * Honeycomb, DataDog, etc.) without further configuration.
 *
 * This is the final piece that makes the instrumentation shipped in
 * otel.ts / metrics.ts / logs.ts observable in practice.
 */

import type { PhotonSpan } from './otel.js';

let started = false;
let sdkInstance: unknown;

/**
 * Returns true if the caller has opted into OTel export via the standard
 * environment variable. The OTel spec treats `OTEL_EXPORTER_OTLP_ENDPOINT`
 * as the universal switch.
 */
export function isOtelRequested(): boolean {
  return Boolean(process.env.OTEL_EXPORTER_OTLP_ENDPOINT || process.env.OTEL_SDK_DISABLED === '0');
}

export interface OtelSdkOptions {
  /** Service name attached to every exported record. Defaults to `photon`. */
  serviceName?: string;
  /** Service version. Defaults to PHOTON_VERSION if available. */
  serviceVersion?: string;
  /** Deployment environment (e.g. "prod", "staging"). */
  deploymentEnvironment?: string;
}

/**
 * Start the OTel NodeSDK if the env + dependencies are present.
 *
 * Idempotent — safe to call multiple times. Returns true if the SDK was
 * actually started, false if the bootstrap was skipped (env missing, SDK
 * not installed, or already running).
 *
 * Call this as early as possible in process startup, before any photon
 * code runs, so spans from the very first tool call are captured.
 */
export async function initOtelSdk(options: OtelSdkOptions = {}): Promise<boolean> {
  if (started) return false;
  if (!isOtelRequested()) return false;

  try {
    const sdkNodeModule = '@opentelemetry/sdk-node';
    const resourcesModule = '@opentelemetry/resources';
    const semconvModule = '@opentelemetry/semantic-conventions';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sdkNode: any = await import(/* webpackIgnore: true */ sdkNodeModule);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resources: any = await import(/* webpackIgnore: true */ resourcesModule);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const semconv: any = await import(/* webpackIgnore: true */ semconvModule);

    const attrs: Record<string, string> = {
      [semconv.SemanticResourceAttributes?.SERVICE_NAME ?? 'service.name']:
        options.serviceName || process.env.OTEL_SERVICE_NAME || 'photon',
    };
    if (options.serviceVersion) {
      attrs[semconv.SemanticResourceAttributes?.SERVICE_VERSION ?? 'service.version'] =
        options.serviceVersion;
    }
    if (options.deploymentEnvironment) {
      attrs['deployment.environment'] = options.deploymentEnvironment;
    }

    const resource = resources.Resource?.default
      ? resources.Resource.default().merge(new resources.Resource(attrs))
      : new resources.Resource(attrs);

    const sdk = new sdkNode.NodeSDK({
      resource,
      // The SDK auto-detects OTLP exporters from OTEL_EXPORTER_OTLP_ENDPOINT
      // and OTEL_EXPORTER_OTLP_PROTOCOL (grpc, http/protobuf, http/json).
    });

    sdk.start();
    sdkInstance = sdk;
    started = true;

    // Graceful shutdown on process exit — flush pending spans/metrics/logs.
    const shutdown = () => {
      void sdk.shutdown?.().catch(() => {
        /* best-effort */
      });
    };
    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);
    process.once('beforeExit', shutdown);

    return true;
  } catch {
    // SDK not installed or bootstrap failed — stay silent. The runtime's
    // no-op wrappers in otel.ts/metrics.ts/logs.ts continue to work.
    return false;
  }
}

/**
 * Shut down the SDK and flush exporters. For tests.
 */
export async function shutdownOtelSdk(): Promise<void> {
  if (!started) return;
  started = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sdk = sdkInstance as any;
  try {
    await sdk?.shutdown?.();
  } catch {
    /* best-effort */
  }
  sdkInstance = undefined;
}

/**
 * Returns true if the SDK has been started in this process.
 */
export function isOtelSdkStarted(): boolean {
  return started;
}

// Re-export so a consumer that only imports from this module can still
// create spans when the SDK is started.
export type { PhotonSpan };

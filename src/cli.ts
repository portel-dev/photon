#!/usr/bin/env node

/**
 * Photon MCP CLI
 *
 * Thin entry point — delegates to cli/index.ts which registers
 * all command modules and handles argv preprocessing.
 *
 * Bootstraps the OTel SDK as early as possible when OTEL_EXPORTER_OTLP_ENDPOINT
 * is set, so spans from the very first tool call are captured. The SDK init
 * is a no-op when the env var is unset or the OTel packages aren't installed.
 */

import { initOtelSdk } from './telemetry/sdk.js';
import { PHOTON_VERSION } from './version.js';
import { main } from './cli/index.js';

async function bootstrap(): Promise<void> {
  await initOtelSdk({ serviceVersion: PHOTON_VERSION });
  await main();
}

void bootstrap();

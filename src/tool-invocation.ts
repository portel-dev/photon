import type {
  CallerInfo,
  InputProvider,
  OutputHandler,
  SamplingProvider,
  PhotonClass,
} from '@portel/photon-core';
import type { PhotonExecutionRequestContext } from './telemetry/context.js';
import type { PhotonAppContext } from './app-context.js';

export interface ToolInvocationOptions {
  resumeRunId?: string;
  outputHandler?: OutputHandler;
  inputProvider?: InputProvider;
  samplingProvider?: SamplingProvider;
  roots?: Array<{ uri: string; name?: string }>;
  caller?: CallerInfo;
  requestContext?: PhotonExecutionRequestContext;
  appContext?: PhotonAppContext;
  traceId?: string;
  parentTraceparent?: string;
  signal?: AbortSignal;
}

export interface ToolInvocationPort {
  execute(
    photon: PhotonClass,
    toolName: string,
    parameters: Record<string, unknown>,
    options?: ToolInvocationOptions
  ): Promise<unknown>;
}

/**
 * Small application port for tool invocation. Transport adapters depend on this
 * contract rather than the full PhotonLoader implementation.
 */
export function invokeTool(
  executor: ToolInvocationPort,
  photon: PhotonClass,
  toolName: string,
  parameters: Record<string, unknown>,
  options?: ToolInvocationOptions
): Promise<unknown> {
  return executor.execute(photon, toolName, parameters, options);
}

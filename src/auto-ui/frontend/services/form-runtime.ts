/**
 * Host-neutral runtime adapter for the shared rich form component.
 *
 * The form itself only needs to resolve dynamic choice fields. Prefer the
 * Photon/MCP Apps host APIs when they are present, and retain the full Beam
 * client as the fallback used by the main Beam bundle.
 */

export interface FormToolClient {
  callTool(toolName: string, args: Record<string, unknown>): Promise<unknown>;
}

interface FormHostApi {
  callTool(toolName: string, args: Record<string, unknown>): Promise<unknown>;
}

interface FormHostWindow extends Window {
  photon?: FormHostApi;
  openai?: FormHostApi;
}

/** Call a tool through the host that owns the form, with Beam as a fallback. */
export function callFormTool(
  toolName: string,
  args: Record<string, unknown>,
  fallbackClient: FormToolClient
): Promise<unknown> {
  const hostWindow = typeof window === 'undefined' ? undefined : (window as FormHostWindow);
  const hostApi = hostWindow?.photon || hostWindow?.openai;
  if (hostApi && typeof hostApi.callTool === 'function') {
    return Promise.resolve(hostApi.callTool(toolName, args));
  }
  return fallbackClient.callTool(toolName, args);
}

import type { ExtractedSchema, PhotonClassExtended, CallerInfo } from '@portel/photon-core';

export interface McpToolPolicyPort {
  isToolAccessible(
    photon: PhotonClassExtended,
    toolName: string,
    caller?: CallerInfo,
    request?: unknown
  ): boolean;
}

export interface AuthorizedMcpTool {
  toolName: string;
  tool: ExtractedSchema;
}

/**
 * Application-level MCP exposure policy. Transport adapters provide the caller
 * and accessibility port; this module owns method lookup and surface rules.
 */
export function authorizeMcpTool(
  photon: PhotonClassExtended,
  toolName: string,
  caller: CallerInfo | undefined,
  policy: McpToolPolicyPort,
  request?: unknown
): AuthorizedMcpTool {
  if (!policy.isToolAccessible(photon, toolName, caller, request)) {
    throw new Error(`Tool '${toolName}' is not available for this caller`);
  }

  const tool = photon.tools.find((candidate) => candidate.name === toolName) as
    | ExtractedSchema
    | undefined;
  if (!tool) throw new Error(`Tool '${toolName}' not found`);

  const surfaces = (tool as ExtractedSchema & { surfaces?: string[] }).surfaces;
  if (surfaces && !surfaces.includes('mcp')) {
    throw new Error(`Tool '${toolName}' is not exposed on the MCP surface`);
  }

  return { toolName, tool };
}

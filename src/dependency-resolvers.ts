import type { MCPDependency, PhotonDependency } from '@portel/photon-core';

export interface McpClientResolver {
  resolve(dep: MCPDependency): Promise<unknown>;
}

export interface PhotonDependencyResolver {
  resolve(
    dep: PhotonDependency,
    currentPhotonPath: string,
    callerInstanceName?: string
  ): Promise<unknown>;
}

export interface DependencyResolutionPorts {
  mcp?: McpClientResolver;
  photon?: PhotonDependencyResolver;
}

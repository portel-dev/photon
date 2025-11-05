/**
 * Photon MCP Core Types
 */

export interface PhotonTool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

export interface ExtractedSchema {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

export interface PhotonMCPClass {
  name: string;
  description?: string;
  tools: PhotonTool[];
  instance: any;
}

export interface ConstructorParam {
  name: string;
  type: string;
  isOptional: boolean;
  hasDefault: boolean;
  defaultValue?: any;
}

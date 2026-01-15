/**
 * Test Photon: MCP Import via Protocol
 *
 * This tests that @mcp dependencies work correctly:
 * 1. The MCP server is spawned via the protocol
 * 2. Tools are discovered and callable via this.{mcpName}.{toolName}()
 *
 * @mcp memory npm:@modelcontextprotocol/server-memory
 */

import { PhotonMCP } from '@portel/photon-core';

// Declare the MCP dependency type for TypeScript
declare module '@portel/photon-core' {
  interface PhotonMCP {
    memory: {
      create_entities(params: { entities: Array<{ name: string; entityType: string; observations: string[] }> }): Promise<any>;
      read_graph(): Promise<any>;
      search_nodes(params: { query: string }): Promise<any>;
    };
  }
}

export default class MCPTestPhoton extends PhotonMCP {
  /**
   * Create entities in memory graph
   */
  async createEntity(name: string, type: string, observation: string): Promise<any> {
    const result = await this.memory.create_entities({
      entities: [{ name, entityType: type, observations: [observation] }]
    });
    return result;
  }

  /**
   * Read the memory graph
   */
  async readGraph(): Promise<any> {
    const result = await this.memory.read_graph();
    return result;
  }

  /**
   * Search for nodes in memory
   */
  async searchMemory(query: string): Promise<any> {
    const result = await this.memory.search_nodes({ query });
    return result;
  }

  /**
   * Simple test that returns static data (no MCP dependency)
   */
  async ping(): Promise<string> {
    return 'pong';
  }
}

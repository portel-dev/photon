/**
 * Memory - Knowledge graph-based persistent memory
 *
 * Replicates the official MCP Memory server for storing structured information across conversations.
 * Maintains entities, relations, and observations in a local knowledge graph.
 *
 * Common use cases:
 * - Personal information: "Remember that I prefer TypeScript over JavaScript"
 * - Project tracking: "Add a note that the API migration is 80% complete"
 * - Relationship mapping: "Connect the frontend team to the API project"
 *
 * Example: createEntities({ entities: [{ name: "user", entityType: "person", observations: ["prefers TypeScript"] }] })
 *
 * Configuration:
 * - storage_path: Path to store knowledge graph JSON (default: ~/.photon/memory.json)
 *
 * @version 1.0.0
 * @author Portel
 * @license MIT
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { existsSync } from 'fs';
import * as os from 'os';

interface Entity {
  name: string;
  entityType: string;
  observations: string[];
}

interface Relation {
  from: string;
  to: string;
  relationType: string;
}

interface KnowledgeGraph {
  entities: Entity[];
  relations: Relation[];
}

export default class Memory {
  private storagePath: string;
  private graph: KnowledgeGraph = { entities: [], relations: [] };

  constructor(storage_path?: string) {
    this.storagePath =
      storage_path || path.join(os.homedir(), '.photon', 'memory.json');
  }

  async onInitialize() {
    // Ensure storage directory exists
    await fs.mkdir(path.dirname(this.storagePath), { recursive: true });

    // Load existing graph
    if (existsSync(this.storagePath)) {
      const data = await fs.readFile(this.storagePath, 'utf-8');
      this.graph = JSON.parse(data);
      console.error(
        `[memory] ✅ Loaded ${this.graph.entities.length} entities, ${this.graph.relations.length} relations`
      );
    } else {
      await this.saveGraph();
      console.error('[memory] ✅ Initialized with empty knowledge graph');
    }

    console.error(`[memory] Storage: ${this.storagePath}`);
  }

  /**
   * Create new entities with observations
   * @param entities Array of entities with name, type, and observations
   */
  async createEntities(params: {
    entities: Array<{ name: string; entityType: string; observations: string[] }>;
  }) {
    try {
      const created: string[] = [];

      for (const entity of params.entities) {
        // Check if entity already exists
        const existing = this.graph.entities.find((e) => e.name === entity.name);

        if (existing) {
          return {
            success: false,
            error: `Entity already exists: ${entity.name}`,
          };
        }

        this.graph.entities.push({
          name: entity.name,
          entityType: entity.entityType,
          observations: entity.observations || [],
        });

        created.push(entity.name);
      }

      await this.saveGraph();

      return {
        success: true,
        created,
        count: created.length,
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Create relations between entities
   * @param relations Array of relations with from, to, and type
   */
  async createRelations(params: {
    relations: Array<{ from: string; to: string; relationType: string }>;
  }) {
    try {
      const created: Array<{ from: string; to: string; relationType: string }> = [];

      for (const relation of params.relations) {
        // Verify both entities exist
        const fromExists = this.graph.entities.some((e) => e.name === relation.from);
        const toExists = this.graph.entities.some((e) => e.name === relation.to);

        if (!fromExists) {
          return {
            success: false,
            error: `Entity not found: ${relation.from}`,
          };
        }

        if (!toExists) {
          return {
            success: false,
            error: `Entity not found: ${relation.to}`,
          };
        }

        this.graph.relations.push({
          from: relation.from,
          to: relation.to,
          relationType: relation.relationType,
        });

        created.push(relation);
      }

      await this.saveGraph();

      return {
        success: true,
        created,
        count: created.length,
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Add observations to an entity
   * @param entityName Entity name
   * @param observations Array of observation strings
   */
  async addObservations(params: { entityName: string; observations: string[] }) {
    try {
      const entity = this.graph.entities.find((e) => e.name === params.entityName);

      if (!entity) {
        return {
          success: false,
          error: `Entity not found: ${params.entityName}`,
        };
      }

      entity.observations.push(...params.observations);
      await this.saveGraph();

      return {
        success: true,
        entity: params.entityName,
        added: params.observations.length,
        totalObservations: entity.observations.length,
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Delete entities and their relations
   * @param entityNames Array of entity names to delete
   */
  async deleteEntities(params: { entityNames: string[] }) {
    try {
      const deleted: string[] = [];

      for (const entityName of params.entityNames) {
        const index = this.graph.entities.findIndex((e) => e.name === entityName);

        if (index === -1) {
          continue; // Skip non-existent entities
        }

        this.graph.entities.splice(index, 1);

        // Remove all relations involving this entity
        this.graph.relations = this.graph.relations.filter(
          (r) => r.from !== entityName && r.to !== entityName
        );

        deleted.push(entityName);
      }

      await this.saveGraph();

      return {
        success: true,
        deleted,
        count: deleted.length,
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Delete specific observations from an entity
   * @param entityName Entity name
   * @param observations Array of observations to delete (exact match)
   */
  async deleteObservations(params: { entityName: string; observations: string[] }) {
    try {
      const entity = this.graph.entities.find((e) => e.name === params.entityName);

      if (!entity) {
        return {
          success: false,
          error: `Entity not found: ${params.entityName}`,
        };
      }

      const originalCount = entity.observations.length;
      entity.observations = entity.observations.filter(
        (obs) => !params.observations.includes(obs)
      );

      const deleted = originalCount - entity.observations.length;
      await this.saveGraph();

      return {
        success: true,
        entity: params.entityName,
        deleted,
        remaining: entity.observations.length,
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Delete relations
   * @param relations Array of relations to delete
   */
  async deleteRelations(params: {
    relations: Array<{ from: string; to: string; relationType: string }>;
  }) {
    try {
      let deleted = 0;

      for (const relation of params.relations) {
        const index = this.graph.relations.findIndex(
          (r) =>
            r.from === relation.from &&
            r.to === relation.to &&
            r.relationType === relation.relationType
        );

        if (index !== -1) {
          this.graph.relations.splice(index, 1);
          deleted++;
        }
      }

      await this.saveGraph();

      return {
        success: true,
        deleted,
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Read the entire knowledge graph
   */
  async readGraph(params: {}) {
    return {
      success: true,
      entities: this.graph.entities,
      relations: this.graph.relations,
      stats: {
        entityCount: this.graph.entities.length,
        relationCount: this.graph.relations.length,
        totalObservations: this.graph.entities.reduce(
          (sum, e) => sum + e.observations.length,
          0
        ),
      },
    };
  }

  /**
   * Search for entities matching a query
   * @param query Search query (searches names, types, and observations)
   */
  async searchNodes(params: { query: string }) {
    try {
      const query = params.query.toLowerCase();
      const matches = this.graph.entities.filter((entity) => {
        return (
          entity.name.toLowerCase().includes(query) ||
          entity.entityType.toLowerCase().includes(query) ||
          entity.observations.some((obs) => obs.toLowerCase().includes(query))
        );
      });

      return {
        success: true,
        query: params.query,
        count: matches.length,
        entities: matches,
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Open specific entities by name with their relations
   * @param names Array of entity names to retrieve
   */
  async openNodes(params: { names: string[] }) {
    try {
      const results = params.names.map((name) => {
        const entity = this.graph.entities.find((e) => e.name === name);

        if (!entity) {
          return {
            name,
            found: false,
          };
        }

        // Find all relations involving this entity
        const outgoingRelations = this.graph.relations.filter((r) => r.from === name);
        const incomingRelations = this.graph.relations.filter((r) => r.to === name);

        return {
          name,
          found: true,
          entity,
          outgoingRelations,
          incomingRelations,
        };
      });

      return {
        success: true,
        count: results.filter((r) => r.found).length,
        results,
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Clear the entire knowledge graph
   */
  async clearGraph(params: {}) {
    try {
      const stats = {
        entitiesCleared: this.graph.entities.length,
        relationsCleared: this.graph.relations.length,
      };

      this.graph = { entities: [], relations: [] };
      await this.saveGraph();

      return {
        success: true,
        ...stats,
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  async onShutdown() {
    await this.saveGraph();
    console.error('[memory] ✅ Knowledge graph saved');
  }

  // Private helper
  private async saveGraph() {
    await fs.writeFile(this.storagePath, JSON.stringify(this.graph, null, 2), 'utf-8');
  }
}

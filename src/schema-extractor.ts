/**
 * Schema Extractor
 *
 * Extracts JSON schemas from TypeScript method signatures and JSDoc comments
 */

import * as fs from 'fs/promises';
import { ExtractedSchema } from './types.js';

/**
 * Extract schemas from a Photon MCP class file
 */
export class SchemaExtractor {
  /**
   * Extract method schemas from source code
   * Parses JSDoc and TypeScript types to build JSON schemas
   */
  async extractFromFile(filePath: string): Promise<ExtractedSchema[]> {
    try {
      const source = await fs.readFile(filePath, 'utf-8');
      return this.extractFromSource(source);
    } catch (error: any) {
      console.error(`[Photon] Failed to extract schemas from ${filePath}: ${error.message}`);
      return [];
    }
  }

  /**
   * Extract schemas from source code string
   */
  extractFromSource(source: string): ExtractedSchema[] {
    const schemas: ExtractedSchema[] = [];

    // Regex to match async method signatures with JSDoc
    // Matches: /** ... */ async methodName(params: { ... }) { ... }
    const methodRegex = /\/\*\*\s*\n([\s\S]*?)\*\/\s+async\s+(\w+)\s*\(/g;

    let match;
    while ((match = methodRegex.exec(source)) !== null) {
      const [, jsdocContent, methodName] = match;

      // Find the params type by parsing from the match position
      const afterMatch = source.slice(match.index + match[0].length);
      const paramsMatch = afterMatch.match(/(?:params)?\s*:\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/);

      if (!paramsMatch) continue;

      const paramsContent = paramsMatch[1];

      // Extract description from JSDoc (first line only, before @param tags)
      const description = this.extractDescription(jsdocContent);

      // Extract parameter info from JSDoc @param tags
      const paramDocs = this.extractParamDocs(jsdocContent);

      // Parse TypeScript parameter types
      const properties = this.parseParamTypes(paramsContent, paramDocs);

      // Determine required fields (all params are required unless marked optional with ?)
      const required = Object.keys(properties).filter(
        (key) => !paramsContent.includes(`${key}?:`)
      );

      schemas.push({
        name: methodName,
        description,
        inputSchema: {
          type: 'object',
          properties,
          ...(required.length > 0 ? { required } : {}),
        },
      });
    }

    return schemas;
  }

  /**
   * Extract main description from JSDoc comment
   */
  private extractDescription(jsdocContent: string): string {
    // Split by @param to get only the description part
    const beforeParams = jsdocContent.split(/@param/)[0];

    // Remove leading * from each line and trim
    const lines = beforeParams
      .split('\n')
      .map((line) => line.trim().replace(/^\*\s?/, ''))
      .filter((line) => line && !line.startsWith('@')); // Exclude @tags and empty lines

    // Take only the last meaningful line (the actual method description)
    // This filters out file headers
    const meaningfulLines = lines.filter(line => line.length > 5); // Filter out short lines
    const description = meaningfulLines.length > 0
      ? meaningfulLines[meaningfulLines.length - 1]
      : lines.join(' ');

    // Clean up multiple spaces
    return description.replace(/\s+/g, ' ').trim() || 'No description';
  }

  /**
   * Extract parameter descriptions from JSDoc @param tags
   */
  private extractParamDocs(jsdocContent: string): Map<string, string> {
    const paramDocs = new Map<string, string>();
    const paramRegex = /@param\s+(\w+)\s+(.+)/g;

    let match;
    while ((match = paramRegex.exec(jsdocContent)) !== null) {
      const [, paramName, description] = match;
      paramDocs.set(paramName, description.trim());
    }

    return paramDocs;
  }

  /**
   * Parse TypeScript parameter types into JSON schema properties
   */
  private parseParamTypes(
    paramsContent: string,
    paramDocs: Map<string, string>
  ): Record<string, any> {
    const properties: Record<string, any> = {};

    // Split by commas or semicolons (but not inside nested objects/arrays)
    const params = this.splitParams(paramsContent);

    for (const param of params) {
      const match = param.trim().match(/(\w+)\??:\s*(.+)/);
      if (!match) continue;

      const [, name, typeStr] = match;
      const description = paramDocs.get(name) || '';
      const schema = this.typeToSchema(typeStr.trim(), description);

      properties[name] = schema;
    }

    return properties;
  }

  /**
   * Split parameters by semicolon or comma, respecting nested structures
   */
  private splitParams(paramsContent: string): string[] {
    const params: string[] = [];
    let current = '';
    let depth = 0;

    for (const char of paramsContent) {
      if (char === '{' || char === '[') {
        depth++;
        current += char;
      } else if (char === '}' || char === ']') {
        depth--;
        current += char;
      } else if ((char === ';' || char === ',') && depth === 0) {
        if (current.trim()) params.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }

    if (current.trim()) params.push(current.trim());
    return params;
  }

  /**
   * Convert TypeScript type string to JSON schema
   */
  private typeToSchema(typeStr: string, description: string): any {
    const schema: any = {};

    if (description) {
      schema.description = description;
    }

    // Handle union types (e.g., 'string | number')
    if (typeStr.includes('|')) {
      const types = typeStr.split('|').map((t) => t.trim());
      schema.anyOf = types.map((t) => this.typeToSchema(t, ''));
      return schema;
    }

    // Handle array types (e.g., 'string[]' or 'Array<string>')
    if (typeStr.endsWith('[]')) {
      schema.type = 'array';
      schema.items = this.typeToSchema(typeStr.slice(0, -2), '');
      return schema;
    }
    if (typeStr.startsWith('Array<') && typeStr.endsWith('>')) {
      schema.type = 'array';
      schema.items = this.typeToSchema(typeStr.slice(6, -1), '');
      return schema;
    }

    // Handle primitive types
    switch (typeStr) {
      case 'string':
        schema.type = 'string';
        break;
      case 'number':
        schema.type = 'number';
        break;
      case 'boolean':
        schema.type = 'boolean';
        break;
      case 'any':
        // No type restriction
        break;
      default:
        // Object type or complex type - default to object
        schema.type = 'object';
    }

    return schema;
  }
}

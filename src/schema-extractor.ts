/**
 * Schema Extractor
 *
 * Extracts JSON schemas from TypeScript method signatures and JSDoc comments
 * Also extracts constructor parameters for config injection
 * Supports Templates (@Template) and Static resources (@Static)
 *
 * Now uses TypeScript's compiler API for robust type parsing
 */

import * as fs from 'fs/promises';
import * as ts from 'typescript';
import { ExtractedSchema, ConstructorParam, TemplateInfo, StaticInfo } from './types.js';

export interface ExtractedMetadata {
  tools: ExtractedSchema[];
  templates: TemplateInfo[];
  statics: StaticInfo[];
}

/**
 * Extract schemas from a Photon MCP class file
 */
export class SchemaExtractor {
  /**
   * Extract method schemas from source code file
   */
  async extractFromFile(filePath: string): Promise<ExtractedSchema[]> {
    try {
      const source = await fs.readFile(filePath, 'utf-8');
      return this.extractFromSource(source);
    } catch (error: any) {
      console.error(`Failed to extract schemas from ${filePath}: ${error.message}`);
      return [];
    }
  }

  /**
   * Extract all metadata (tools, templates, statics) from source code
   */
  extractAllFromSource(source: string): ExtractedMetadata {
    const tools: ExtractedSchema[] = [];
    const templates: TemplateInfo[] = [];
    const statics: StaticInfo[] = [];

    try {
      // If source doesn't contain a class declaration, wrap it in one
      let sourceToParse = source;
      if (!source.includes('class ')) {
        sourceToParse = `export default class Temp {\n${source}\n}`;
      }

      // Parse source file into AST
      const sourceFile = ts.createSourceFile(
        'temp.ts',
        sourceToParse,
        ts.ScriptTarget.Latest,
        true
      );

      // Helper to process a method declaration
      const processMethod = (member: ts.MethodDeclaration) => {
        const methodName = member.name.getText(sourceFile);
        const jsdoc = this.getJSDocComment(member, sourceFile);

        // Extract parameter type information
        const paramsType = this.getFirstParameterType(member, sourceFile);
        if (!paramsType) {
          return; // Skip methods without proper params
        }

        // Build schema from TypeScript type
        const { properties, required } = this.buildSchemaFromType(paramsType, sourceFile);

        // Extract descriptions from JSDoc
        const paramDocs = this.extractParamDocs(jsdoc);

        // Merge descriptions into properties
        Object.keys(properties).forEach(key => {
          if (paramDocs.has(key)) {
            properties[key].description = paramDocs.get(key);
          }
        });

        const description = this.extractDescription(jsdoc);
        const inputSchema = {
          type: 'object' as const,
          properties,
          ...(required.length > 0 ? { required } : {}),
        };

        // Check if this is a Template
        if (this.hasTemplateTag(jsdoc)) {
          templates.push({
            name: methodName,
            description,
            inputSchema,
          });
        }
        // Check if this is a Static resource
        else if (this.hasStaticTag(jsdoc)) {
          const uri = this.extractStaticURI(jsdoc) || `static://${methodName}`;
          const mimeType = this.extractMimeType(jsdoc);

          statics.push({
            name: methodName,
            uri,
            description,
            mimeType,
            inputSchema,
          });
        }
        // Otherwise, it's a regular tool
        else {
          tools.push({
            name: methodName,
            description,
            inputSchema,
          });
        }
      };

      // Visit all nodes in the AST
      const visit = (node: ts.Node) => {
        // Look for class declarations
        if (ts.isClassDeclaration(node)) {
          node.members.forEach((member) => {
            // Look for async methods
            if (ts.isMethodDeclaration(member) &&
                member.modifiers?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword)) {
              processMethod(member);
            }
          });
        }

        ts.forEachChild(node, visit);
      };

      visit(sourceFile);
    } catch (error: any) {
      console.error('Failed to parse TypeScript source:', error.message);
    }

    return { tools, templates, statics };
  }

  /**
   * Extract schemas from source code string (backward compatibility)
   */
  extractFromSource(source: string): ExtractedSchema[] {
    return this.extractAllFromSource(source).tools;
  }

  /**
   * Get JSDoc comment for a node
   */
  private getJSDocComment(node: ts.Node, sourceFile: ts.SourceFile): string {
    // Use TypeScript's JSDoc extraction
    const jsDocs = (node as any).jsDoc;
    if (jsDocs && jsDocs.length > 0) {
      const jsDoc = jsDocs[0];
      const comment = jsDoc.comment;

      // Get full JSDoc text including tags
      const fullText = sourceFile.getFullText();
      const start = jsDoc.pos;
      const end = jsDoc.end;
      const jsDocText = fullText.substring(start, end);

      // Extract content between /** and */
      const match = jsDocText.match(/\/\*\*([\s\S]*?)\*\//);
      return match ? match[1] : '';
    }

    return '';
  }

  /**
   * Get the first parameter's type node
   */
  private getFirstParameterType(method: ts.MethodDeclaration, sourceFile: ts.SourceFile): ts.TypeNode | undefined {
    if (method.parameters.length === 0) {
      return undefined;
    }

    const firstParam = method.parameters[0];
    return firstParam.type;
  }

  /**
   * Build JSON schema from TypeScript type node
   */
  private buildSchemaFromType(typeNode: ts.TypeNode, sourceFile: ts.SourceFile): { properties: Record<string, any>, required: string[] } {
    const properties: Record<string, any> = {};
    const required: string[] = [];

    // Handle type literal (object type)
    if (ts.isTypeLiteralNode(typeNode)) {
      typeNode.members.forEach((member) => {
        if (ts.isPropertySignature(member) && member.name) {
          const propName = member.name.getText(sourceFile);
          const isOptional = member.questionToken !== undefined;

          if (!isOptional) {
            required.push(propName);
          }

          if (member.type) {
            properties[propName] = this.typeNodeToSchema(member.type, sourceFile);
          } else {
            properties[propName] = { type: 'object' };
          }
        }
      });
    }

    return { properties, required };
  }

  /**
   * Convert TypeScript type node to JSON schema
   */
  private typeNodeToSchema(typeNode: ts.TypeNode, sourceFile: ts.SourceFile): any {
    const schema: any = {};

    // Handle union types
    if (ts.isUnionTypeNode(typeNode)) {
      schema.anyOf = typeNode.types.map(t => this.typeNodeToSchema(t, sourceFile));
      return schema;
    }

    // Handle intersection types
    if (ts.isIntersectionTypeNode(typeNode)) {
      schema.allOf = typeNode.types.map(t => this.typeNodeToSchema(t, sourceFile));
      return schema;
    }

    // Handle array types
    if (ts.isArrayTypeNode(typeNode)) {
      schema.type = 'array';
      schema.items = this.typeNodeToSchema(typeNode.elementType, sourceFile);
      return schema;
    }

    // Handle type reference (e.g., Array<string>)
    if (ts.isTypeReferenceNode(typeNode)) {
      const typeName = typeNode.typeName.getText(sourceFile);

      if (typeName === 'Array' && typeNode.typeArguments && typeNode.typeArguments.length > 0) {
        schema.type = 'array';
        schema.items = this.typeNodeToSchema(typeNode.typeArguments[0], sourceFile);
        return schema;
      }

      // For other type references, default to object
      schema.type = 'object';
      return schema;
    }

    // Handle literal types
    if (ts.isLiteralTypeNode(typeNode)) {
      const literal = typeNode.literal;
      if (ts.isStringLiteral(literal)) {
        schema.type = 'string';
        schema.enum = [literal.text];
        return schema;
      }
      if (ts.isNumericLiteral(literal)) {
        schema.type = 'number';
        schema.enum = [parseFloat(literal.text)];
        return schema;
      }
      if (literal.kind === ts.SyntaxKind.TrueKeyword || literal.kind === ts.SyntaxKind.FalseKeyword) {
        schema.type = 'boolean';
        return schema;
      }
    }

    // Handle tuple types
    if (ts.isTupleTypeNode(typeNode)) {
      schema.type = 'array';
      schema.items = typeNode.elements.map(e => this.typeNodeToSchema(e, sourceFile));
      return schema;
    }

    // Handle type literal (nested object)
    if (ts.isTypeLiteralNode(typeNode)) {
      schema.type = 'object';
      const { properties, required } = this.buildSchemaFromType(typeNode, sourceFile);
      schema.properties = properties;
      if (required.length > 0) {
        schema.required = required;
      }
      return schema;
    }

    // Handle keyword types (string, number, boolean, etc.)
    const typeText = typeNode.getText(sourceFile);
    switch (typeText) {
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
      case 'unknown':
        // No type restriction
        break;
      default:
        // Default to object for complex types
        schema.type = 'object';
    }

    return schema;
  }

  /**
   * Extract constructor parameters for config injection
   */
  extractConstructorParams(source: string): ConstructorParam[] {
    const params: ConstructorParam[] = [];

    try {
      const sourceFile = ts.createSourceFile(
        'temp.ts',
        source,
        ts.ScriptTarget.Latest,
        true
      );

      const visit = (node: ts.Node) => {
        if (ts.isClassDeclaration(node)) {
          node.members.forEach((member) => {
            if (ts.isConstructorDeclaration(member)) {
              member.parameters.forEach((param) => {
                if (param.name && ts.isIdentifier(param.name)) {
                  const name = param.name.getText(sourceFile);
                  const type = param.type ? param.type.getText(sourceFile) : 'any';
                  const isOptional = param.questionToken !== undefined || param.initializer !== undefined;
                  const hasDefault = param.initializer !== undefined;

                  let defaultValue: any = undefined;
                  if (param.initializer) {
                    defaultValue = this.extractDefaultValue(param.initializer, sourceFile);
                  }

                  params.push({
                    name,
                    type,
                    isOptional,
                    hasDefault,
                    defaultValue,
                  });
                }
              });
            }
          });
        }

        ts.forEachChild(node, visit);
      };

      visit(sourceFile);
    } catch (error: any) {
      console.error('Failed to extract constructor params:', error.message);
    }

    return params;
  }

  /**
   * Extract default value from initializer
   */
  private extractDefaultValue(initializer: ts.Expression, sourceFile: ts.SourceFile): any {
    // String literals
    if (ts.isStringLiteral(initializer)) {
      return initializer.text;
    }

    // Numeric literals
    if (ts.isNumericLiteral(initializer)) {
      return parseFloat(initializer.text);
    }

    // Boolean literals
    if (initializer.kind === ts.SyntaxKind.TrueKeyword) {
      return true;
    }
    if (initializer.kind === ts.SyntaxKind.FalseKeyword) {
      return false;
    }

    // For complex expressions (function calls, etc.), return as string
    return initializer.getText(sourceFile);
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
   * Check if JSDoc contains @Template tag
   */
  private hasTemplateTag(jsdocContent: string): boolean {
    return /@Template/i.test(jsdocContent);
  }

  /**
   * Check if JSDoc contains @Static tag
   */
  private hasStaticTag(jsdocContent: string): boolean {
    return /@Static/i.test(jsdocContent);
  }

  /**
   * Extract URI pattern from @Static tag
   * Example: @Static github://repos/{owner}/{repo}/readme
   */
  private extractStaticURI(jsdocContent: string): string | null {
    const match = jsdocContent.match(/@Static\s+([\w:\/\{\}\-_.]+)/i);
    return match ? match[1].trim() : null;
  }

  /**
   * Extract MIME type from @mimeType tag
   * Example: @mimeType text/markdown
   */
  private extractMimeType(jsdocContent: string): string | undefined {
    const match = jsdocContent.match(/@mimeType\s+([\w\/\-+.]+)/i);
    return match ? match[1].trim() : undefined;
  }
}

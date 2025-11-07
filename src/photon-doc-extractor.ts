import * as fs from 'fs/promises';
import { SchemaExtractor } from './schema-extractor.js';

interface ConfigParam {
  name: string;
  envVar: string;
  type: string;
  required: boolean;
  description: string;
  default?: string;
}

interface ToolParam {
  name: string;
  type: string;
  optional: boolean;
  description: string;
}

interface Tool {
  name: string;
  description: string;
  params: ToolParam[];
  example?: string;
}

export interface PhotonMetadata {
  name: string;
  version: string;
  description: string;
  author?: string;
  license?: string;
  repository?: string;
  homepage?: string;
  configParams?: ConfigParam[];
  setupInstructions?: string;
  tools?: Tool[];
  dependencies?: string;
  hash: string;
}

/**
 * Extracts comprehensive documentation from Photon files
 *
 * Parses JSDoc comments, constructor parameters, tool methods, and examples
 * to generate complete documentation metadata.
 */
export class PhotonDocExtractor {
  private content: string;
  private schemaExtractor: SchemaExtractor;

  constructor(private filePath: string) {
    this.content = '';
    this.schemaExtractor = new SchemaExtractor();
  }

  /**
   * Extract all metadata from the Photon file
   */
  async extractFullMetadata(): Promise<Omit<PhotonMetadata, 'hash'>> {
    this.content = await fs.readFile(this.filePath, 'utf-8');

    return {
      name: this.extractName(),
      version: this.extractTag('version') || '1.0.0',
      description: this.extractDescription(),
      author: this.extractTag('author'),
      license: this.extractTag('license'),
      repository: this.extractTag('repository'),
      homepage: this.extractTag('homepage'),
      configParams: this.extractConfigParams(),
      setupInstructions: this.extractSetupInstructions(),
      tools: await this.extractTools(),
      dependencies: this.extractTag('dependencies'),
    };
  }

  /**
   * Extract photon name from filename
   */
  private extractName(): string {
    return this.filePath
      .split(/[\/\\]/)
      .pop()!
      .replace('.photon.ts', '');
  }

  /**
   * Extract main description from file-level JSDoc comment
   */
  private extractDescription(): string {
    // Match first paragraph of file-level comment
    const match = this.content.match(/\/\*\*\s*\n\s*\*\s*(.+?)\s*\*\s*\n/s);
    if (match) {
      return match[1].replace(/\s*\*\s*/g, ' ').trim();
    }
    return '';
  }

  /**
   * Extract a specific JSDoc tag value
   */
  private extractTag(tagName: string): string | undefined {
    const regex = new RegExp(`@${tagName}\\s+(.+?)(?=\\n|$)`, 'm');
    const match = this.content.match(regex);
    return match ? match[1].trim() : undefined;
  }

  /**
   * Extract configuration parameters from constructor
   */
  private extractConfigParams(): ConfigParam[] {
    const params = this.schemaExtractor.extractConstructorParams(this.content);
    const className = this.extractClassName();

    if (!params || params.length === 0) {
      return [];
    }

    // Extract configuration descriptions from class JSDoc
    const configDescriptions = this.extractConfigDescriptions();

    return params.map((param) => {
      // Convert to environment variable format
      // ClassName -> class-name -> CLASS_NAME_PARAM_NAME
      const kebabCase = className.replace(/([A-Z])/g, '-$1').toLowerCase().replace(/^-/, '');
      const envPrefix = kebabCase.toUpperCase().replace(/-/g, '_');
      const envVar = `${envPrefix}_${param.name.toUpperCase()}`;

      // Find description from Configuration section
      const description = configDescriptions[param.name] || 'No description available';

      return {
        name: param.name,
        envVar,
        type: param.type || 'string',
        required: !param.isOptional,
        description,
        default: param.hasDefault ? param.defaultValue : undefined,
      };
    });
  }

  /**
   * Extract class name
   */
  private extractClassName(): string {
    const match = this.content.match(/export\s+default\s+class\s+(\w+)/);
    return match ? match[1] : this.extractName();
  }

  /**
   * Extract configuration descriptions from "Configuration:" section
   * Returns a map of parameter name to description
   */
  private extractConfigDescriptions(): Record<string, string> {
    const setupText = this.extractSetupInstructions();
    if (!setupText) return {};

    const descriptions: Record<string, string> = {};

    // Parse lines like "- paramName: Description text"
    const lines = setupText.split('\n');
    for (const line of lines) {
      const match = line.match(/^-?\s*(\w+):\s*(.+)$/);
      if (match) {
        const [, paramName, description] = match;
        descriptions[paramName] = description.trim();
      }
    }

    return descriptions;
  }

  /**
   * Extract setup instructions from "Configuration:" section in JSDoc
   */
  private extractSetupInstructions(): string | undefined {
    // Look for configuration section in class-level JSDoc
    const jsdocMatch = this.content.match(/\/\*\*[\s\S]*?\*\//);
    if (!jsdocMatch) return undefined;

    const jsdoc = jsdocMatch[0];

    // Extract configuration section
    const configMatch = jsdoc.match(/Configuration:\s*([\s\S]*?)(?=\n\s*\*\s*@|\n\s*\*\/)/);
    if (!configMatch) return undefined;

    // Clean up the configuration text
    return configMatch[1]
      .split('\n')
      .map(line => line.replace(/^\s*\*\s?/, '').trim())
      .filter(line => line.length > 0)
      .join('\n')
      .trim();
  }

  /**
   * Extract tool methods with their documentation
   */
  private async extractTools(): Promise<Tool[]> {
    const tools: Tool[] = [];

    // First, find all async methods
    const methodRegex = /async\s+(\w+)\s*\([^)]*\)/g;
    let match;

    while ((match = methodRegex.exec(this.content)) !== null) {
      const methodName = match[1];
      const methodIndex = match.index;

      // Skip private methods (starting with _) and lifecycle methods
      if (methodName.startsWith('_') ||
          methodName === 'onInitialize' ||
          methodName === 'onShutdown') {
        continue;
      }

      // Extract JSDoc comment immediately before this method
      // Look backwards from method position to find the LAST JSDoc comment
      const precedingContent = this.content.substring(0, methodIndex);

      // Find the last /** before the method
      const lastJSDocStart = precedingContent.lastIndexOf('/**');
      if (lastJSDocStart === -1) {
        continue; // Skip methods without JSDoc
      }

      // Extract from last /** to the method
      const jsdocSection = precedingContent.substring(lastJSDocStart);
      const jsdocMatch = jsdocSection.match(/\/\*\*([\s\S]*?)\*\/\s*$/);

      if (!jsdocMatch) {
        continue; // Skip if JSDoc is malformed
      }

      const jsdoc = jsdocMatch[1];
      const tool = this.parseToolMethodFromJSDoc(jsdoc, methodName);
      if (tool) {
        tools.push(tool);
      }
    }

    return tools;
  }

  /**
   * Parse a single tool method from its JSDoc content
   */
  private parseToolMethodFromJSDoc(jsdoc: string, methodName: string): Tool | null {

    // Extract method description (first line(s) before @param)
    const descMatch = jsdoc.match(/^\s*\*\s*(.+?)(?=\n\s*\*\s*@|\n\s*$)/s);
    const description = descMatch
      ? descMatch[1]
          .split('\n')
          .map(line => line.replace(/^\s*\*\s?/, '').trim())
          .join(' ')
          .trim()
      : '';

    // Extract parameters from JSDoc @param tags
    const params: ToolParam[] = [];
    const paramRegex = /@param\s+(\w+)\s+(.+?)(?=\n\s*\*\s*@|\n\s*\*\/|\n\s*$)/gs;
    let paramMatch;

    while ((paramMatch = paramRegex.exec(jsdoc)) !== null) {
      const paramName = paramMatch[1];
      const paramDesc = paramMatch[2].trim();

      // Try to extract type and optional info from description
      // Format: "Param description (optional)" or "Param description (default: value)"
      const optional = /\(optional\)/i.test(paramDesc) || /\(default:/i.test(paramDesc);

      params.push({
        name: paramName,
        type: 'any', // Type extraction from JSDoc would need more parsing
        optional,
        description: paramDesc.replace(/\(optional\)/gi, '').replace(/\(default:.*?\)/gi, '').trim(),
      });
    }

    // Look for example in JSDoc or method body
    const exampleMatch = jsdoc.match(/@example\s+([\s\S]+?)(?=\n\s*\*\s*@|\n\s*\*\/)/);
    const example = exampleMatch
      ? exampleMatch[1]
          .split('\n')
          .map(line => line.replace(/^\s*\*\s?/, ''))
          .join('\n')
          .trim()
      : undefined;

    return {
      name: methodName,
      description,
      params,
      example,
    };
  }
}

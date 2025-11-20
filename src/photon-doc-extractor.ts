import * as fs from 'fs/promises';
import { SchemaExtractor } from '@portel/photon-core';

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
  constraintsFormatted?: string;
  example?: string;
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
  stateful?: boolean;
  idleTimeout?: number;
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

    const statefulTag = this.extractTag('stateful');
    const idleTimeoutTag = this.extractTag('idleTimeout');

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
      stateful: statefulTag === 'true',
      idleTimeout: idleTimeoutTag ? parseInt(idleTimeoutTag, 10) : undefined,
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
   * Parse inline JSDoc constraint tags from parameter description
   * Extracts tags like {@min 1}, {@max 100}, {@format email}, {@example test}
   * Returns cleaned description and formatted constraints string
   */
  private parseInlineJSDocTags(description: string): { description: string; constraintsFormatted?: string; example?: string } {
    const constraints: string[] = [];
    let cleanDesc = description;
    let example: string | undefined;

    // Extract {@min N}
    const minMatch = cleanDesc.match(/\{@min\s+(\d+)\}/);
    if (minMatch) {
      constraints.push(`min: ${minMatch[1]}`);
      cleanDesc = cleanDesc.replace(/\{@min\s+\d+\}\s*/g, '');
    }

    // Extract {@max N}
    const maxMatch = cleanDesc.match(/\{@max\s+(\d+)\}/);
    if (maxMatch) {
      constraints.push(`max: ${maxMatch[1]}`);
      cleanDesc = cleanDesc.replace(/\{@max\s+\d+\}\s*/g, '');
    }

    // Extract {@format type}
    const formatMatch = cleanDesc.match(/\{@format\s+([a-z-]+)\}/);
    if (formatMatch) {
      constraints.push(`format: ${formatMatch[1]}`);
      cleanDesc = cleanDesc.replace(/\{@format\s+[a-z-]+\}\s*/g, '');
    }

    // Extract {@pattern regex}
    const patternMatch = cleanDesc.match(/\{@pattern\s+([^}]+)\}/);
    if (patternMatch) {
      constraints.push(`pattern: ${patternMatch[1]}`);
      cleanDesc = cleanDesc.replace(/\{@pattern\s+[^}]+\}\s*/g, '');
    }

    // Extract {@example value} - handle nested braces in JSON examples
    const exampleStart = cleanDesc.indexOf('{@example ');
    if (exampleStart !== -1) {
      const contentStart = exampleStart + '{@example '.length;
      let depth = 0;
      let i = contentStart;

      // Find the closing } by counting braces
      while (i < cleanDesc.length) {
        if (cleanDesc[i] === '{') depth++;
        else if (cleanDesc[i] === '}') {
          if (depth === 0) {
            // Found the closing brace of the {@example} tag
            example = cleanDesc.substring(contentStart, i).trim();
            cleanDesc = cleanDesc.substring(0, exampleStart) + cleanDesc.substring(i + 1);
            break;
          }
          depth--;
        }
        i++;
      }
    }

    // Clean up extra whitespace
    cleanDesc = cleanDesc.trim();

    return {
      description: cleanDesc,
      constraintsFormatted: constraints.length > 0 ? constraints.join(', ') : undefined,
      example,
    };
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

      // Parse inline JSDoc tags
      const parsed = this.parseInlineJSDocTags(paramDesc);

      // Try to extract type and optional info from description
      // Format: "Param description (optional)" or "Param description (default: value)"
      let cleanDesc = parsed.description;
      const optional = /\(optional\)/i.test(cleanDesc) || /\(default:/i.test(cleanDesc);
      cleanDesc = cleanDesc.replace(/\(optional\)/gi, '').replace(/\(default:.*?\)/gi, '').trim();

      params.push({
        name: paramName,
        type: 'any', // Type extraction from JSDoc would need more parsing
        optional,
        description: cleanDesc,
        constraintsFormatted: parsed.constraintsFormatted,
        example: parsed.example,
      });
    }

    // Look for method-level @example tag (not inline {@example} in params)
    // Method-level examples should be on their own line and contain actual code
    const exampleMatch = jsdoc.match(/\n\s*\*\s*@example\s+([\s\S]+?)(?=\n\s*\*\s*@|\n\s*\*\/)/);
    let example: string | undefined;

    if (exampleMatch) {
      const exampleText = exampleMatch[1]
        .split('\n')
        .map(line => line.replace(/^\s*\*\s?/, ''))
        .join('\n')
        .trim();

      // Only use it if it looks like actual code (not just a simple value from inline tag)
      // Ignore if it's just a single word or ends with }
      if (exampleText.length > 20 || exampleText.includes('(') || exampleText.includes('{')) {
        example = exampleText;
      }
    }

    return {
      name: methodName,
      description,
      params,
      example,
    };
  }
}

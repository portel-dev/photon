import * as fs from 'fs/promises';
import * as path from 'path';
import { SchemaExtractor } from '@portel/photon-core';
import { PHOTON_VERSION } from './version.js';

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
  isGenerator?: boolean;
}

type PhotonType = 'workflow' | 'streaming' | 'api';

interface YieldStatement {
  type: 'ask' | 'emit';
  subtype: string; // 'confirm', 'select', 'text', 'status', 'progress', etc.
  message?: string;
  variable?: string; // Variable name if assigned
}

interface ExternalCall {
  type: 'mcp' | 'photon';
  name: string;
  method: string;
}

export interface PhotonMetadata {
  name: string;
  label?: string;
  version: string;
  description: string;
  author?: string;
  license?: string;
  repository?: string;
  homepage?: string;
  icon?: string;
  internal?: boolean;
  configParams?: ConfigParam[];
  setupInstructions?: string;
  tools?: Tool[];
  dependencies?: string;
  runtime?: string;
  stateful?: boolean;
  idleTimeout?: number;
  assets?: string[]; // Relative paths to asset files
  photonType: PhotonType;
  features: string[];
  externalDeps: { mcps: string[]; photons: string[]; npm: string[] };
  diagram?: string;
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
    const internalTag = this.extractTag('internal');
    const tools = await this.extractTools();
    const photonType = this.detectPhotonType(tools);
    const features = this.detectFeatures(tools, statefulTag !== undefined);
    const externalDeps = this.extractDependencies();
    const diagram = this.generateDiagramSync(tools, photonType, externalDeps);

    return {
      name: this.extractName(),
      label: this.extractTag('label'),
      version: this.extractTag('version') || PHOTON_VERSION,
      description: this.extractDescription(),
      author: this.extractTag('author'),
      license: this.extractTag('license'),
      repository: this.extractTag('repository'),
      homepage: this.extractTag('homepage'),
      icon: this.extractTag('icon'),
      internal: internalTag !== undefined,
      configParams: this.extractConfigParams(),
      setupInstructions: this.extractSetupInstructions(),
      tools,
      dependencies: this.extractTag('dependencies'),
      runtime: this.extractTag('runtime'),
      stateful: statefulTag !== undefined,
      idleTimeout: idleTimeoutTag ? parseInt(idleTimeoutTag, 10) : undefined,
      assets: await this.extractAssets(),
      photonType,
      features,
      externalDeps,
      diagram,
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
    // First try to match tag with value: @tagName value
    const regexWithValue = new RegExp(`@${tagName}\\s+(.+?)(?=\\n|$)`, 'm');
    const matchWithValue = this.content.match(regexWithValue);
    if (matchWithValue) {
      return matchWithValue[1].trim();
    }

    // Then check for boolean tag without value: @tagName (followed by newline, *, or end)
    const regexBoolean = new RegExp(`@${tagName}(?:\\s*\\n|\\s*\\*|$)`, 'm');
    if (this.content.match(regexBoolean)) {
      return 'true'; // Presence of tag means true
    }

    return undefined;
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
      const kebabCase = className
        .replace(/([A-Z])/g, '-$1')
        .toLowerCase()
        .replace(/^-/, '');
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
      .map((line) => line.replace(/^\s*\*\s?/, '').trim())
      .filter((line) => line.length > 0)
      .join('\n')
      .trim();
  }

  /**
   * Extract assets associated with the Photon
   * Scans for ui/, prompts/, resources/ folders and @ui annotations
   */
  private async extractAssets(): Promise<string[]> {
    const assets: Set<string> = new Set();
    const dir = path.dirname(this.filePath);
    const basename = path.basename(this.filePath, '.photon.ts');

    // Convention: asset folder has same name as photon (without .photon.ts)
    // e.g. test-ui.photon.ts -> test-ui/
    const assetFolder = path.join(dir, basename);

    // Check if asset folder exists
    try {
      const stats = await fs.stat(assetFolder);
      if (stats.isDirectory()) {
        // Recursively find all files in the asset folder
        const findFiles = async (currentDir: string, relativePath: string) => {
          const entries = await fs.readdir(currentDir, { withFileTypes: true });
          for (const entry of entries) {
            const entryPath = path.join(currentDir, entry.name);
            const entryRelative = path.join(relativePath, entry.name);

            if (entry.isDirectory()) {
              await findFiles(entryPath, entryRelative);
            } else {
              // Add relative path from photon file's directory
              // e.g. test-ui/ui/index.html
              assets.add(path.join(basename, entryRelative));
            }
          }
        };

        await findFiles(assetFolder, '');
      }
    } catch {
      // Asset folder doesn't exist, ignore
    }

    // Extract explicit @ui assets from JSDoc
    // Format: @ui <id> <path>
    const uiRegex = /@ui[ \t]+\S+[ \t]+(\S+)/g;
    let match;
    while ((match = uiRegex.exec(this.content)) !== null) {
      const assetPath = match[1];
      // Only include relative paths
      if (assetPath.startsWith('./') || !path.isAbsolute(assetPath)) {
        // Normalize path
        const normalized = assetPath.startsWith('./') ? assetPath.slice(2) : assetPath;
        assets.add(normalized);
      }
    }

    return Array.from(assets);
  }

  /**
   * Extract tool methods with their documentation
   */
  private async extractTools(): Promise<Tool[]> {
    const tools: Tool[] = [];

    // Find all async methods (including generators with async *)
    const methodRegex = /async\s+(\*?)\s*(\w+)\s*\(([^)]*)\)/g;
    let match;

    while ((match = methodRegex.exec(this.content)) !== null) {
      const isGenerator = match[1] === '*';
      const methodName = match[2];
      const methodSignatureParams = match[3] || '';
      const methodIndex = match.index;

      // Skip private methods (starting with _), lifecycle methods, and test methods
      if (
        methodName.startsWith('_') ||
        methodName.startsWith('test') ||
        methodName === 'onInitialize' ||
        methodName === 'onShutdown'
      ) {
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
      const tool = this.parseToolMethodFromJSDoc(jsdoc, methodName, methodSignatureParams);
      if (tool) {
        tool.isGenerator = isGenerator;
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
  private parseInlineJSDocTags(description: string): {
    description: string;
    constraintsFormatted?: string;
    example?: string;
  } {
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

    // Extract {@choice value1,value2,...}
    const choiceMatch = cleanDesc.match(/\{@choice\s+([^}]+)\}/);
    if (choiceMatch) {
      constraints.push(`choice: ${choiceMatch[1]}`);
      cleanDesc = cleanDesc.replace(/\{@choice\s+[^}]+\}\s*/g, '');
    }

    // Extract {@field type}
    const fieldMatch = cleanDesc.match(/\{@field\s+([a-z]+)\}/);
    if (fieldMatch) {
      constraints.push(`field: ${fieldMatch[1]}`);
      cleanDesc = cleanDesc.replace(/\{@field\s+[a-z]+\}\s*/g, '');
    }

    // Extract {@example value} - handle nested braces and brackets in JSON examples
    const exampleStart = cleanDesc.indexOf('{@example ');
    if (exampleStart !== -1) {
      const contentStart = exampleStart + '{@example '.length;
      let braceDepth = 0;
      let bracketDepth = 0;
      let i = contentStart;
      let inString = false;

      // Find the closing } by counting braces and brackets, respecting strings
      while (i < cleanDesc.length) {
        const ch = cleanDesc[i];
        const prevCh = i > 0 ? cleanDesc[i - 1] : '';

        // Handle string boundaries (skip escaped quotes)
        if (ch === '"' && prevCh !== '\\') {
          inString = !inString;
        } else if (!inString) {
          if (ch === '{') braceDepth++;
          else if (ch === '[') bracketDepth++;
          else if (ch === ']') bracketDepth--;
          else if (ch === '}') {
            if (braceDepth === 0 && bracketDepth === 0) {
              // Found the closing brace of the {@example} tag
              example = cleanDesc.substring(contentStart, i).trim();
              cleanDesc = cleanDesc.substring(0, exampleStart) + cleanDesc.substring(i + 1);
              break;
            }
            braceDepth--;
          }
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
  private parseToolMethodFromJSDoc(
    jsdoc: string,
    methodName: string,
    signatureParams?: string
  ): Tool | null {
    // Extract method description (first line(s) before @param)
    const descMatch = jsdoc.match(/^\s*\*\s*(.+?)(?=\n\s*\*\s*@|\n\s*$)/s);
    const description = descMatch
      ? descMatch[1]
          .split('\n')
          .map((line) => line.replace(/^\s*\*\s?/, '').trim())
          .join(' ')
          .trim()
      : '';

    // Extract type map from method signature (e.g. "path: string, recursive?: boolean")
    const sigTypes: Record<string, { type: string; optional: boolean }> = {};
    if (signatureParams) {
      // Handle both flat params (name: string) and object params (params: { name: string; encoding?: string })
      const objectMatch = signatureParams.match(/^\s*\w+\s*:\s*\{([^}]+)\}/);
      const sigContent = objectMatch ? objectMatch[1] : signatureParams;
      // Split on both commas and semicolons (TS object types use semicolons)
      for (const part of sigContent.split(/[,;]/)) {
        const m = part.trim().match(/^(\w+)(\?)?:\s*(.+)$/);
        if (m) {
          sigTypes[m[1]] = { type: m[3].trim(), optional: !!m[2] };
        }
      }
    }

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
      const optional =
        /\(optional\)/i.test(cleanDesc) ||
        /\(default:/i.test(cleanDesc) ||
        (sigTypes[paramName]?.optional ?? false);
      cleanDesc = cleanDesc
        .replace(/\(optional\)/gi, '')
        .replace(/\(default:.*?\)/gi, '')
        .trim();

      // Use type from method signature if available, fall back to 'any'
      const paramType = sigTypes[paramName]?.type || 'any';

      params.push({
        name: paramName,
        type: paramType,
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
        .map((line) => line.replace(/^\s*\*\s?/, ''))
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

  // ============================================
  // FEATURE DETECTION
  // ============================================

  /**
   * Detect platform features used by this Photon
   */
  private detectFeatures(tools: Tool[], isStateful: boolean): string[] {
    const features: string[] = [];

    // generator — any async * method
    if (tools.some((t) => t.isGenerator)) {
      features.push('generator');
    }

    // custom-ui — @ui JSDoc tag
    if (this.extractTag('ui') !== undefined || /@ui\s+\S+/.test(this.content)) {
      features.push('custom-ui');
    }

    // elicitation — yield { ask: patterns
    if (/yield\s*\{\s*ask\s*:/.test(this.content) || /yield\*\s/.test(this.content)) {
      features.push('elicitation');
    }

    // streaming — yield { emit: or yield { step:
    if (/yield\s*\{\s*(emit|step)\s*:/.test(this.content)) {
      features.push('streaming');
    }

    // oauth — yield { ask: 'oauth'
    if (/yield\s*\{\s*ask\s*:\s*['"]oauth['"]/.test(this.content)) {
      features.push('oauth');
    }

    // stateful — @stateful tag
    if (isStateful) {
      features.push('stateful');
    }

    // webhooks — webhook endpoint patterns
    if (/webhook/i.test(this.content) && /@webhook/.test(this.content)) {
      features.push('webhooks');
    }

    // channels — channel in emit patterns
    if (/channel/i.test(this.content) && /emit/.test(this.content)) {
      features.push('channels');
    }

    // locks — acquireLock / releaseLock
    if (/acquireLock|releaseLock/.test(this.content)) {
      features.push('locks');
    }

    // mcp-bridge — this.mcp( calls
    if (/this\.mcp\(/.test(this.content)) {
      features.push('mcp-bridge');
    }

    // photon-bridge — this.photon( calls
    if (/this\.photon\(/.test(this.content)) {
      features.push('photon-bridge');
    }

    // wizard — @wizard tag
    if (this.extractTag('wizard') !== undefined) {
      features.push('wizard');
    }

    // dashboard — @ui + main method with linkedUi pattern
    if (
      features.includes('custom-ui') &&
      /async\s+\*?\s*main\b/.test(this.content) &&
      /linkedUi|dashboard/i.test(this.content)
    ) {
      features.push('dashboard');
    }

    return features;
  }

  // ============================================
  // DIAGRAM GENERATION
  // ============================================

  /**
   * Generate a Mermaid diagram for this Photon
   * Automatically detects the Photon type and generates appropriate diagram
   */
  async generateDiagram(): Promise<string> {
    if (!this.content) {
      this.content = await fs.readFile(this.filePath, 'utf-8');
    }

    const tools = await this.extractTools();
    const photonType = this.detectPhotonType(tools);
    const name = this.extractName();
    const deps = this.extractDependencies();

    switch (photonType) {
      case 'workflow':
        return this.generateWorkflowDiagram(name, tools, deps);
      case 'streaming':
        return this.generateStreamingDiagram(name, tools, deps);
      default:
        return this.generateApiSurfaceDiagram(name, tools, deps);
    }
  }

  /**
   * Generate diagram synchronously when content and tools are already loaded
   */
  private generateDiagramSync(
    tools: Tool[],
    photonType: PhotonType,
    deps: { mcps: string[]; photons: string[]; npm: string[] }
  ): string {
    const name = this.extractName();

    switch (photonType) {
      case 'workflow':
        return this.generateWorkflowDiagram(name, tools, deps);
      case 'streaming':
        return this.generateStreamingDiagram(name, tools, deps);
      default:
        return this.generateApiSurfaceDiagram(name, tools, deps);
    }
  }

  /**
   * Detect the type of Photon based on its methods
   */
  private detectPhotonType(tools: Tool[]): PhotonType {
    const hasGenerator = tools.some((t) => t.isGenerator);
    const hasAskEmit = this.hasAskEmitPatterns();

    if (hasGenerator && hasAskEmit) return 'workflow';
    if (hasGenerator) return 'streaming';
    return 'api';
  }

  /**
   * Check if content has ask/emit yield patterns
   */
  private hasAskEmitPatterns(): boolean {
    return /yield\s*\{\s*(ask|emit)\s*:/.test(this.content);
  }

  /**
   * Extract dependencies from JSDoc tags
   */
  private extractDependencies(): { mcps: string[]; photons: string[]; npm: string[] } {
    const mcpsTag = this.extractTag('mcps');
    const photonsTag = this.extractTag('photons');
    const depsTag = this.extractTag('dependencies');

    return {
      mcps: mcpsTag ? mcpsTag.split(/[,\s]+/).filter(Boolean) : [],
      photons: photonsTag ? photonsTag.split(/[,\s]+/).filter(Boolean) : [],
      npm: depsTag
        ? depsTag
            .split(/[,\s]+/)
            .map((d) => d.split('@')[0])
            .filter(Boolean)
        : [],
    };
  }

  /**
   * Extract yield statements from content
   */
  private extractYieldStatements(): YieldStatement[] {
    const yields: YieldStatement[] = [];

    // Match: const varName = yield { ask: 'type', message: '...' }
    // or: yield { emit: 'type', message: '...' }
    const yieldRegex =
      /(?:const\s+(\w+)\s*(?::\s*\w+)?\s*=\s*)?yield\s*\{\s*(ask|emit)\s*:\s*['"](\w+)['"]\s*(?:,\s*message\s*:\s*[`'"]([^`'"]*)[`'"])?/g;

    let match;
    while ((match = yieldRegex.exec(this.content)) !== null) {
      yields.push({
        variable: match[1],
        type: match[2] as 'ask' | 'emit',
        subtype: match[3],
        message: match[4],
      });
    }

    return yields;
  }

  /**
   * Extract MCP and Photon calls from content
   */
  private extractExternalCalls(): ExternalCall[] {
    const calls: ExternalCall[] = [];

    // Match: this.mcp('name').method() or await this.mcp('name').method()
    const mcpRegex = /this\.mcp\(['"](\w+)['"]\)\.(\w+)/g;
    let match;
    while ((match = mcpRegex.exec(this.content)) !== null) {
      calls.push({ type: 'mcp', name: match[1], method: match[2] });
    }

    // Match: this.photon('name').method() or yield* this.photon('name').method()
    const photonRegex = /this\.photon\(['"](\w+)['"]\)\.(\w+)/g;
    while ((match = photonRegex.exec(this.content)) !== null) {
      calls.push({ type: 'photon', name: match[1], method: match[2] });
    }

    return calls;
  }

  /**
   * Infer emoji based on method/tool name
   */
  private inferEmoji(name: string): string {
    const lower = name.toLowerCase();
    if (/^(read|get|fetch|load|find|query|search|list)/.test(lower)) return '📖';
    if (/^(write|create|save|put|add|insert|set)/.test(lower)) return '✏️';
    if (/^(delete|remove|drop|clear)/.test(lower)) return '🗑️';
    if (/^(send|post|push|publish|notify)/.test(lower)) return '📤';
    if (/^(update|modify|patch|edit)/.test(lower)) return '🔄';
    if (/^(validate|check|verify|test)/.test(lower)) return '✅';
    if (/^(config|setup|init)/.test(lower)) return '⚙️';
    if (/^(run|execute|start|begin)/.test(lower)) return '▶️';
    if (/^(stop|cancel|abort|end)/.test(lower)) return '⏹️';
    if (/^(connect|login|auth)/.test(lower)) return '🔌';
    if (/^(download|export)/.test(lower)) return '📥';
    if (/^(upload|import)/.test(lower)) return '📤';
    return '🔧';
  }

  /**
   * Get emoji for ask type
   */
  private getAskEmoji(subtype: string): string {
    switch (subtype) {
      case 'confirm':
        return '🙋';
      case 'select':
        return '📋';
      case 'text':
        return '✏️';
      case 'number':
        return '🔢';
      case 'password':
        return '🔒';
      case 'date':
        return '📅';
      case 'file':
        return '📁';
      default:
        return '❓';
    }
  }

  /**
   * Get emoji for emit type
   */
  private getEmitEmoji(subtype: string): string {
    switch (subtype) {
      case 'status':
        return '📢';
      case 'progress':
        return '⏳';
      case 'log':
        return '📝';
      case 'toast':
        return '🎉';
      case 'thinking':
        return '🧠';
      case 'artifact':
        return '📊';
      case 'stream':
        return '💬';
      default:
        return '📣';
    }
  }

  /**
   * Generate API surface diagram for tool collection Photons
   */
  private generateApiSurfaceDiagram(
    name: string,
    tools: Tool[],
    deps: { mcps: string[]; photons: string[]; npm: string[] }
  ): string {
    const lines: string[] = ['flowchart LR'];

    // Main photon subgraph
    lines.push(`    subgraph ${this.sanitizeId(name)}["📦 ${this.titleCase(name)}"]`);
    lines.push('        direction TB');
    lines.push('        PHOTON((🎯))');

    tools.forEach((tool, i) => {
      const emoji = this.inferEmoji(tool.name);
      const id = `T${i}`;
      lines.push(`        ${id}[${emoji} ${tool.name}]`);
      lines.push(`        PHOTON --> ${id}`);
    });

    lines.push('    end');

    // Dependencies subgraph (if any)
    const hasDeps = deps.mcps.length > 0 || deps.photons.length > 0 || deps.npm.length > 0;
    if (hasDeps) {
      lines.push('');
      lines.push('    subgraph deps["Dependencies"]');
      lines.push('        direction TB');

      deps.mcps.forEach((mcp, i) => {
        lines.push(`        MCP${i}[🔌 ${mcp}]`);
      });
      deps.photons.forEach((photon, i) => {
        lines.push(`        PHO${i}[📦 ${photon}]`);
      });
      deps.npm.forEach((pkg, i) => {
        lines.push(`        NPM${i}[📚 ${pkg}]`);
      });

      lines.push('    end');
    }

    return lines.join('\n');
  }

  /**
   * Generate streaming diagram for generator Photons without ask/emit
   */
  private generateStreamingDiagram(
    name: string,
    tools: Tool[],
    deps: { mcps: string[]; photons: string[]; npm: string[] }
  ): string {
    // For streaming, show tools with streaming indicator
    const lines: string[] = ['flowchart LR'];

    lines.push(`    subgraph ${this.sanitizeId(name)}["📦 ${this.titleCase(name)}"]`);
    lines.push('        direction TB');
    lines.push('        PHOTON((🎯))');

    tools.forEach((tool, i) => {
      const emoji = tool.isGenerator ? '🌊' : this.inferEmoji(tool.name);
      const id = `T${i}`;
      const suffix = tool.isGenerator ? ' (stream)' : '';
      lines.push(`        ${id}[${emoji} ${tool.name}${suffix}]`);
      lines.push(`        PHOTON --> ${id}`);
    });

    lines.push('    end');

    return lines.join('\n');
  }

  /**
   * Generate workflow flowchart for Photons with ask/emit patterns
   */
  private generateWorkflowDiagram(
    name: string,
    tools: Tool[],
    deps: { mcps: string[]; photons: string[]; npm: string[] }
  ): string {
    const yields = this.extractYieldStatements();
    const externalCalls = this.extractExternalCalls();
    const lines: string[] = ['flowchart TD'];

    lines.push(`    subgraph ${this.sanitizeId(name)}["📦 ${this.titleCase(name)}"]`);
    lines.push('        START([▶ Start])');

    let prevNode = 'START';
    let nodeCounter = 0;

    // Process yields and calls in order they appear
    for (const y of yields) {
      const nodeId = `N${nodeCounter++}`;

      if (y.type === 'emit') {
        const emoji = this.getEmitEmoji(y.subtype);
        const msg = y.message ? this.truncate(y.message, 30) : y.subtype;
        lines.push(`        ${nodeId}[${emoji} ${msg}]`);
        lines.push(`        ${prevNode} --> ${nodeId}`);
        prevNode = nodeId;
      } else if (y.type === 'ask') {
        const emoji = this.getAskEmoji(y.subtype);
        const msg = y.message ? this.truncate(y.message, 25) : y.subtype;
        lines.push(`        ${nodeId}{${emoji} ${msg}}`);
        lines.push(`        ${prevNode} --> ${nodeId}`);

        // For confirm, add Yes/No branches
        if (y.subtype === 'confirm') {
          const cancelId = `N${nodeCounter++}`;
          const continueId = `N${nodeCounter++}`;
          lines.push(`        ${cancelId}([❌ Cancelled])`);
          lines.push(`        ${nodeId} -->|No| ${cancelId}`);
          lines.push(`        ${nodeId} -->|Yes| ${continueId}`);
          // Create a dummy continue node for the flow
          lines.push(`        ${continueId}[Continue]`);
          prevNode = continueId;
        } else {
          prevNode = nodeId;
        }
      }
    }

    // Add external calls
    for (const call of externalCalls) {
      const nodeId = `N${nodeCounter++}`;
      const emoji = call.type === 'mcp' ? '🔌' : '📦';
      lines.push(`        ${nodeId}[${emoji} ${call.name}.${call.method}]`);
      lines.push(`        ${prevNode} --> ${nodeId}`);
      prevNode = nodeId;
    }

    // End node
    lines.push(`        SUCCESS([✅ Success])`);
    lines.push(`        ${prevNode} --> SUCCESS`);

    lines.push('    end');

    // Dependencies
    const hasDeps = deps.mcps.length > 0 || deps.photons.length > 0;
    if (hasDeps) {
      lines.push('');
      lines.push('    subgraph deps["Dependencies"]');
      deps.mcps.forEach((mcp, i) => {
        lines.push(`        DEP_MCP${i}[🔌 ${mcp}]`);
      });
      deps.photons.forEach((photon, i) => {
        lines.push(`        DEP_PHO${i}[📦 ${photon}]`);
      });
      lines.push('    end');
    }

    return lines.join('\n');
  }

  /**
   * Sanitize string for use as Mermaid node ID
   */
  private sanitizeId(str: string): string {
    return str.replace(/[^a-zA-Z0-9_]/g, '_');
  }

  /**
   * Convert kebab-case to Title Case
   */
  private titleCase(str: string): string {
    return str
      .split('-')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  /**
   * Truncate string to max length
   */
  private truncate(str: string, maxLen: number): string {
    if (str.length <= maxLen) return str;
    return str.slice(0, maxLen - 3) + '...';
  }
}

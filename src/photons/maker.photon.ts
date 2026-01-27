/**
 * Photon Maker - Create and manage photons
 * @description System photon for scaffolding and managing photons
 * @internal
 *
 * ## Method Types
 *
 * This photon demonstrates two patterns for organizing methods:
 *
 * ### Static Methods (Global Actions)
 * - Called on the class itself, no instance needed
 * - In Beam UI: Appear in the Marketplace dropdown menu
 * - In CLI: `photon cli maker <method>`
 * - In MCP: Available as tools without instance context
 * - Use for: Creating new photons, syncing marketplace, validating
 *
 * ### Instance Methods (Contextual Actions)
 * - Called on a specific photon instance
 * - In Beam UI: Appear in the per-photon gear menu
 * - In CLI: Require photon context (future: `photon cli maker rename --photon serum`)
 * - Use for: Renaming, describing, adding methods to a specific photon
 *
 * ### Generator Functions (Progress Streaming)
 * - Use `async *method()` syntax for step-by-step progress
 * - Yield `{ step, message }` objects for UI updates
 * - Final yield should include `{ step: 'done', result }` or `{ type: 'done', result }`
 *
 * ### Wizard Pattern (Multi-Step UI)
 * - Mark with `@wizard` JSDoc tag
 * - Yield step definitions, receive user input via `yield`
 * - Steps: input, select, multi-input, progress, done
 *
 * ## Decorators
 *
 * - `@internal` - Bundled with runtime, special UI treatment
 * - `@wizard` - Renders as multi-step wizard instead of form
 * - `@template` - Returns a prompt string (for MCP prompts)
 * - `@resource` - Exposes as MCP resource with URI
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

/** Wizard step types for interactive UI */
type WizardStep =
  | {
      type: 'input';
      id: string;
      label: string;
      placeholder?: string;
      description?: string;
      validate?: string;
    }
  | {
      type: 'select';
      id: string;
      label: string;
      options: Array<{ value: string; label: string; description?: string }>;
    }
  | {
      type: 'multi-input';
      id: string;
      label: string;
      placeholder?: string;
      description?: string;
      optional?: boolean;
    }
  | { type: 'progress'; message: string }
  | { type: 'done'; message: string; result: any };

export default class Maker {
  private photonPath: string;
  private photonName: string;

  /**
   * Instance is created with target photon context for per-photon operations
   */
  constructor(photonPath?: string) {
    this.photonPath = photonPath || '';
    this.photonName = photonPath ? path.basename(photonPath, '.photon.ts') : '';
  }

  // ============================================
  // Static Methods → Marketplace Menu
  // ============================================

  /**
   * Create a new photon
   * @param name Name for the new photon (kebab-case recommended)
   * @param methods Tool method names to scaffold (optional)
   * @param prompts Prompt template names to scaffold (optional)
   * @param resources Resource method names to scaffold (optional)
   */
  static async *new({
    name,
    methods = [],
    prompts = [],
    resources = [],
  }: {
    /** Name for the new photon */
    name: string;
    /** Tool method names (optional) */
    methods?: string[];
    /** Prompt template names (optional) */
    prompts?: string[];
    /** Resource method names (optional) */
    resources?: string[];
  }): AsyncGenerator<{ step: string; message?: string; path?: string; code?: string }> {
    const workingDir = process.env.PHOTON_DIR || path.join(os.homedir(), '.photon');
    const fileName = `${name}.photon.ts`;
    const filePath = path.join(workingDir, fileName);

    yield { step: 'checking', message: `Checking if ${fileName} exists...` };

    // Check if exists
    try {
      await fs.access(filePath);
      throw new Error(`Photon already exists: ${filePath}`);
    } catch (e: any) {
      if (e.code !== 'ENOENT') throw e;
    }

    yield { step: 'generating', message: 'Generating scaffold...' };

    // Generate class name from kebab-case
    const className = name
      .split(/[-_]/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join('');

    // Helper to normalize input (handles string or array)
    const toArray = (input: string | string[] | undefined): string[] => {
      if (!input) return [];
      if (Array.isArray(input)) return input.filter(Boolean);
      return input
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    };

    // Generate all stubs
    const allStubs: string[] = [];
    const methodList = toArray(methods);
    const promptList = toArray(prompts);
    const resourceList = toArray(resources);

    // Tools
    if (methodList.length > 0) {
      allStubs.push(...methodList.map((m) => Maker.generateMethodStub(m, 'tool')));
    }

    // Prompts (templates)
    if (promptList.length > 0) {
      allStubs.push(...promptList.map((p) => Maker.generateMethodStub(p, 'prompt')));
    }

    // Resources
    if (resourceList.length > 0) {
      allStubs.push(...resourceList.map((r) => Maker.generateMethodStub(r, 'resource')));
    }

    // Default if nothing specified
    if (allStubs.length === 0) {
      allStubs.push(Maker.generateMethodStub('example', 'tool'));
    }

    const code = `/**
 * ${className}
 * @description [Add description]
 */
export default class ${className} {
${allStubs.join('\n\n')}
}
`;

    yield { step: 'writing', message: `Writing ${fileName}...` };

    await fs.writeFile(filePath, code, 'utf-8');

    yield { step: 'done', message: `Created ${fileName}`, path: filePath, code };
  }

  /**
   * Synchronize marketplace manifest and documentation
   */
  static async *sync(): AsyncGenerator<{
    step: string;
    message?: string;
    photon?: string;
    photons?: number;
    manifest?: string;
  }> {
    const workingDir = process.env.PHOTON_DIR || process.cwd();

    yield { step: 'scanning', message: 'Scanning for photons...' };

    const files = await fs.readdir(workingDir);
    const photonFiles = files.filter((f) => f.endsWith('.photon.ts'));

    yield {
      step: 'found',
      message: `Found ${photonFiles.length} photons`,
      photons: photonFiles.length,
    };

    for (const file of photonFiles) {
      yield { step: 'processing', photon: file, message: `Processing ${file}...` };
      // Note: Full sync with schema extraction is handled by CLI's performMarketplaceSync
      // This simplified version just lists photons for progress feedback
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    const manifest = path.join(workingDir, '.marketplace', 'photons.json');
    yield { step: 'done', message: 'Sync complete', photons: photonFiles.length, manifest };
  }

  /**
   * Validate all photons in the current directory
   */
  static async *validate(): AsyncGenerator<{
    step: string;
    photon?: string;
    status?: 'valid' | 'error';
    error?: string;
    summary?: { valid: number; errors: number };
  }> {
    const workingDir = process.env.PHOTON_DIR || process.cwd();

    yield { step: 'scanning', photon: undefined };

    const files = await fs.readdir(workingDir);
    const photonFiles = files.filter((f) => f.endsWith('.photon.ts'));

    let validCount = 0;
    let errorCount = 0;

    for (const file of photonFiles) {
      try {
        const content = await fs.readFile(path.join(workingDir, file), 'utf-8');
        if (content.includes('export default class')) {
          validCount++;
          yield { step: 'validating', photon: file, status: 'valid' };
        } else {
          errorCount++;
          yield {
            step: 'validating',
            photon: file,
            status: 'error',
            error: 'Missing default class export',
          };
        }
      } catch (e: any) {
        errorCount++;
        yield { step: 'validating', photon: file, status: 'error', error: e.message };
      }
    }

    yield { step: 'done', summary: { valid: validCount, errors: errorCount } };
  }

  /**
   * Initialize current directory as a photon marketplace
   */
  static async *init(): AsyncGenerator<{ step: string; message?: string; created?: string }> {
    const workingDir = process.cwd();

    yield { step: 'starting', message: 'Initializing photon marketplace...' };

    // Create .marketplace directory
    const marketplaceDir = path.join(workingDir, '.marketplace');
    try {
      await fs.mkdir(marketplaceDir, { recursive: true });
      yield { step: 'created', created: '.marketplace/' };
    } catch {
      // Directory creation failed - continue anyway
    }

    // Create initial manifest
    const manifestPath = path.join(marketplaceDir, 'photons.json');
    try {
      await fs.access(manifestPath);
      yield { step: 'exists', message: '.marketplace/photons.json already exists' };
    } catch {
      await fs.writeFile(manifestPath, JSON.stringify({ photons: [] }, null, 2));
      yield { step: 'created', created: '.marketplace/photons.json' };
    }

    // Create .gitignore entries
    const gitignorePath = path.join(workingDir, '.gitignore');
    try {
      let gitignore = '';
      try {
        gitignore = await fs.readFile(gitignorePath, 'utf-8');
      } catch {
        // File doesn't exist - will create new
      }

      if (!gitignore.includes('node_modules')) {
        gitignore += '\nnode_modules/\n';
        await fs.writeFile(gitignorePath, gitignore);
        yield { step: 'created', created: '.gitignore (updated)' };
      }
    } catch {
      // gitignore update failed - non-critical, continue
    }

    yield { step: 'done', message: 'Marketplace initialized' };
  }

  /**
   * Guided wizard to create a new photon
   * @wizard
   */
  static async *wizard(): AsyncGenerator<WizardStep, void, string | string[]> {
    // Step 1: Get name
    const name = yield {
      type: 'input',
      id: 'name',
      label: 'Photon Name',
      placeholder: 'my-photon',
      description: 'Use kebab-case (e.g., my-tools, api-wrapper)',
      validate: 'required|kebab',
    };

    // Step 2: Add tool methods
    const methods = yield {
      type: 'multi-input',
      id: 'methods',
      label: 'Tool Methods',
      placeholder: 'Add method name...',
      description: 'Methods that perform actions (leave empty to skip)',
      optional: true,
    };

    // Step 3: Add prompt templates
    const prompts = yield {
      type: 'multi-input',
      id: 'prompts',
      label: 'Prompt Templates',
      placeholder: 'Add template name...',
      description: 'Templates that return prompts (leave empty to skip)',
      optional: true,
    };

    // Step 4: Add resources
    const resources = yield {
      type: 'multi-input',
      id: 'resources',
      label: 'Resources',
      placeholder: 'Add resource name...',
      description: 'Static resources to expose (leave empty to skip)',
      optional: true,
    };

    // Step 5: Progress
    yield { type: 'progress', message: 'Creating photon...' };

    const workingDir = process.env.PHOTON_DIR || path.join(os.homedir(), '.photon');
    const fileName = `${name}.photon.ts`;
    const filePath = path.join(workingDir, fileName);

    // Generate class name
    const className = (name as string)
      .split(/[-_]/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join('');

    // Generate all stubs
    const allStubs: string[] = [];

    const methodList = Array.isArray(methods) ? methods : [];
    const promptList = Array.isArray(prompts) ? prompts : [];
    const resourceList = Array.isArray(resources) ? resources : [];

    if (methodList.length > 0) {
      allStubs.push(...methodList.map((m) => Maker.generateMethodStub(m as string, 'tool')));
    }
    if (promptList.length > 0) {
      allStubs.push(...promptList.map((p) => Maker.generateMethodStub(p as string, 'prompt')));
    }
    if (resourceList.length > 0) {
      allStubs.push(...resourceList.map((r) => Maker.generateMethodStub(r as string, 'resource')));
    }

    // Default if nothing specified
    if (allStubs.length === 0) {
      allStubs.push(Maker.generateMethodStub('example', 'tool'));
    }

    const code = `/**
 * ${className}
 * @description [Add description]
 */
export default class ${className} {
${allStubs.join('\n\n')}
}
`;

    await fs.writeFile(filePath, code, 'utf-8');

    // Done
    yield {
      type: 'done',
      message: `Created ${fileName}`,
      result: { path: filePath, code },
    };
  }

  // ============================================
  // Instance Methods → Per-Photon Gear Menu
  // ============================================

  /**
   * Rename this photon
   * @param name New name for the photon
   * @param photonPath Path to the photon file (optional, uses instance context if not provided)
   */
  async rename({
    name,
    photonPath,
  }: {
    name: string;
    photonPath?: string;
  }): Promise<{ oldPath: string; newPath: string }> {
    const targetPath = photonPath || this.photonPath;
    if (!targetPath) throw new Error('No photon context - provide photonPath parameter');

    const dir = path.dirname(targetPath);
    const newPath = path.join(dir, `${name}.photon.ts`);

    // Read content and update class name
    let content = await fs.readFile(targetPath, 'utf-8');

    const newClassName = name
      .split(/[-_]/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join('');

    const oldPhotonName = path.basename(targetPath, '.photon.ts');
    const oldClassName = oldPhotonName
      .split(/[-_]/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join('');

    content = content.replace(new RegExp(`class ${oldClassName}`, 'g'), `class ${newClassName}`);

    // Write to new path
    await fs.writeFile(newPath, content, 'utf-8');

    // Remove old file
    await fs.unlink(targetPath);

    return { oldPath: targetPath, newPath };
  }

  /**
   * Update photon description
   * @param description New description
   * @param photonPath Path to the photon file (optional, uses instance context if not provided)
   */
  async describe({
    description,
    photonPath,
  }: {
    description: string;
    photonPath?: string;
  }): Promise<{ updated: boolean }> {
    const targetPath = photonPath || this.photonPath;
    if (!targetPath) throw new Error('No photon context - provide photonPath parameter');

    let content = await fs.readFile(targetPath, 'utf-8');

    // Update @description in JSDoc
    if (content.includes('@description')) {
      content = content.replace(/@description\s+.*/, `@description ${description}`);
    } else {
      // Add description to class JSDoc
      content = content.replace(
        /(\/\*\*[\s\S]*?)(\s*\*\/\s*export default class)/,
        `$1\n * @description ${description}$2`
      );
    }

    await fs.writeFile(targetPath, content, 'utf-8');

    return { updated: true };
  }

  /**
   * Add a new method to this photon
   * @param name Method name
   * @param type Method type
   * @param photonPath Path to the photon file (optional, uses instance context if not provided)
   */
  async addmethod({
    name,
    type = 'tool',
    photonPath,
  }: {
    /** Method name */
    name: string;
    /** Method type */
    type?: 'tool' | 'prompt' | 'resource';
    /** Path to the photon file */
    photonPath?: string;
  }): Promise<{ added: string; type: string }> {
    const targetPath = photonPath || this.photonPath;
    if (!targetPath) throw new Error('No photon context - provide photonPath parameter');

    let content = await fs.readFile(targetPath, 'utf-8');

    const methodCode = Maker.generateMethodStub(name, type);

    // Insert before the closing brace of the class
    const lastBraceIndex = content.lastIndexOf('}');
    content =
      content.slice(0, lastBraceIndex) + '\n' + methodCode + '\n' + content.slice(lastBraceIndex);

    await fs.writeFile(targetPath, content, 'utf-8');

    return { added: name, type };
  }

  /**
   * Delete this photon
   * @param photonPath Path to the photon file (optional, uses instance context if not provided)
   */
  async delete({ photonPath }: { photonPath?: string } = {}): Promise<{ deleted: string }> {
    const targetPath = photonPath || this.photonPath;
    if (!targetPath) throw new Error('No photon context - provide photonPath parameter');

    await fs.unlink(targetPath);

    return { deleted: targetPath };
  }

  /**
   * View source code of this photon
   * @param photonPath Path to the photon file (optional, uses instance context if not provided)
   */
  async source({ photonPath }: { photonPath?: string } = {}): Promise<{
    path: string;
    code: string;
  }> {
    const targetPath = photonPath || this.photonPath;
    if (!targetPath) throw new Error('No photon context - provide photonPath parameter');

    const code = await fs.readFile(targetPath, 'utf-8');

    return { path: targetPath, code };
  }

  // ============================================
  // Helper Methods
  // ============================================

  private static generateMethodStub(name: string, type: string): string {
    const indent = '  ';

    if (type === 'prompt' || type === 'prompts') {
      return `${indent}/**
${indent} * ${name}
${indent} * @template
${indent} */
${indent}async ${name}({
${indent}  topic
${indent}}: {
${indent}  /** Topic or subject */
${indent}  topic: string;
${indent}}): Promise<string> {
${indent}  return \`Prompt about: \${topic}\`;
${indent}}`;
    }

    if (type === 'resource') {
      return `${indent}/**
${indent} * ${name}
${indent} * @resource
${indent} * @uri ${name}://default
${indent} * @mimetype text/plain
${indent} */
${indent}async ${name}(): Promise<string> {
${indent}  // TODO: implement resource content
${indent}  return 'Resource content here';
${indent}}`;
    }

    // Default: tool
    return `${indent}/**
${indent} * ${name}
${indent} */
${indent}async ${name}(params: {
${indent}  /** Parameter description */
${indent}  input: string;
${indent}}): Promise<{ result: string }> {
${indent}  // TODO: implement
${indent}  return { result: params.input };
${indent}}`;
  }
}

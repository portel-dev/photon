/**
 * Photon Maker - Create and manage photons
 * @description System photon for scaffolding and managing photons
 * @internal
 */

import * as fs from 'fs/promises';
import * as path from 'path';

/** Wizard step types for interactive UI */
type WizardStep =
  | { type: 'input'; id: string; label: string; placeholder?: string; description?: string; validate?: string }
  | { type: 'select'; id: string; label: string; options: Array<{ value: string; label: string; description?: string }> }
  | { type: 'multi-input'; id: string; label: string; placeholder?: string; description?: string; optional?: boolean }
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
    resources = []
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
    const workingDir = process.env.PHOTON_DIR || path.join(process.env.HOME || '', '.photon');
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
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join('');

    // Helper to normalize input (handles string or array)
    const toArray = (input: string | string[] | undefined): string[] => {
      if (!input) return [];
      if (Array.isArray(input)) return input.filter(Boolean);
      return input.split(',').map(s => s.trim()).filter(Boolean);
    };

    // Generate all stubs
    const allStubs: string[] = [];
    const methodList = toArray(methods);
    const promptList = toArray(prompts);
    const resourceList = toArray(resources);

    // Tools
    if (methodList.length > 0) {
      allStubs.push(...methodList.map(m => Maker.generateMethodStub(m, 'tool')));
    }

    // Prompts (templates)
    if (promptList.length > 0) {
      allStubs.push(...promptList.map(p => Maker.generateMethodStub(p, 'prompt')));
    }

    // Resources
    if (resourceList.length > 0) {
      allStubs.push(...resourceList.map(r => Maker.generateMethodStub(r, 'resource')));
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
  static async *sync(): AsyncGenerator<{ step: string; message?: string; photon?: string; photons?: number; manifest?: string }> {
    const workingDir = process.env.PHOTON_DIR || process.cwd();

    yield { step: 'scanning', message: 'Scanning for photons...' };

    const files = await fs.readdir(workingDir);
    const photonFiles = files.filter(f => f.endsWith('.photon.ts'));

    yield { step: 'found', message: `Found ${photonFiles.length} photons`, photons: photonFiles.length };

    for (const file of photonFiles) {
      yield { step: 'processing', photon: file, message: `Processing ${file}...` };
      // TODO: Extract schema and update manifest
      await new Promise(resolve => setTimeout(resolve, 100)); // Simulate work
    }

    const manifest = path.join(workingDir, '.marketplace', 'photons.json');
    yield { step: 'done', message: 'Sync complete', photons: photonFiles.length, manifest };
  }

  /**
   * Validate all photons in the current directory
   */
  static async *validate(): AsyncGenerator<{ step: string; photon?: string; status?: 'valid' | 'error'; error?: string; summary?: { valid: number; errors: number } }> {
    const workingDir = process.env.PHOTON_DIR || process.cwd();

    yield { step: 'scanning', photon: undefined };

    const files = await fs.readdir(workingDir);
    const photonFiles = files.filter(f => f.endsWith('.photon.ts'));

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
          yield { step: 'validating', photon: file, status: 'error', error: 'Missing default class export' };
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
    } catch {}

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
      } catch {}

      if (!gitignore.includes('node_modules')) {
        gitignore += '\nnode_modules/\n';
        await fs.writeFile(gitignorePath, gitignore);
        yield { step: 'created', created: '.gitignore (updated)' };
      }
    } catch {}

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
      validate: 'required|kebab'
    };

    // Step 2: Add tool methods
    const methods = yield {
      type: 'multi-input',
      id: 'methods',
      label: 'Tool Methods',
      placeholder: 'Add method name...',
      description: 'Methods that perform actions (leave empty to skip)',
      optional: true
    };

    // Step 3: Add prompt templates
    const prompts = yield {
      type: 'multi-input',
      id: 'prompts',
      label: 'Prompt Templates',
      placeholder: 'Add template name...',
      description: 'Templates that return prompts (leave empty to skip)',
      optional: true
    };

    // Step 4: Add resources
    const resources = yield {
      type: 'multi-input',
      id: 'resources',
      label: 'Resources',
      placeholder: 'Add resource name...',
      description: 'Static resources to expose (leave empty to skip)',
      optional: true
    };

    // Step 5: Progress
    yield { type: 'progress', message: 'Creating photon...' };

    const workingDir = process.env.PHOTON_DIR || path.join(process.env.HOME || '', '.photon');
    const fileName = `${name}.photon.ts`;
    const filePath = path.join(workingDir, fileName);

    // Generate class name
    const className = (name as string)
      .split(/[-_]/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join('');

    // Generate all stubs
    const allStubs: string[] = [];

    const methodList = Array.isArray(methods) ? methods : [];
    const promptList = Array.isArray(prompts) ? prompts : [];
    const resourceList = Array.isArray(resources) ? resources : [];

    if (methodList.length > 0) {
      allStubs.push(...methodList.map(m => Maker.generateMethodStub(m as string, 'tool')));
    }
    if (promptList.length > 0) {
      allStubs.push(...promptList.map(p => Maker.generateMethodStub(p as string, 'prompt')));
    }
    if (resourceList.length > 0) {
      allStubs.push(...resourceList.map(r => Maker.generateMethodStub(r as string, 'resource')));
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
      result: { path: filePath, code }
    };
  }

  // ============================================
  // Instance Methods → Per-Photon Gear Menu
  // ============================================

  /**
   * Rename this photon
   * @param name New name for the photon
   */
  async rename({ name }: { name: string }): Promise<{ oldPath: string; newPath: string }> {
    if (!this.photonPath) throw new Error('No photon context');

    const dir = path.dirname(this.photonPath);
    const newPath = path.join(dir, `${name}.photon.ts`);

    // Read content and update class name
    let content = await fs.readFile(this.photonPath, 'utf-8');

    const newClassName = name
      .split(/[-_]/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join('');

    const oldClassName = this.photonName
      .split(/[-_]/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join('');

    content = content.replace(
      new RegExp(`class ${oldClassName}`, 'g'),
      `class ${newClassName}`
    );

    // Write to new path
    await fs.writeFile(newPath, content, 'utf-8');

    // Remove old file
    await fs.unlink(this.photonPath);

    return { oldPath: this.photonPath, newPath };
  }

  /**
   * Update photon description
   * @param description New description
   */
  async describe({ description }: { description: string }): Promise<{ updated: boolean }> {
    if (!this.photonPath) throw new Error('No photon context');

    let content = await fs.readFile(this.photonPath, 'utf-8');

    // Update @description in JSDoc
    if (content.includes('@description')) {
      content = content.replace(
        /@description\s+.*/,
        `@description ${description}`
      );
    } else {
      // Add description to class JSDoc
      content = content.replace(
        /(\/\*\*[\s\S]*?)(\s*\*\/\s*export default class)/,
        `$1\n * @description ${description}$2`
      );
    }

    await fs.writeFile(this.photonPath, content, 'utf-8');

    return { updated: true };
  }

  /**
   * Add a new method to this photon
   * @param name Method name
   * @param type Method type
   */
  async addmethod({
    name,
    type = 'tool'
  }: {
    /** Method name */
    name: string;
    /** Method type */
    type?: 'tool' | 'prompt' | 'resource';
  }): Promise<{ added: string; type: string }> {
    if (!this.photonPath) throw new Error('No photon context');

    let content = await fs.readFile(this.photonPath, 'utf-8');

    const methodCode = Maker.generateMethodStub(name, type);

    // Insert before the closing brace of the class
    const lastBraceIndex = content.lastIndexOf('}');
    content = content.slice(0, lastBraceIndex) + '\n' + methodCode + '\n' + content.slice(lastBraceIndex);

    await fs.writeFile(this.photonPath, content, 'utf-8');

    return { added: name, type };
  }

  /**
   * Delete this photon
   */
  async delete(): Promise<{ deleted: string }> {
    if (!this.photonPath) throw new Error('No photon context');

    await fs.unlink(this.photonPath);

    return { deleted: this.photonPath };
  }

  /**
   * View source code of this photon
   */
  async source(): Promise<{ path: string; code: string }> {
    if (!this.photonPath) throw new Error('No photon context');

    const code = await fs.readFile(this.photonPath, 'utf-8');

    return { path: this.photonPath, code };
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

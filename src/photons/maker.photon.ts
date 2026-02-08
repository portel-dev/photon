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
import { exec, execFile } from 'child_process';
import { promisify } from 'util';
import { validateNpmPackageName } from '../shared/security.js';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

/** Wizard step types using standard ask/emit protocol */
type WizardStep =
  | {
      ask: 'text';
      id: string;
      message: string;
      label?: string;
      placeholder?: string;
      hint?: string;
      required?: boolean;
    }
  | {
      ask: 'select';
      id: string;
      message: string;
      options: Array<{ value: string; label: string }>;
      multi?: boolean;
    }
  | { emit: 'status'; message: string }
  | { emit: 'result'; data: any };

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
   * Guided wizard to create a new photon
   * @wizard
   * @param name Photon name in kebab-case (e.g., my-tools, api-wrapper)
   * @returns {@label Create}
   */
  static async *wizard({ name }: { name: string }): AsyncGenerator<WizardStep, void, any> {
    if (!name) return;

    // Step 1: Description
    const descriptionRaw = yield {
      ask: 'text' as const,
      id: 'description',
      message: 'What does this photon do?',
      label: 'Description',
      placeholder: 'e.g. Fetches and parses web pages',
      hint: 'A short description of what this photon does',
      required: true,
    };

    // Step 2: Icon
    const iconRaw = yield {
      ask: 'text' as const,
      id: 'icon',
      message: 'Pick an emoji icon',
      label: 'Icon',
      placeholder: '⚡',
      hint: 'An emoji icon for your photon (default: ⚡)',
      required: false,
    };

    // Step 3: Methods
    const methodsRaw = yield {
      ask: 'text' as const,
      id: 'methods',
      message: 'Name your tool methods',
      label: 'Methods',
      placeholder: 'e.g. search, fetch, analyze',
      hint: 'Comma-separated method names (default: example)',
      required: false,
    };

    // Step 4: Dependencies
    const depsRaw = yield {
      ask: 'text' as const,
      id: 'dependencies',
      message: 'npm packages to use',
      label: 'Dependencies',
      placeholder: 'e.g. axios, cheerio',
      hint: 'Comma-separated npm package names (optional)',
      required: false,
    };

    // Progress
    yield { emit: 'status' as const, message: 'Creating photon...' };

    const nameStr = String(name);
    const description =
      typeof descriptionRaw === 'string' && descriptionRaw.trim()
        ? descriptionRaw.trim()
        : '[Add description]';
    const icon = typeof iconRaw === 'string' && iconRaw.trim() ? iconRaw.trim() : '⚡';
    const workingDir = process.env.PHOTON_DIR || path.join(os.homedir(), '.photon');
    const fileName = `${nameStr}.photon.ts`;
    const filePath = path.join(workingDir, fileName);

    // Generate class name
    const className = nameStr
      .split(/[-_]/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join('');

    // Parse comma-separated lists
    const parseCsv = (val: any): string[] =>
      typeof val === 'string' && val.trim()
        ? val
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : Array.isArray(val)
          ? val
          : [];

    const methodList = parseCsv(methodsRaw);
    if (methodList.length === 0) methodList.push('example');

    // Validate npm dependencies
    const depsList = parseCsv(depsRaw);
    const validDeps: Array<{ name: string; version: string }> = [];

    for (const pkg of depsList) {
      yield { emit: 'status' as const, message: `Checking ${pkg}...` };
      const result = await Maker.validateNpmPackage(pkg);
      if (result.valid && result.version) {
        validDeps.push({ name: pkg, version: result.version });
        yield { emit: 'status' as const, message: `✓ ${pkg}@${result.version}` };
      } else {
        yield { emit: 'status' as const, message: `✗ ${pkg} — not found, skipped` };
      }
    }

    yield { emit: 'status' as const, message: 'Generating scaffold...' };

    // Build imports from valid deps
    const importLines = validDeps.map((d) => Maker.importForPackage(d.name));

    // Build @dependencies tag value
    const depsTag = validDeps.map((d) => `${d.name}@^${d.version}`).join(', ');

    // Generate method stubs
    const allStubs = methodList.map((m) => Maker.generateMethodStub(m, 'tool'));

    // Assemble JSDoc
    const jsdocLines = [
      '/**',
      ` * ${className} - ${description}`,
      ` * @description ${description}`,
      ` * @icon ${icon}`,
    ];
    if (depsTag) {
      jsdocLines.push(` * @dependencies ${depsTag}`);
    }
    jsdocLines.push(' */');

    // Final code assembly: imports first, then JSDoc + class
    const codeParts: string[] = [];
    if (importLines.length > 0) {
      codeParts.push(importLines.join('\n'));
      codeParts.push('');
    }
    codeParts.push(jsdocLines.join('\n'));
    codeParts.push(`export default class ${className} {`);
    codeParts.push(allStubs.join('\n\n'));
    codeParts.push('}');
    codeParts.push('');

    const code = codeParts.join('\n');

    await fs.writeFile(filePath, code, 'utf-8');

    // Done
    yield {
      emit: 'result' as const,
      data: { message: `Created ${fileName}`, path: filePath, code },
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

  private static async validateNpmPackage(
    name: string
  ): Promise<{ valid: boolean; version?: string }> {
    // Security: validate package name before passing to shell
    if (!validateNpmPackageName(name)) {
      return { valid: false };
    }
    try {
      const { stdout } = await execFileAsync('npm', ['view', name, 'version', '--json'], { timeout: 10000 });
      const version = JSON.parse(stdout.trim());
      if (typeof version === 'string') return { valid: true, version };
      return { valid: false };
    } catch {
      return { valid: false };
    }
  }

  private static importForPackage(pkg: string): string {
    const knownImports: Record<string, string> = {
      axios: `import axios from 'axios';`,
      cheerio: `import * as cheerio from 'cheerio';`,
      lodash: `import _ from 'lodash';`,
      'node-fetch': `import fetch from 'node-fetch';`,
      chalk: `import chalk from 'chalk';`,
      dayjs: `import dayjs from 'dayjs';`,
      zod: `import { z } from 'zod';`,
      uuid: `import { v4 as uuid } from 'uuid';`,
    };
    if (knownImports[pkg]) return knownImports[pkg];
    // Sanitize package name to valid JS identifier
    const alias = pkg.replace(/^@/, '').replace(/[^a-zA-Z0-9]/g, '_');
    return `import * as ${alias} from '${pkg}';`;
  }

  private static paramNameForMethod(method: string): string {
    const map: Record<string, string> = {
      search: 'query',
      fetch: 'url',
      analyze: 'content',
      parse: 'content',
      get: 'url',
      post: 'url',
      create: 'name',
      delete: 'id',
      update: 'id',
      send: 'message',
      read: 'path',
      write: 'path',
      download: 'url',
      upload: 'file',
      translate: 'text',
      summarize: 'text',
      convert: 'input',
      validate: 'input',
      format: 'input',
    };
    return map[method] || 'input';
  }

  private static paramDescForMethod(method: string): string {
    const map: Record<string, string> = {
      search: 'Search query',
      fetch: 'URL to fetch',
      analyze: 'Content to analyze',
      parse: 'Content to parse',
      get: 'URL to request',
      post: 'URL to post to',
      create: 'Name to create',
      delete: 'ID to delete',
      update: 'ID to update',
      send: 'Message to send',
      read: 'File path to read',
      write: 'File path to write',
      download: 'URL to download',
      upload: 'File to upload',
      translate: 'Text to translate',
      summarize: 'Text to summarize',
      convert: 'Input to convert',
      validate: 'Input to validate',
      format: 'Input to format',
    };
    return map[method] || 'Input value';
  }

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
${indent}  // Replace with your resource content
${indent}  return 'Resource content here';
${indent}}`;
    }

    // Default: tool
    const paramName = Maker.paramNameForMethod(name);
    const paramDesc = Maker.paramDescForMethod(name);

    return `${indent}/**
${indent} * ${name}
${indent} * @param ${paramName} ${paramDesc}
${indent} */
${indent}async ${name}({ ${paramName} }: {
${indent}  /** ${paramDesc} */
${indent}  ${paramName}: string;
${indent}}): Promise<{ result: string }> {
${indent}  // Replace with your logic
${indent}  return { result: ${paramName} };
${indent}}`;
  }
}

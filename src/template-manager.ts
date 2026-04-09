import { existsSync } from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { logger } from './shared/logger.js';
import { findForbiddenIdentifier } from './shared/security.js';
import { globalInstallCmd } from './shared-utils.js';

interface TemplateHash {
  version: string;
  hash: string;
  customized: boolean;
}

interface TemplateHashes {
  [templateName: string]: TemplateHash;
}

/**
 * Manages marketplace documentation templates
 *
 * Templates are stored in .marketplace/_templates/ and can be customized by users.
 * Hash-based detection prevents overwriting user customizations.
 */
export class TemplateManager {
  private marketplaceDir: string;
  private templateDir: string;
  private hashFile: string;

  // Current template version - increment when templates are updated
  private static readonly TEMPLATE_VERSION = '3.0.0';

  constructor(workingDir: string) {
    this.marketplaceDir = path.join(workingDir, '.marketplace');
    this.templateDir = path.join(this.marketplaceDir, '_templates');
    this.hashFile = path.join(this.marketplaceDir, '.template-hashes.json');
  }

  /**
   * Ensure templates directory exists and templates are initialized
   */
  async ensureTemplates(): Promise<void> {
    // Create directories
    await fs.mkdir(this.templateDir, { recursive: true });

    // Load or initialize hash tracking
    const hashes = await this.loadHashes();

    // Check and update each template
    await this.ensureTemplate('readme.md', this.getDefaultReadmeTemplate(), hashes);
    await this.ensureTemplate('photon.md', this.getDefaultPhotonTemplate(), hashes);

    // Save updated hashes
    await this.saveHashes(hashes);
  }

  /**
   * Check if a template has been customized by the user
   */
  async isTemplateCustomized(templateName: string): Promise<boolean> {
    const hashes = await this.loadHashes();
    return hashes[templateName]?.customized || false;
  }

  /**
   * Render a template with provided data
   */
  async renderTemplate(templateName: string, data: any): Promise<string> {
    const templatePath = path.join(this.templateDir, templateName);

    if (!existsSync(templatePath)) {
      throw new Error(`Template not found: ${templateName}`);
    }

    const template = await fs.readFile(templatePath, 'utf-8');
    return this.render(template, data);
  }

  /**
   * Template renderer using a char-by-char walker.
   *
   * The template uses \` for escaped backticks, \$ to prevent interpolation,
   * and \\\\ for literal backslashes. Expressions inside ${...} are extracted,
   * globally unescaped (one level of \ removal), and evaluated as plain JS.
   */
  private render(template: string, data: any): string {
    const helpers = {
      each: <T>(items: T[], fn: (item: T, index: number) => string): string => {
        return items.map((item, index) => fn(item, index)).join('');
      },
      $if: (condition: boolean, truthy: string, falsy = ''): string => {
        return condition ? truthy : falsy;
      },
      $default: (value: any, defaultValue: any): any => {
        return value !== undefined && value !== null && value !== '' ? value : defaultValue;
      },
      properName: (desc: string, fallbackName: string): string => {
        // Use first paragraph only for name extraction
        const firstPara = desc.split('\n\n')[0];
        // Match both " - " (hyphen) and " — " (em dash) separators
        const dashMatch = firstPara.match(/^(.+?)\s+[-\u2014]\s+/);
        if (dashMatch) {
          return dashMatch[1];
        }
        return fallbackName
          .split('-')
          .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
          .join(' ');
      },
      cleanDesc: (desc: string): string => {
        const firstPara = desc.split('\n\n')[0];
        const rest = desc.split('\n\n').slice(1).join('\n\n');
        // Match both " - " (hyphen) and " — " (em dash) separators
        const dashIdx = firstPara.search(/\s+[-\u2014]\s+/);
        if (dashIdx !== -1) {
          // Strip the "Label - " prefix from the first paragraph, keep the rest
          const afterDash = firstPara.replace(/^.+?\s+[-\u2014]\s+/, '');
          return rest ? `${afterDash}\n\n${rest}` : afterDash;
        }
        // No dash separator: first paragraph is the label, rest is description
        return rest || firstPara;
      },
      brief: (desc: string): string => {
        if (!desc) return '-';
        // First sentence of first paragraph, newlines collapsed for table safety
        const firstPara = desc.split('\n\n')[0].replace(/\n/g, ' ');
        return firstPara.split(/(?<=[.!?])\s/)[0];
      },
    };

    try {
      const context: Record<string, any> = { ...data, ...helpers };
      return this.evaluateTemplate(template, context);
    } catch (error: any) {
      throw new Error(
        `Template rendering error: ${error.message}\n  Context keys: ${Object.keys(data).join(', ')}`
      );
    }
  }

  /**
   * Walk template char by char, resolving escapes in text and evaluating
   * ${...} expressions. Text escapes: \` → `, \$ → $, \\\\ → \\.
   */
  private evaluateTemplate(template: string, context: Record<string, any>): string {
    const result: string[] = [];
    let i = 0;

    while (i < template.length) {
      // Handle escape sequences in template text
      if (template[i] === '\\' && i + 1 < template.length) {
        const next = template[i + 1];
        if (next === '`' || next === '$' || next === '\\') {
          result.push(next);
          i += 2;
          continue;
        }
        if (next === 'n') {
          result.push('\n');
          i += 2;
          continue;
        }
        result.push(template[i]);
        i++;
        continue;
      }

      // Check for ${...} expression
      if (template[i] === '$' && i + 1 < template.length && template[i + 1] === '{') {
        const exprStart = i + 2;
        const exprEnd = this.findMatchingBrace(template, exprStart);
        if (exprEnd === -1) {
          result.push(template[i]);
          i++;
          continue;
        }
        const rawExpr = template.substring(exprStart, exprEnd);
        const value = this.evalExpression(rawExpr, context);
        result.push(value === undefined || value === null ? '' : String(value));
        i = exprEnd + 1;
        continue;
      }

      result.push(template[i]);
      i++;
    }

    return result.join('');
  }

  /**
   * Evaluate a JS expression extracted from the template.
   * Expressions should be valid JS as-is (template literal delimiters are
   * raw backticks, escaped backticks are \`, interpolations are ${...}).
   */
  private evalExpression(expr: string, context: Record<string, any>): any {
    // Security: block dangerous identifiers in template expressions
    const forbidden = findForbiddenIdentifier(expr);
    if (forbidden) {
      throw new Error(`Forbidden identifier "${forbidden}" in template expression`);
    }

    const keys = Object.keys(context);
    const values = keys.map((k) => context[k]);
    try {
      // Shadow dangerous globals to prevent access even if identifiers sneak through
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const fn = new Function(
        ...keys,
        'process',
        'require',
        'globalThis',
        'global',
        'return (' + expr + ')'
      );
      return fn(...values, undefined, undefined, undefined, undefined);
    } catch (error: any) {
      throw new Error(
        `${error.message}\n  Expression: ${expr.length > 200 ? expr.substring(0, 200) + '...' : expr}`
      );
    }
  }

  /**
   * Find the matching closing brace for a ${...} expression,
   * correctly handling nested braces, strings, and template literals.
   */
  private findMatchingBrace(str: string, start: number): number {
    let depth = 1;
    let i = start;

    while (i < str.length && depth > 0) {
      const ch = str[i];
      if (ch === "'" || ch === '"') {
        i = this.skipString(str, i);
        continue;
      }
      if (ch === '`') {
        i = this.skipTemplateLiteral(str, i);
        continue;
      }
      if (ch === '\\' && i + 1 < str.length) {
        i += 2;
        continue;
      }
      if (ch === '{') {
        depth++;
      } else if (ch === '}') {
        depth--;
        if (depth === 0) return i;
      }
      i++;
    }
    return -1;
  }

  private skipString(str: string, start: number): number {
    const quote = str[start];
    let i = start + 1;
    while (i < str.length) {
      if (str[i] === '\\') {
        i += 2;
        continue;
      }
      if (str[i] === quote) return i + 1;
      i++;
    }
    return i;
  }

  private skipTemplateLiteral(str: string, start: number): number {
    let i = start + 1;
    while (i < str.length) {
      if (str[i] === '\\') {
        i += 2;
        continue;
      }
      if (str[i] === '`') return i + 1;
      if (str[i] === '$' && i + 1 < str.length && str[i + 1] === '{') {
        i += 2;
        const end = this.findMatchingBrace(str, i);
        if (end !== -1) i = end + 1;
        continue;
      }
      i++;
    }
    return i;
  }

  /**
   * Ensure a single template exists and is up-to-date
   */
  private async ensureTemplate(
    name: string,
    defaultContent: string,
    hashes: TemplateHashes
  ): Promise<void> {
    const templatePath = path.join(this.templateDir, name);
    const defaultHash = this.calculateHash(defaultContent);

    if (!existsSync(templatePath)) {
      // Template doesn't exist - create it
      await fs.writeFile(templatePath, defaultContent, 'utf-8');
      hashes[name] = {
        version: TemplateManager.TEMPLATE_VERSION,
        hash: defaultHash,
        customized: false,
      };
      logger.info(`✓ Created template: _templates/${name}`);
    } else {
      // Template exists - check if customized
      const currentContent = await fs.readFile(templatePath, 'utf-8');
      const currentHash = this.calculateHash(currentContent);
      const tracked = hashes[name];

      // Major version bump forces template replacement even if customized
      const trackedMajor = tracked ? parseInt(tracked.version?.split('.')[0] || '0') : 0;
      const currentMajor = parseInt(TemplateManager.TEMPLATE_VERSION.split('.')[0]);
      const forcedUpdate = currentMajor > trackedMajor;

      if (!tracked) {
        // Not tracked yet - assume customized
        hashes[name] = {
          version: TemplateManager.TEMPLATE_VERSION,
          hash: currentHash,
          customized: true,
        };
      } else if (forcedUpdate) {
        // Major version bump - replace template even if customized
        await fs.writeFile(templatePath, defaultContent, 'utf-8');
        hashes[name] = {
          version: TemplateManager.TEMPLATE_VERSION,
          hash: defaultHash,
          customized: false,
        };
        logger.info(
          `✓ Replaced template: _templates/${name} (major version ${trackedMajor} → ${currentMajor})`
        );
      } else if (currentHash === tracked.hash) {
        // Unchanged from last sync
        if (!tracked.customized && defaultHash !== tracked.hash) {
          // Template was default but we have a new version - update it
          await fs.writeFile(templatePath, defaultContent, 'utf-8');
          hashes[name] = {
            version: TemplateManager.TEMPLATE_VERSION,
            hash: defaultHash,
            customized: false,
          };
          logger.info(`✓ Updated template: _templates/${name} (new version)`);
        }
      } else {
        // Hash changed - user customized it
        hashes[name] = {
          ...tracked,
          hash: currentHash,
          customized: true,
        };
      }
    }
  }

  /**
   * Load template hashes from file
   */
  private async loadHashes(): Promise<TemplateHashes> {
    if (!existsSync(this.hashFile)) {
      return {};
    }

    try {
      const content = await fs.readFile(this.hashFile, 'utf-8');
      return JSON.parse(content);
    } catch {
      return {};
    }
  }

  /**
   * Save template hashes to file
   */
  private async saveHashes(hashes: TemplateHashes): Promise<void> {
    await fs.writeFile(this.hashFile, JSON.stringify(hashes, null, 2), 'utf-8');
  }

  /**
   * Calculate SHA-256 hash of content
   */
  private calculateHash(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  /**
   * Get default README template
   */
  private getDefaultReadmeTemplate(): string {
    return `# \${marketplaceName}

\${$if(marketplaceDescription, \`\${marketplaceDescription}\n\n\`, \`A collection of single-file TypeScript [MCP](https://modelcontextprotocol.io/introduction) servers for AI assistants.\n\n\`)}## Photons

| Photon | Description | Tools | Type |
|--------|-------------|-------|------|
\${each(photons, (p) => \`| [**\${properName(p.description, p.name)}**](\${p.name}.md) | \${brief(cleanDesc(p.description))} | \${p.tools ? p.tools.length : 0} | \${p.photonType === 'workflow' ? 'Workflow' : p.photonType === 'streaming' ? 'Streaming' : 'API'}\${(p.features || []).some(f => f === 'custom-ui' || f === 'dashboard') ? ' + UI' : ''} |\n\`)}

## Quick Start

\\\`\\\`\\\`bash
# Install the CLI
${globalInstallCmd('@portel/photon')}

# Add a photon
photon add filesystem

# Get MCP config (paste into your client)
photon get filesystem --mcp
\\\`\\\`\\\`

Output:
\\\`\\\`\\\`json
{
  "mcpServers": {
    "filesystem": {
      "command": "photon",
      "args": ["mcp", "filesystem"]
    }
  }
}
\\\`\\\`\\\`

## Commands

\\\`\\\`\\\`bash
photon add <name>        # Install a photon
photon get               # List installed photons
photon get <name> --mcp  # Get MCP config for a photon
photon search <keyword>  # Search available photons
photon upgrade           # Upgrade all photons
\\\`\\\`\\\`
\${$if(marketplaceName === 'photons', \`
## Contributing

PRs welcome for bug fixes, enhancements, and new photons.
\`, '')}
---

[Photon CLI](https://github.com/portel-dev/photon) · [MCP](https://modelcontextprotocol.io/introduction)
`;
  }

  /**
   * Get default Photon documentation template
   */
  private getDefaultPhotonTemplate(): string {
    return `# \${label || properName(description, name)}

\${cleanDesc(description)}

> **\${tools ? tools.length : 0} \${tools && tools.length === 1 ? 'tool' : 'tools'}** · \${photonType === 'workflow' ? 'Workflow' : photonType === 'streaming' ? 'Streaming' : 'API'} Photon · v\${version} · \${license || 'MIT'}

\${$if(features && features.length > 0, \`**Platform Features:** \${features.map(f => \`\\\`\${f}\\\`\`).join(' ')}
\`, '')}
## ⚙️ Configuration

\${$if(configParams && configParams.length > 0, \`
| Variable | Required | Type | Description |
|----------|----------|------|-------------|
\${each(configParams, (param) => \`| \\\`\${param.envVar}\\\` | \${param.required ? 'Yes' : 'No'} | \${param.type} | \${param.description}\${param.default ? \` (default: \\\`\${param.default}\\\`)\` : ''} |\\n\`)}
\`, \`No configuration required.
\`)}
\${$if(setupInstructions, \`
### Setup Instructions

\${setupInstructions}
\`)}

\${$if(tools && tools.length > 5, \`## 📋 Quick Reference

| Method | Description |
|--------|-------------|
\${each(tools, (tool) => \`| \\\`\${tool.name}\\\`\${tool.isGenerator ? ' ⚡' : ''} | \${brief(tool.description)} |\\n\`)}
\`)}
## 🔧 Tools

\${each(tools || [], (tool) => \`
### \\\`\${tool.name}\\\`\${tool.isGenerator ? ' ⚡' : ''}

\${tool.description || 'No description available'}

\${$if(tool.params && tool.params.length > 0, \`
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
\${each(tool.params, (p) => \`| \\\`\${p.name}\\\` | \${p.type} | \${p.optional ? 'No' : 'Yes'} | \${p.description || '-'}\${p.constraintsFormatted ? \` [\${p.constraintsFormatted}]\` : ''}\${p.example ? \` (e.g. \\\`\${p.example}\\\`)\` : ''} |\\n\`)}
\`)}

\${$if(tool.example, \`
**Example:**

\\\`\\\`\\\`typescript
\${tool.example}
\\\`\\\`\\\`
\`)}

---

\`)}

\${$if(!tools || tools.length === 0, \`
No tools defined.
\`)}
\${$if(diagram, \`
## 🏗️ Architecture

\\\`\\\`\\\`mermaid
\${diagram}
\\\`\\\`\\\`
\`)}

## 📥 Usage

\\\`\\\`\\\`bash
# Install from marketplace
photon add \${name}

# Get MCP config for your client
photon info \${name} --mcp
\\\`\\\`\\\`

## 📦 Dependencies

\${$if(dependencies, \`
\\\`\\\`\\\`
\${dependencies}
\\\`\\\`\\\`
\`, \`No external dependencies.
\`)}\${$if(externalDeps && (externalDeps.mcps.length > 0 || externalDeps.photons.length > 0), \`

**Bridges:**
\${externalDeps.mcps.length > 0 ? \`- MCP: \${externalDeps.mcps.join(', ')}\\n\` : ''}\${externalDeps.photons.length > 0 ? \`- Photon: \${externalDeps.photons.join(', ')}\\n\` : ''}
\`, '')}
---

\${license || 'MIT'} · v\${version}\${$if(author, \` · \${author}\`, '')}
`;
  }
}

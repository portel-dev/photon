import { existsSync } from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { logger } from './shared/logger.js';
import { findForbiddenIdentifier } from './shared/security.js';

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
  private static readonly TEMPLATE_VERSION = '2.0.0';

  constructor(private workingDir: string) {
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
        if (desc.includes(' - ')) {
          return desc.split(' - ')[0];
        }
        return fallbackName
          .split('-')
          .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
          .join(' ');
      },
      cleanDesc: (desc: string): string => {
        return desc.includes(' - ') ? desc.split(' - ').slice(1).join(' - ') : desc;
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
      const fn = new Function(...keys, 'process', 'require', 'globalThis', 'global', 'return (' + expr + ')');
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

      if (!tracked) {
        // Not tracked yet - assume customized
        hashes[name] = {
          version: TemplateManager.TEMPLATE_VERSION,
          hash: currentHash,
          customized: true,
        };
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

> **Singular focus. Precise target.**

\${$if(marketplaceDescription, \`\${marketplaceDescription}\n\n\`, \`**Photons** are single-file TypeScript MCP servers that supercharge AI assistants with focused capabilities. Each photon delivers ONE thing exceptionally well - from filesystem operations to cloud integrations.

Built on the [Model Context Protocol (MCP)](https://modelcontextprotocol.io/introduction), photons are:
- 📦 **One-command install** via [Photon CLI](https://github.com/portel-dev/photon)
- 🎯 **Laser-focused** on singular capabilities
- ⚡ **Zero-config** with auto-dependency management
- 🔌 **Universal** - works with Claude Desktop, Claude Code, and any MCP client

\`)}\${$if(marketplaceName === 'photons', \`## 🏛️ Official Marketplace

This is the **official Photon marketplace** maintained by Portel. It comes pre-configured with Photon - no manual setup needed.

**Already available to you:**
- ✅ Pre-installed with Photon
- ✅ Automatically updated
- ✅ Production-ready photons
- ✅ Community-maintained

**Want to contribute?**
We welcome contributions! Submit pull requests for:
- 🐛 Bug fixes to existing photons
- ✨ Enhancements and new features
- 📦 New photons to add to the marketplace
- 📝 Documentation improvements

**Repository:** [github.com/portel-dev/photons](https://github.com/portel-dev/photons)

\`, '')}## 📦 Available Photons

| Photon | Focus | Tools | Features |
|--------|-------|-------|----------|
\${each(photons, (p) => \`| [**\${properName(p.description, p.name)}**](\${p.name}.md) | \${cleanDesc(p.description)} | \${p.tools ? p.tools.length : 0} | \${(p.features || []).map(f => f === 'generator' || f === 'streaming' ? '⚡' : f === 'custom-ui' || f === 'dashboard' ? '🎨' : f === 'elicitation' ? '💬' : f === 'oauth' ? '🔐' : f === 'channels' ? '📡' : f === 'locks' ? '🔒' : f === 'mcp-bridge' ? '🔌' : f === 'photon-bridge' ? '📦' : '').filter(Boolean).join('') || '-'} |\n\`)}

**Total:** \${photons.length} photons ready to use

---

## 🚀 Quick Start

### 1. Install Photon

\\\`\\\`\\\`bash
npm install -g @portel/photon
\\\`\\\`\\\`

### 2. Add Any Photon

\\\`\\\`\\\`bash
photon add filesystem
photon add git
photon add aws-s3
\\\`\\\`\\\`

### 3. Use It

\\\`\\\`\\\`bash
# Run as MCP server
photon mcp filesystem

# Get config for your MCP client
photon get filesystem --mcp
\\\`\\\`\\\`

Output (paste directly into your MCP client config):
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

Add the output to your MCP client's configuration. **Consult your client's documentation** for setup instructions.

**That's it!** Your AI assistant now has \${photons.length} focused tools at its fingertips.

---

## 🎨 Claude Code Integration

This marketplace is also available as a **Claude Code plugin**, enabling seamless installation of individual photons directly from Claude Code's plugin manager.

### Install as Claude Code Plugin

\\\`\\\`\\\`bash
# In Claude Code, run:
/plugin marketplace add portel-dev/photons
\\\`\\\`\\\`

Once added, you can install individual photons:

\\\`\\\`\\\`bash
# Install specific photons you need
/plugin install filesystem@photons-marketplace
/plugin install git@photons-marketplace
/plugin install knowledge-graph@photons-marketplace
\\\`\\\`\\\`

### Benefits of Claude Code Plugin

- **🎯 Granular Installation**: Install only the photons you need
- **🔄 Auto-Updates**: Plugin stays synced with marketplace
- **⚡ Zero Config**: Photon CLI auto-installs on first use
- **🛡️ Secure**: No credentials shared with AI (interactive setup available)
- **📦 Individual MCPs**: Each photon is a separate installable plugin

### How This Plugin Is Built

This marketplace doubles as a Claude Code plugin through automatic generation:

\\\`\\\`\\\`bash
# Generate marketplace AND Claude Code plugin files
photon maker sync --claude-code
\\\`\\\`\\\`

This single command:
1. Scans all \\\`.photon.ts\\\` files
2. Generates \\\`.marketplace/photons.json\\\` manifest
3. Creates \\\`.claude-plugin/marketplace.json\\\` for Claude Code
4. Generates documentation for each photon
5. Creates auto-install hooks for seamless setup

**Result**: One source of truth, two distribution channels (Photon CLI + Claude Code).

---

## ⚛️ What Are Photons?

**Photons** are laser-focused modules - each does ONE thing exceptionally well:
- 📁 **Filesystem** - File operations
- 🐙 **Git** - Repository management
- ☁️ **AWS S3** - Cloud storage
- 📅 **Google Calendar** - Calendar integration
- 🕐 **Time** - Timezone operations
- ... and more

Each photon delivers **singular focus** to a **precise target**.

**Key Features:**
- 🎯 Each photon does one thing perfectly
- 📦 \${photons.length} production-ready photons available
- ⚡ Auto-installs dependencies
- 🔧 Works out of the box
- 📄 Single-file design (easy to fork and customize)

## 🎯 The Value Proposition

### Before Photon

For each MCP server:
1. Find and clone the repository
2. Install dependencies manually
3. Configure environment variables
4. Write MCP client config JSON by hand
5. Repeat for every server

### With Photon

\\\`\\\`\\\`bash
# Install from marketplace
photon add filesystem

# Get MCP config
photon get filesystem --mcp
\\\`\\\`\\\`

Output (paste directly into your MCP client config):
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

**That's it.** No dependencies, no environment setup, no configuration files.

**Difference:**
- ✅ One CLI, one command
- ✅ Zero configuration
- ✅ Instant installation
- ✅ Auto-dependencies
- ✅ Consistent experience

## 💡 Use Cases

**For Claude Users:**
\\\`\\\`\\\`bash
photon add filesystem git github-issues
photon get --mcp  # Get config for all three
\\\`\\\`\\\`
Add to Claude Desktop → Now Claude can read files, manage repos, create issues

**For Teams:**
\\\`\\\`\\\`bash
photon add postgres mongodb redis
photon get --mcp
\\\`\\\`\\\`
Give Claude access to your data infrastructure

**For Developers:**
\\\`\\\`\\\`bash
photon add docker git slack
photon get --mcp
\\\`\\\`\\\`
Automate your workflow through AI

## 🔍 Browse & Search

\\\`\\\`\\\`bash
# List all photons
photon get

# Search by keyword
photon search calendar

# View details
photon get google-calendar

# Upgrade all
photon upgrade
\\\`\\\`\\\`

## 🏢 For Enterprises

Create your own marketplace:

\\\`\\\`\\\`bash
# 1. Organize photons
mkdir company-photons && cd company-photons

# 2. Generate marketplace
photon maker sync

# 3. Share with team
git push origin main

# Team members use:
photon marketplace add company/photons
photon add your-internal-tool
\\\`\\\`\\\`

---

**Built with singular focus. Deployed with precise targeting.**

Made with ⚛️ by [Portel](https://github.com/portel-dev)
`;
  }

  /**
   * Get default Photon documentation template
   */
  private getDefaultPhotonTemplate(): string {
    return `# \${label || properName(description, name)}

\${cleanDesc(description)}

> **\${tools ? tools.length : 0} tools** · \${photonType === 'workflow' ? 'Workflow' : photonType === 'streaming' ? 'Streaming' : 'API'} Photon · v\${version} · \${license || 'MIT'}

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

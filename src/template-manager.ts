import { existsSync } from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';

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
  private static readonly TEMPLATE_VERSION = '1.0.0';

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
   * Simple template renderer using template literals
   * Safely evaluates ${expression} in templates
   */
  private render(template: string, data: any): string {
    // Helper functions available in templates
    // Using $ prefix to avoid reserved keywords
    const helpers = {
      // Loop over array
      each: <T>(items: T[], fn: (item: T, index: number) => string): string => {
        return items.map((item, index) => fn(item, index)).join('');
      },

      // Conditional rendering
      $if: (condition: boolean, truthy: string, falsy = ''): string => {
        return condition ? truthy : falsy;
      },

      // Default value
      $default: (value: any, defaultValue: any): any => {
        return value !== undefined && value !== null && value !== '' ? value : defaultValue;
      },

      // Extract proper name from description (before " - ")
      properName: (desc: string, fallbackName: string): string => {
        if (desc.includes(' - ')) {
          return desc.split(' - ')[0];
        }
        // Fallback: title case the name
        return fallbackName.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
      },

      // Extract description after " - " separator
      cleanDesc: (desc: string): string => {
        return desc.includes(' - ') ? desc.split(' - ').slice(1).join(' - ') : desc;
      },
    };

    try {
      // Create function with data and helpers in scope
      const fn = new Function(
        'data',
        'helpers',
        `
        with (data) {
          const { each, $if, $default, properName, cleanDesc } = helpers;
          return \`${template}\`;
        }
        `
      );

      return fn(data, helpers);
    } catch (error: any) {
      throw new Error(`Template rendering error: ${error.message}`);
    }
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
      console.error(`   ✓ Created template: _templates/${name}`);
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
          console.error(`   ✓ Updated template: _templates/${name} (new version)`);
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
    await fs.writeFile(
      this.hashFile,
      JSON.stringify(hashes, null, 2),
      'utf-8'
    );
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

\${$if(marketplaceDescription, \`\${marketplaceDescription}\n\n\`, \`Production-ready MCPs for the Photon runtime. Single-file, zero-config, auto-dependency MCPs that work out of the box.\n\n\`)}## 🚀 Quick Start

### Install Photon CLI

\\\`\\\`\\\`bash
npm install -g @portel/photon
\\\`\\\`\\\`

### Add a Photon from this Marketplace

\\\`\\\`\\\`bash
# Add any photon to your library
photon add <photon-name>

# For example:
photon add \${photons[0]?.name}

# Run it
photon mcp \${photons[0]?.name}
\\\`\\\`\\\`

## 📦 Available Photons

| Photon | Description | Tools | Documentation |
|--------|-------------|-------|---------------|
\${each(photons, (p) => \`| **\${properName(p.description, p.name)}** | \${cleanDesc(p.description)} | \${p.tools ? p.tools.length : 0} | [View Details](\${p.name}.md) |\n\`)}

---

**Total:** \${photons.length} photons • Click on "View Details" for configuration and usage instructions.
`;
  }

  /**
   * Get default Photon documentation template
   */
  private getDefaultPhotonTemplate(): string {
    return `# \${properName(description, name)}

\${cleanDesc(description)}

## 📋 Overview

**Version:** \${version}
**Author:** \${author || 'Unknown'}
**License:** \${license || 'MIT'}\${$if(repository, \`  \n**Repository:** \${repository}\`, '')}\${$if(homepage, \`  \n**Homepage:** \${homepage}\`, '')}

## ⚙️ Configuration

### Environment Variables

\${each(configParams || [], (param) => \`
- **\\\`\${param.envVar}\\\`** \${param.required ? '[REQUIRED]' : '[OPTIONAL]'}
  - Type: \${param.type}
  - Description: \${param.description}
  \${param.default ? \`- Default: \\\`\${param.default}\\\`\` : ''}
\`)}

\${$if(!configParams || configParams.length === 0, \`
No configuration required.
\`)}

\${$if(setupInstructions, \`
### Setup Instructions

\${setupInstructions}
\`)}

## 🔧 Tools

This photon provides **\${tools ? tools.length : 0}** tools:

\${each(tools || [], (tool) => \`
### \\\`\${tool.name}\\\`

\${tool.description || 'No description available'}

\${$if(tool.params && tool.params.length > 0, \`
**Parameters:**

\${each(tool.params, (p) => \`
- **\\\`\${p.name}\\\`** (\${p.type}\${p.optional ? ', optional' : ''}) - \${p.description || 'No description'}
\`)}
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

## 📥 Usage

### Install Photon CLI

\\\`\\\`\\\`bash
npm install -g @portel/photon
\\\`\\\`\\\`

### Run This Photon

**Option 1: Run directly from file**

\\\`\\\`\\\`bash
# Clone/download the photon file
photon mcp ./\${name}.photon.ts
\\\`\\\`\\\`

**Option 2: Install to ~/.photon/ (recommended)**

\\\`\\\`\\\`bash
# Copy to photon directory
cp \${name}.photon.ts ~/.photon/

# Run by name
photon mcp \${name}
\\\`\\\`\\\`

**Option 3: Use with Claude Desktop**

\\\`\\\`\\\`bash
# Generate MCP configuration
photon mcp \${name} --config

# Add the output to ~/Library/Application Support/Claude/claude_desktop_config.json
\\\`\\\`\\\`

## 📦 Dependencies

\${$if(dependencies, \`
This photon automatically installs the following dependencies:

\\\`\\\`\\\`
\${dependencies}
\\\`\\\`\\\`
\`, \`
No external dependencies required.
\`)}

## 📄 License

\${license || 'MIT'} • Version \${version}
`;
  }
}

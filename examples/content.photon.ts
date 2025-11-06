/**
 * Content MCP
 * Demonstrates Templates (MCP Prompts) and Static resources
 *
 * Templates = Text generation with variable substitution
 * Static = Read-only content/data
 */

// Types will be available from @portel/photon when published
// For now, we define them inline for the example
type Template = string & { __brand: 'Template' };
type Static = string & { __brand: 'Static' };

interface TemplateMessage {
  role: 'user' | 'assistant';
  content: {
    type: 'text' | 'image';
    text?: string;
    data?: string;
    mimeType?: string;
  };
}

interface TemplateResponse {
  messages: TemplateMessage[];
}

const asTemplate = (str: string): Template => str as Template;
const asStatic = (str: string): Static => str as Static;

export default class ContentMCP {
  /**
   * Generate a code review prompt
   * @Template
   * @param language Programming language
   * @param code Code to review
   */
  async codeReview(params: { language: string; code: string }): Promise<Template> {
    const prompt = `You are reviewing ${params.language} code. Please provide:
1. Code quality assessment
2. Potential bugs or issues
3. Performance considerations
4. Best practices recommendations

Code to review:
\`\`\`${params.language}
${params.code}
\`\`\`

Provide detailed, constructive feedback.`;

    return asTemplate(prompt);
  }

  /**
   * Generate a pull request description
   * @Template
   * @param title PR title
   * @param changes Summary of changes
   * @param breaking Whether this has breaking changes
   */
  async prDescription(params: {
    title: string;
    changes: string;
    breaking?: boolean;
  }): Promise<Template> {
    const breakingSection = params.breaking
      ? '\n\n⚠️ **BREAKING CHANGE**: This PR includes breaking changes.\n'
      : '';

    const template = `# ${params.title}

## Summary
${params.changes}
${breakingSection}
## Test Plan
- [ ] Unit tests pass
- [ ] Integration tests pass
- [ ] Manual testing completed

## Checklist
- [ ] Documentation updated
- [ ] Changelog updated
- [ ] Breaking changes documented`;

    return asTemplate(template);
  }

  /**
   * Generate a detailed commit message prompt with examples
   * @Template
   * @param type Type of change (feat, fix, docs, etc.)
   * @param scope Optional scope
   */
  async commitPrompt(params: { type: string; scope?: string }): Promise<TemplateResponse> {
    const scopeText = params.scope ? `(${params.scope})` : '';

    return {
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `I need to write a commit message for a ${params.type} change${
              params.scope ? ` in ${params.scope}` : ''
            }.`,
          },
        },
        {
          role: 'assistant',
          content: {
            type: 'text',
            text: `I'll help you write a conventional commit message. The format is:

${params.type}${scopeText}: <subject>

<body>

<footer>

Examples for ${params.type}:
${this.getCommitExamples(params.type)}

What changes did you make?`,
          },
        },
      ],
    };
  }

  /**
   * Get API documentation
   * @Static api://docs
   * @mimeType text/markdown
   */
  async apiDocs(params: {}): Promise<Static> {
    const docs = `# API Documentation

## Authentication
All API requests require an API key in the \`Authorization\` header:

\`\`\`
Authorization: Bearer YOUR_API_KEY
\`\`\`

## Endpoints

### GET /users
List all users

**Parameters:**
- \`limit\` (number, optional): Maximum number of users to return
- \`offset\` (number, optional): Offset for pagination

**Response:**
\`\`\`json
{
  "users": [
    { "id": 1, "name": "Alice" },
    { "id": 2, "name": "Bob" }
  ],
  "total": 100
}
\`\`\`

### POST /users
Create a new user

**Body:**
\`\`\`json
{
  "name": "Charlie",
  "email": "charlie@example.com"
}
\`\`\`

**Response:**
\`\`\`json
{
  "id": 3,
  "name": "Charlie",
  "email": "charlie@example.com"
}
\`\`\``;

    return asStatic(docs);
  }

  /**
   * Get configuration reference
   * @Static config://reference
   * @mimeType application/json
   */
  async configReference(params: {}): Promise<Static> {
    const config = JSON.stringify({
      version: '1.0.0',
      description: 'Application configuration reference',
      options: {
        server: {
          port: {
            type: 'number',
            default: 3000,
            description: 'Server port number',
          },
          host: {
            type: 'string',
            default: 'localhost',
            description: 'Server host address',
          },
        },
        database: {
          url: {
            type: 'string',
            required: true,
            description: 'Database connection URL',
          },
          poolSize: {
            type: 'number',
            default: 10,
            description: 'Connection pool size',
          },
        },
        logging: {
          level: {
            type: 'string',
            enum: ['debug', 'info', 'warn', 'error'],
            default: 'info',
            description: 'Log level',
          },
        },
      },
    }, null, 2);

    return asStatic(config);
  }

  /**
   * Get README content for a project type
   * @Static readme://{projectType}
   * @mimeType text/markdown
   * @param projectType Type of project (api, library, cli, etc.)
   */
  async readmeTemplate(params: { projectType: string }): Promise<Static> {
    const templates: Record<string, string> = {
      api: `# API Project

## Overview
This is a REST API built with [framework].

## Getting Started

\`\`\`bash
npm install
npm run dev
\`\`\`

## API Documentation
See [API.md](./API.md) for endpoint documentation.

## Testing
\`\`\`bash
npm test
\`\`\``,
      library: `# Library Project

## Installation
\`\`\`bash
npm install your-library
\`\`\`

## Usage
\`\`\`typescript
import { yourFunction } from 'your-library';

yourFunction();
\`\`\`

## API Reference
[View full API documentation](./docs/API.md)`,
      cli: `# CLI Tool

## Installation
\`\`\`bash
npm install -g your-cli
\`\`\`

## Usage
\`\`\`bash
your-cli command [options]
\`\`\`

## Commands
- \`init\` - Initialize a new project
- \`build\` - Build the project
- \`deploy\` - Deploy the project`,
    };

    const readme = templates[params.projectType] || templates.api;
    return asStatic(readme);
  }

  /**
   * Regular tool - not a template or static
   * @param text Text to count words in
   */
  async wordCount(params: { text: string }) {
    const words = params.text.trim().split(/\s+/).length;
    return { wordCount: words };
  }

  // Private helper method
  private getCommitExamples(type: string): string {
    const examples: Record<string, string> = {
      feat: `feat: add user authentication
feat(api): implement rate limiting
feat(ui): add dark mode toggle`,
      fix: `fix: resolve memory leak in cache
fix(parser): handle edge case with empty input
fix(auth): correct token validation logic`,
      docs: `docs: update API documentation
docs(readme): add installation instructions
docs: fix typos in contributing guide`,
      refactor: `refactor: simplify error handling
refactor(db): optimize query performance
refactor: extract common utilities`,
    };

    return examples[type] || examples.feat;
  }
}

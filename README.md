# Photon

> **You focus on the business logic. We'll enable the rest.**

## What You Want vs What You Get

**You want to write:**
```typescript
async createJiraTicket(params: { title: string; description: string }) {
  return await this.jira.create({
    project: 'ACME',
    type: 'Bug',
    title: params.title,
    description: params.description
  });
}
```

**Traditional MCP makes you write:**
```typescript
// index.ts - 50 lines of server setup
// server.ts - 40 lines of transport config
// tools.ts - tool registration boilerplate
// schemas.ts - manual JSON schema definitions
// types.ts - type definitions
// package.json - dependency management
// tsconfig.json - build configuration

// THEN finally your 10 lines of actual logic
```

**Photon lets you write ONLY the business logic.**

---

## You Write Business Logic

```typescript
// jira.photon.ts
export default class Jira {
  constructor(private token: string, private project: string) {}

  async createTicket(params: { title: string }) {
    // YOUR business logic
    // YOUR API calls
    // YOUR data format
    return await this.api.post('/issue', { ...params });
  }
}
```

**That's it. That's the whole file.**

---

## Photon Enables The Rest

**Photon automatically handles:**

✅ **MCP Protocol**
- Server setup
- Transport configuration
- JSON-RPC handling
- Error formatting

✅ **Schema Generation**
- TypeScript types → JSON schemas
- JSDoc → tool descriptions
- Parameter validation
- Type safety

✅ **Runtime**
- TypeScript compilation
- Module loading
- Hot reload
- Dependency management

✅ **Developer Experience**
- CLI commands
- Config generation
- Validation
- Error messages

✅ **Distribution**
- Marketplace system
- Version tracking
- Hash verification
- Metadata management

**You wrote 10 lines. Photon made it a production MCP server.**

---

## The Division of Labor

### Your Job: Business Logic

```typescript
// What you care about:
async queryAnalytics(params: { metric: string, startDate: string }) {
  const sql = `
    SELECT date, ${params.metric}
    FROM analytics
    WHERE date >= '${params.startDate}'
  `;
  return await this.db.query(sql);
}
```

**Focus on:**
- Your data
- Your APIs
- Your workflows
- Your business rules

### Photon's Job: Everything Else

**Photon handles:**
- ✅ TypeScript compilation
- ✅ Schema extraction from `params: { metric: string, startDate: string }`
- ✅ MCP server protocol
- ✅ Tool registration
- ✅ Parameter validation
- ✅ Error handling
- ✅ Hot reload
- ✅ CLI commands

**You never think about it.**

---

## Convention = Automation

**Photon uses conventions to automate infrastructure:**

### 1. File Name → MCP Name
```typescript
// jira.photon.ts
// Photon knows: This is the "jira" MCP
```

### 2. Class Methods → Tools
```typescript
async createTicket() {}  // Photon knows: This is the "createTicket" tool
async listTickets() {}   // Photon knows: This is the "listTickets" tool
```

### 3. TypeScript Types → Schemas
```typescript
async create(params: { title: string; priority: number }) {}
// Photon generates:
// {
//   "properties": {
//     "title": { "type": "string" },
//     "priority": { "type": "number" }
//   }
// }
```

### 4. JSDoc → Descriptions
```typescript
/**
 * Create a new Jira ticket
 * @param title Ticket title
 */
// Photon knows: Tool description and parameter docs
```

### 5. Constructor → Configuration
```typescript
constructor(private token: string) {}
// Photon knows: Needs JIRA_TOKEN environment variable
```

**Convention over configuration = You write logic, Photon does the rest.**

---

## Example: From Idea to Production

**Your need:** "I want Claude to query our analytics database"

### Step 1: Write Business Logic (5 minutes)

```bash
photon init analytics
```

```typescript
// ~/.photon/analytics.photon.ts
/**
 * @dependencies pg@^8.11.0
 */
import { Client } from 'pg';

export default class Analytics {
  private db: Client;

  constructor(
    private host: string,
    private database: string,
    private password: string
  ) {}

  async onInitialize() {
    this.db = new Client({
      host: this.host,
      database: this.database,
      password: this.password
    });
    await this.db.connect();
  }

  async revenue(params: { startDate: string; endDate: string }) {
    const result = await this.db.query(
      'SELECT date, SUM(amount) FROM orders WHERE date BETWEEN $1 AND $2 GROUP BY date',
      [params.startDate, params.endDate]
    );
    return result.rows;
  }

  async topCustomers(params: { limit: number }) {
    const result = await this.db.query(
      'SELECT customer_id, SUM(amount) as total FROM orders GROUP BY customer_id ORDER BY total DESC LIMIT $1',
      [params.limit]
    );
    return result.rows;
  }
}
```

**That's your business logic. Done.**

### Step 2: Photon Enables Everything Else

```bash
# Test it
photon mcp analytics --dev

# Generate config
photon get analytics --mcp

# Share with team
git push to company/mcps
photon marketplace add company/mcps
```

**Photon handled:**
- ✅ TypeScript compilation
- ✅ Schema generation for both tools
- ✅ MCP server setup
- ✅ Environment variable mapping (ANALYTICS_HOST, ANALYTICS_DATABASE, ANALYTICS_PASSWORD)
- ✅ Hot reload in dev mode
- ✅ CLI integration
- ✅ Config generation
- ✅ Marketplace distribution

**You wrote 40 lines of business logic. Photon made it a complete MCP.**

---

## For Enterprises: Focus on Your Business

### Your Team Writes Business Logic

```
company-mcps/
├── jira.photon.ts           # Your Jira workflow (40 lines)
├── salesforce.photon.ts     # Your CRM queries (60 lines)
├── analytics.photon.ts      # Your database schema (50 lines)
├── github.photon.ts         # Your deployment flow (45 lines)
└── slack.photon.ts          # Your notification format (30 lines)
```

**Total business logic: ~225 lines**

### Photon Enables Everything Else

**Without Photon, you'd need:**
- 5 separate server projects
- ~200 lines of boilerplate each (1000 lines total)
- Build configurations
- Dependency management
- Schema definitions
- Deployment pipelines

**With Photon:**
- 5 simple files
- 225 lines total
- Push to GitHub
- Done

**ROI: 80% less code. 100% focused on business logic.**

---

## Installation

### Global Install (Recommended)

```bash
npm install -g @portel/photon
```

### Zero Install (npx)

```bash
npx @portel/photon --help
```

---

## Quick Start

### 1. Create a Photon

```bash
photon init calculator
```

This creates `~/.photon/calculator.photon.ts`:

```typescript
export default class Calculator {
  /**
   * Add two numbers together
   * @param a First number
   * @param b Second number
   */
  async add(params: { a: number; b: number }) {
    return params.a + params.b;
  }
}
```

### 2. Run in Development Mode

```bash
photon mcp calculator --dev
```

### 3. Use with Claude Desktop

```bash
photon get calculator --mcp
```

Copy the output to your Claude Desktop config:

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

---

## Commands

### Run MCP Server

```bash
# Production mode (for MCP clients)
photon mcp calculator

# Development mode (hot reload)
photon mcp calculator --dev
```

### List and Inspect Photons

```bash
# List all Photons
photon get

# Show details for one
photon get calculator

# Get MCP config for all Photons
photon get --mcp

# Get MCP config for one Photon
photon get calculator --mcp
```

### Create New Photon

```bash
photon init calculator
```

Creates `calculator.photon.ts` in `~/.photon/` (accessible from anywhere).

**Custom directory:**
```bash
photon --working-dir ./my-mcps init calculator
```

### Validate Photon

```bash
photon validate calculator
```

Validates syntax and extracts schemas without running.

### Working Directory

All commands use `~/.photon/` by default. Override with `--working-dir`:

```bash
photon --working-dir ./project-mcps init my-tool
photon --working-dir ./project-mcps get
photon --working-dir ./project-mcps mcp my-tool --dev
```

---

## Photon Marketplace

### Install Photons

```bash
# Add from default marketplace (portel-dev/photons)
photon add github-issues
photon add sqlite
photon add memory

# Search for Photons
photon search slack
```

### Available Photons

Production-ready Photons from **[portel-dev/photons](https://github.com/portel-dev/photons)**:

- **GitHub Issues** - Manage GitHub repository issues (7 tools)
- **Slack** - Slack workspace integration (7 tools)
- **PostgreSQL** - Database operations with connection pooling (9 tools)
- **SQLite** - Local database operations (9 tools)
- **Web Fetch** - Web content fetching with markdown conversion (2 tools)
- **Memory** - Knowledge graph persistent memory (10 tools)

### Create Your Marketplace

**For enterprises and teams:**

```bash
# 1. Organize your Photons
mkdir company-mcps && cd company-mcps
cp ~/.photon/*.photon.ts .

# 2. Generate marketplace manifest
photon marketplace init --name company-mcps --description "Company MCPs"

# 3. Push to GitHub
git init
git add .
git commit -m "Initial marketplace"
git push origin main

# 4. Share with team
# Team members run: photon marketplace add company/mcps
```

### Manage Marketplaces

```bash
# List all marketplaces
photon marketplace list

# Add marketplace - Multiple formats supported:

# 1. GitHub shorthand
photon marketplace add username/my-photons

# 2. GitHub HTTPS
photon marketplace add https://github.com/username/my-photons

# 3. GitHub SSH
photon marketplace add git@github.com:username/my-photons.git

# 4. Direct URL
photon marketplace add https://example.com/photons

# 5. Local filesystem path
photon marketplace add ./my-local-photons
photon marketplace add ~/Documents/my-photons

# Remove marketplace
photon marketplace remove my-photons

# Search across all marketplaces
photon search github
```

### Marketplace Structure

```
repo/
├── .marketplace/
│   └── photons.json          # Marketplace manifest
├── calculator.photon.ts       # Photon files in root
├── weather.photon.ts
└── github-issues.photon.ts
```

**Manifest Format (`.marketplace/photons.json`):**
```json
{
  "name": "my-photons",
  "description": "Collection of useful Photons",
  "photons": [
    {
      "name": "calculator",
      "version": "1.0.0",
      "description": "Basic arithmetic operations",
      "source": "../calculator.photon.ts",
      "hash": "sha256:abc123...",
      "tools": ["add", "subtract", "multiply", "divide"]
    }
  ]
}
```

### Metadata and Integrity

Photon tracks installation metadata for each Photon:

```bash
# View metadata
photon get github-issues

# Output shows:
# Version: 1.0.0
# Marketplace: photons (https://github.com/portel-dev/photons)
# Installed: 1/1/2025
# Status: ⚠️ Modified locally  # If you edited the file
```

**Features:**
- **Version tracking** - Know which version you have installed
- **Modification detection** - SHA-256 hash comparison alerts you to local changes
- **Marketplace attribution** - See where each Photon came from
- **Integrity verification** - Detect tampering or corruption

---

## Writing Photon MCPs

### Basic Structure

```typescript
export default class MyMCP {
  /**
   * Echo a message
   * @param message The message to echo
   */
  async echo(params: { message: string }) {
    return `Echo: ${params.message}`;
  }
}
```

### Configuration via Constructor

Constructor parameters automatically map to **environment variables**:

```typescript
export default class Filesystem {
  constructor(
    private workdir: string = join(homedir(), 'Documents'),
    private maxFileSize: number = 10485760,
    private allowHidden: boolean = false
  ) {
    // Validate configuration
    if (!existsSync(workdir)) {
      throw new Error(`Working directory does not exist: ${workdir}`);
    }
  }
}
```

**Environment Variable Mapping:**

| Constructor Parameter | Environment Variable |
|-----------------------|----------------------|
| `workdir` | `FILESYSTEM_WORKDIR` |
| `maxFileSize` | `FILESYSTEM_MAX_FILE_SIZE` |
| `allowHidden` | `FILESYSTEM_ALLOW_HIDDEN` |

### Lifecycle Hooks (Optional)

```typescript
export default class MyMCP {
  /**
   * Called when MCP is loaded
   */
  async onInitialize() {
    console.error('Initialized');
  }

  /**
   * Called when MCP is shutting down
   */
  async onShutdown() {
    console.error('Shutting down');
  }

  async myTool(params: { input: string }) {
    return `Processed: ${params.input}`;
  }
}
```

### Return Values

Photon accepts multiple return formats:

```typescript
// String
async tool1(params: {}) {
  return "Result as string";
}

// Object (will be JSON stringified)
async tool2(params: {}) {
  return { result: 42, status: "ok" };
}

// Success/content format
async tool3(params: {}) {
  return {
    success: true,
    content: "Tool executed successfully"
  };
}

// Success/error format
async tool4(params: {}) {
  return {
    success: false,
    error: "Something went wrong"
  };
}
```

### Templates (MCP Prompts)

Templates are reusable text generation patterns with variable substitution:

```typescript
import { Template, asTemplate } from '@portel/photon';

export default class MyMCP {
  /**
   * Generate a code review prompt
   * @Template
   * @param language Programming language
   * @param code Code to review
   */
  async codeReview(params: { language: string; code: string }): Promise<Template> {
    const prompt = `Review this ${params.language} code:\n\`\`\`\n${params.code}\n\`\`\``;
    return asTemplate(prompt);
  }
}
```

### Static Resources (MCP Resources)

Static resources expose read-only content and data:

```typescript
import { Static, asStatic } from '@portel/photon';

export default class MyMCP {
  /**
   * Get API documentation
   * @Static api://docs
   * @mimeType text/markdown
   */
  async apiDocs(params: {}): Promise<Static> {
    const docs = `# API Documentation\n\n...`;
    return asStatic(docs);
  }

  /**
   * Get README for a project type
   * @Static readme://{projectType}
   * @mimeType text/markdown
   * @param projectType Type of project (api, library, cli)
   */
  async readme(params: { projectType: string }): Promise<Static> {
    const content = `# ${params.projectType} Project\n\n...`;
    return asStatic(content);
  }
}
```

### Auto-Dependencies

Dependencies are **auto-installed** from JSDoc tags:

```typescript
/**
 * Fetch MCP - HTTP client utilities
 * @dependencies axios@^1.6.0
 */
import axios from 'axios';

export default class FetchMCP {
  async fetch(params: { url: string }) {
    const response = await axios.get(params.url);
    return response.data;
  }
}
```

**How it works:**
- Photon parses `@dependencies` tags from JSDoc comments
- Auto-installs to `~/.cache/photon-mcp/dependencies/{mcp-name}/`
- Works like `npx` - zero manual setup
- Cached per MCP, isolated from other MCPs

### Private Methods

Methods starting with `_` are private and won't become tools:

```typescript
export default class MyMCP {
  // Public tool
  async publicTool(params: {}) {
    return this._helperMethod();
  }

  // Private helper (NOT a tool)
  async _helperMethod() {
    return "This won't be exposed as a tool";
  }
}
```

---

## Examples

The repository includes example Photon MCPs:

### Content (Templates & Static)

```bash
npx photon --working-dir examples mcp content --dev
```

Demonstrates Templates (MCP Prompts) and Static resources (MCP Resources):
- **Templates**: `codeReview`, `prDescription`, `commitPrompt`
- **Statics**: `apiDocs`, `configReference`, `readmeTemplate`
- **Tools**: `wordCount`

### Calculator

```bash
npx photon --working-dir examples mcp math --dev
```

Basic arithmetic operations: `add`, `subtract`, `multiply`, `divide`, `power`

### String Utilities

```bash
npx photon --working-dir examples mcp text --dev
```

Text manipulation: `uppercase`, `lowercase`, `slugify`, `reverse`, `wordCount`, `split`, `replace`, `titleCase`, `substring`

### Workflow

```bash
npx photon --working-dir examples mcp workflow --dev
```

Task management: `list`, `get`, `create`, `updateStatus`, `delete`, `validate`

---

## The Promise

**When you use Photon:**

1. **You write:** Business logic only
2. **Photon provides:** MCP infrastructure
3. **You maintain:** Your domain code
4. **Photon handles:** Protocol, schemas, runtime
5. **You own:** Simple, readable files
6. **Photon enables:** Distribution, versioning, tooling

**Separation of concerns:**
- **Your expertise:** Business domain
- **Photon's expertise:** MCP infrastructure

---

## Philosophy

**Photon's contract with you:**

✅ **You write:**
- Business logic
- Domain code
- API integrations
- Data transformations

❌ **You don't write:**
- Server boilerplate
- Protocol handling
- Schema definitions
- Build configurations
- Tool registration
- Transport setup

**We handle the MCP infrastructure. You handle the business value.**

---

## FAQ

### Do I need to extend a base class?

No! Just export any class with async methods. Optionally, you can extend `PhotonMCP` for helper methods, but it's not required.

### How are parameters validated?

Photon extracts JSON schemas from your TypeScript types. MCP clients validate parameters before calling your tools.

### Can I use external packages?

Yes! Dependencies are **auto-installed** from JSDoc tags. No manual `npm install` needed.

### How does hot reload work?

In `--dev` mode, Photon watches your `.photon.ts` file. When you save changes:
1. File is recompiled with esbuild
2. Class is reloaded
3. Schemas are re-extracted
4. Server continues running with new code

### Where are compiled files cached?

`~/.cache/photon-mcp/compiled/`

Cache is content-based—if you edit your file, a new cache entry is created.

### Where are my Photons stored?

**Default location:** `~/.photon/`
- Created with: `photon init calculator`
- Accessible from anywhere: `photon mcp calculator --dev`

**Custom location:** Use `--working-dir`
- Create: `photon --working-dir ./mcps init tool`
- Run: `photon --working-dir ./mcps mcp tool --dev`

---

## Architecture

```
┌─────────────────┐
│ .photon.ts file │
└────────┬────────┘
         │
         ↓
   ┌─────────────┐
   │   Loader    │ ← Compiles TypeScript with esbuild
   └─────┬───────┘   Loads class dynamically
         │
         ↓
 ┌──────────────────┐
 │ Schema Extractor │ ← Parses JSDoc + TypeScript types
 └────────┬─────────┘   Generates JSON schemas
          │
          ↓
  ┌───────────────┐
  │  MCP Server   │ ← Implements MCP protocol
  └───────┬───────┘   Using @modelcontextprotocol/sdk
          │
          ↓
  ┌──────────────┐
  │ stdio/JSON-RPC│ ← Communicates with MCP clients
  └──────────────┘   (Claude Desktop, Cursor, etc.)
```

---

## Contributing

Contributions welcome! Please open issues and PRs at [github.com/portel-dev/photon-mcp](https://github.com/portel-dev/photon-mcp).

---

## License

MIT © Portel

---

## Related Projects

- **NCP** - MCP orchestration platform that uses Photon for internal MCPs
- **@modelcontextprotocol/sdk** - Official MCP TypeScript SDK

---

**Made with ⚛️ by Portel**

**Stop writing infrastructure. Start writing business logic.**

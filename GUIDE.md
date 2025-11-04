# Photon MCP Developer Guide

Complete guide to creating Model Context Protocol servers using Photon.

## Table of Contents

1. [Core Concepts](#core-concepts)
2. [File Structure](#file-structure)
3. [Class Conventions](#class-conventions)
4. [Parameter Types](#parameter-types)
5. [Return Values](#return-values)
6. [Lifecycle Hooks](#lifecycle-hooks)
7. [Error Handling](#error-handling)
8. [Testing](#testing)
9. [Best Practices](#best-practices)
10. [Publishing](#publishing)

## Core Concepts

Photon follows the **convention over configuration** philosophy. Write TypeScript, get an MCP server.

### The Photon Pattern

```typescript
// filename.photon.ts
export default class ToolName {
  async methodName(params: { param: type }) {
    return result;
  }
}
```

That's it! No configuration files, no decorators, no setup.

## File Structure

### Minimal Example

```
my-tool.photon.ts          ← Your MCP implementation
```

### With Pre-generated Schema (Optional)

```
my-tool.photon.ts          ← Your implementation
my-tool.photon.schema.json ← Pre-generated schemas
```

### With Dependencies

```
my-tool.photon.ts          ← Your implementation
package.json               ← Dependencies
node_modules/              ← Installed packages
```

## Class Conventions

### Naming

**Class name becomes MCP name (kebab-case):**

```typescript
class Calculator        → "calculator"
class StringUtils       → "string-utils"
class MyAwesomeTool     → "my-awesome-tool"
class GitHubMCP         → "git-hub"  (MCP suffix removed)
```

### Export

**Always use default export:**

```typescript
// ✅ Good
export default class MyTool { }

// ❌ Bad (won't be detected)
export class MyTool { }
```

### Methods

**Public async methods become tools:**

```typescript
export default class Tools {
  // ✅ Public async → Tool
  async publicTool(params: {}) { }

  // ❌ Not async → Not a tool
  syncMethod(params: {}) { }

  // ❌ Private → Not a tool
  async _privateHelper(params: {}) { }

  // ❌ Lifecycle hook → Not a tool
  async onInitialize() { }
}
```

## Parameter Types

### Basic Types

```typescript
async example(params: {
  text: string;        // → { type: "string" }
  count: number;       // → { type: "number" }
  enabled: boolean;    // → { type: "boolean" }
  data: any;           // → { } (no type constraint)
}) { }
```

### Optional Parameters

```typescript
async example(params: {
  required: string;
  optional?: string;   // → not in "required" array
}) { }
```

### Arrays

```typescript
async example(params: {
  tags: string[];              // → { type: "array", items: { type: "string" } }
  numbers: Array<number>;      // → { type: "array", items: { type: "number" } }
}) { }
```

### Objects

```typescript
async example(params: {
  config: {
    host: string;
    port: number;
  };
}) {
  // Access: params.config.host
}
```

### Union Types

```typescript
async example(params: {
  value: string | number;  // → { anyOf: [{ type: "string" }, { type: "number" }] }
}) { }
```

### JSDoc Descriptions

```typescript
/**
 * Process user data
 * @param name User's full name
 * @param age User's age in years
 * @param email User's email address (optional)
 */
async processUser(params: {
  name: string;
  age: number;
  email?: string;
}) { }
```

Results in schema:

```json
{
  "name": "processUser",
  "description": "Process user data",
  "inputSchema": {
    "type": "object",
    "properties": {
      "name": {
        "type": "string",
        "description": "User's full name"
      },
      "age": {
        "type": "number",
        "description": "User's age in years"
      },
      "email": {
        "type": "string",
        "description": "User's email address (optional)"
      }
    },
    "required": ["name", "age"]
  }
}
```

## Return Values

Photon accepts multiple return formats:

### 1. String

```typescript
async greet(params: { name: string }) {
  return `Hello, ${params.name}!`;
}
```

### 2. Object (auto-serialized)

```typescript
async getData(params: {}) {
  return {
    timestamp: new Date().toISOString(),
    value: 42,
    items: [1, 2, 3]
  };
}
```

### 3. Success/Content Format

```typescript
async process(params: { input: string }) {
  return {
    success: true,
    content: "Processing completed successfully"
  };
}
```

### 4. Success/Error Format

```typescript
async validate(params: { value: number }) {
  if (value < 0) {
    return {
      success: false,
      error: "Value must be positive"
    };
  }

  return {
    success: true,
    content: "Validation passed"
  };
}
```

### 5. Throwing Errors

```typescript
async divide(params: { a: number; b: number }) {
  if (params.b === 0) {
    throw new Error("Division by zero");
  }

  return params.a / params.b;
}
```

## Lifecycle Hooks

### onInitialize

Called once when the MCP loads:

```typescript
export default class MyMCP {
  private connection: any;

  async onInitialize() {
    this.connection = await connectToDatabase();
    console.error('[my-mcp] Connected to database');
  }

  async query(params: { sql: string }) {
    return this.connection.execute(params.sql);
  }
}
```

### onShutdown

Called when the MCP is shutting down:

```typescript
export default class MyMCP {
  private connection: any;

  async onShutdown() {
    await this.connection.close();
    console.error('[my-mcp] Disconnected from database');
  }
}
```

## Error Handling

### Try-Catch Pattern

```typescript
async fetchData(params: { url: string }) {
  try {
    const response = await fetch(params.url);
    const data = await response.json();

    return {
      success: true,
      content: JSON.stringify(data)
    };
  } catch (error: any) {
    return {
      success: false,
      error: `Failed to fetch: ${error.message}`
    };
  }
}
```

### Validation Pattern

```typescript
async updateUser(params: { id: string; name: string }) {
  // Validate input
  if (!params.id) {
    return { success: false, error: "User ID is required" };
  }

  if (params.name.length < 2) {
    return { success: false, error: "Name must be at least 2 characters" };
  }

  // Process
  // ...

  return { success: true, content: "User updated" };
}
```

## Testing

### 1. Validate Your MCP

```bash
npx photon validate my-tool
```

This checks:
- ✅ File compiles successfully
- ✅ Class is detected
- ✅ Tools are discovered
- ✅ Schemas are extracted

**Note:** The `.photon.ts` extension is optional—Photon will find it automatically.

### 2. Run in Dev Mode

```bash
npx photon my-tool --dev
```

Edit your file and watch it reload automatically.

### 3. Test with MCP Inspector

Use the MCP Inspector tool to test your tools interactively:

```bash
npm install -g @modelcontextprotocol/inspector
mcp-inspector npx @portel/photon my-tool
```

### 4. Unit Testing

```typescript
// my-tool.test.ts
import MyTool from './my-tool.photon.js';

const tool = new MyTool();
await tool.onInitialize?.();

// Test a method
const result = await tool.add({ a: 2, b: 3 });
console.assert(result === 5, 'Addition should work');
```

## Best Practices

### 1. Use Descriptive Names

```typescript
// ✅ Good
async fetchUserProfile(params: { userId: string }) { }
async calculateTotal(params: { items: number[] }) { }

// ❌ Bad
async doIt(params: { data: any }) { }
async process(params: { x: any }) { }
```

### 2. Write Clear JSDoc

```typescript
/**
 * Fetch and parse RSS feed
 * @param url RSS feed URL (must be valid HTTP/HTTPS)
 * @param maxItems Maximum items to return (default: 10)
 */
async parseFeed(params: { url: string; maxItems?: number }) { }
```

### 3. Validate Inputs

```typescript
async processFile(params: { path: string }) {
  if (!params.path) {
    throw new Error("File path is required");
  }

  if (!params.path.endsWith('.json')) {
    throw new Error("Only JSON files are supported");
  }

  // Process...
}
```

### 4. Use TypeScript Types

```typescript
// ✅ Good - specific types
async updateConfig(params: {
  environment: 'dev' | 'staging' | 'prod';
  port: number;
  features: string[];
}) { }

// ❌ Bad - vague types
async updateConfig(params: {
  environment: string;
  port: any;
  features: any;
}) { }
```

### 5. Keep Methods Focused

```typescript
// ✅ Good - single responsibility
async fetchData(params: { url: string }) { }
async parseData(params: { raw: string }) { }
async saveData(params: { data: any }) { }

// ❌ Bad - does too much
async fetchParseAndSave(params: { url: string }) { }
```

### 6. Use Consistent Return Format

```typescript
// Pick one format and stick with it
export default class MyMCP {
  async tool1(params: {}) {
    return { success: true, content: "..." };
  }

  async tool2(params: {}) {
    return { success: true, content: "..." };
  }

  async tool3(params: {}) {
    return { success: false, error: "..." };
  }
}
```

## Publishing

### 1. Test Thoroughly

```bash
npx photon validate my-tool.photon.ts
npx photon my-tool.photon.ts --dev  # Test interactively
```

### 2. Add to GitHub

```bash
git init
git add my-tool.photon.ts
git commit -m "feat: add my-tool MCP"
git remote add origin https://github.com/username/my-tool-mcp.git
git push -u origin main
```

### 3. Publish to npm (Optional)

Create a package.json:

```json
{
  "name": "my-tool-mcp",
  "version": "1.0.0",
  "description": "My awesome Photon MCP",
  "main": "my-tool.photon.ts",
  "keywords": ["mcp", "photon", "my-tool"],
  "author": "Your Name",
  "license": "MIT"
}
```

Publish:

```bash
npm publish
```

Users can then run:

```bash
npx @portel/photon node_modules/my-tool-mcp/my-tool.photon.ts
```

Or if they have Photon installed globally:

```bash
photon node_modules/my-tool-mcp/my-tool.photon.ts
```

### 4. Share on MCP Registry

Submit your MCP to the community registry at [mcphub.io](https://mcphub.io).

## Examples

Check the `examples/` directory for complete working examples:

- **calculator.photon.ts** - Basic arithmetic
- **string.photon.ts** - Text manipulation
- **workflow.photon.ts** - Task management

## Troubleshooting

### "No MCP class found"

Make sure you're using `export default`:

```typescript
// ✅
export default class MyTool { }

// ❌
export class MyTool { }
```

### "No tools found"

Make sure methods are async:

```typescript
// ✅
async myTool(params: {}) { }

// ❌
myTool(params: {}) { }  // Not async
```

### Schemas not extracting

Check JSDoc format:

```typescript
// ✅ Correct format
/**
 * Tool description
 * @param name Parameter description
 */
async tool(params: { name: string }) { }

// ❌ Wrong format
// Tool description
async tool(params: { name: string }) { }
```

### TypeScript compilation errors

Run with `--verbose` to see full stack trace:

```bash
npx photon my-tool.photon.ts --verbose
```

## Next Steps

1. **Read the README** - Overview and quick start
2. **Check examples/** - Working Photon MCPs
3. **Join the community** - Share your MCPs
4. **Contribute** - PRs welcome!

---

Happy building! 🚀

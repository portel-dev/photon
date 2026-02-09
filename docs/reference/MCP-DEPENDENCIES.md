# MCP Dependencies: Consuming External MCPs

Photons can consume external MCP servers at runtime, enabling powerful orchestration workflows that combine multiple MCPs written in any language (Python, Rust, Go, Node.js, etc.).

## Overview

The `this.mcp('name')` method returns a proxy client that can:
- Call tools directly on external MCPs
- List available tools
- Search for tools by name

This feature enables polyglot MCP architectures where your photon orchestrates MCPs regardless of their implementation language.

## Basic Usage

### Calling an External MCP

```typescript
export default class Orchestrator {
  /**
   * Search using Tavily MCP
   */
  async search({ query }: { query: string }) {
    const tavily = this.mcp('tavily');
    const results = await tavily.tavily_search({ query, max_results: 5 });
    return results;
  }
}
```

### Available Methods

The MCP client proxy supports three operations:

| Method | Description | Example |
|--------|-------------|---------|
| `client.<tool>(params)` | Call a tool directly | `await this.mcp('tavily').tavily_search({ query: 'test' })` |
| `client.list()` | List all available tools | `await this.mcp('tavily').list()` |
| `client.find(query)` | Search tools by name | `await this.mcp('tavily').find('search')` |
| `client.call(name, params)` | Call tool by name string | `await this.mcp('tavily').call('tavily_search', { query: 'test' })` |

## Discovery and Inspection

### Listing Available Tools

```typescript
async discoverMCPs({ mcpNames }: { mcpNames?: string } = {}) {
  const names = mcpNames?.split(',').map(n => n.trim())
    ?? ['tavily', 'browser', 'sequential-thinking'];

  const statuses = [];
  for (const name of names) {
    try {
      const client = this.mcp(name);
      const tools = await client.list();
      statuses.push({
        name,
        available: true,
        tools: tools.map(t => t.name)
      });
    } catch (error) {
      statuses.push({
        name,
        available: false,
        error: error.message
      });
    }
  }
  return statuses;
}
```

### Searching for Tools

```typescript
async findToolsAcrossMCPs({ query }: { query: string }) {
  const mcps = ['tavily', 'browser', 'shell'];
  const results = [];

  for (const name of mcps) {
    try {
      const client = this.mcp(name);
      const tools = await client.find(query);
      if (tools?.length > 0) {
        results.push({ mcp: name, tools });
      }
    } catch {
      // Skip unavailable MCPs
    }
  }
  return results;
}
```

## Orchestration Patterns

### Research Workflow

Combine search and browser MCPs to research a topic:

```typescript
async researchWorkflow({
  query,
  fetchContent = false
}: {
  query: string;
  fetchContent?: boolean;
}) {
  const workflow = { steps: [], errors: [] };

  // Step 1: Search
  try {
    const tavily = this.mcp('tavily');
    const searchResult = await tavily.tavily_search({ query, max_results: 5 });
    workflow.steps.push({ name: 'Search', mcp: 'tavily', result: searchResult });
  } catch (error) {
    workflow.errors.push(`Search failed: ${error.message}`);
  }

  // Step 2: Optionally fetch content
  if (fetchContent && workflow.steps[0]?.result?.results?.[0]?.url) {
    try {
      const browser = this.mcp('browser');
      const url = workflow.steps[0].result.results[0].url;
      const pageResult = await browser.browser_navigate({ url });
      workflow.steps.push({ name: 'Fetch', mcp: 'browser', result: pageResult });
    } catch (error) {
      workflow.errors.push(`Fetch failed: ${error.message}`);
    }
  }

  return workflow;
}
```

### Parallel Execution

Execute multiple MCP calls concurrently:

```typescript
async parallelExecution({ mcpCalls }: { mcpCalls: string }) {
  const calls = JSON.parse(mcpCalls) as Array<{
    mcp: string;
    tool: string;
    params?: any;
  }>;

  const promises = calls.map(async (call) => {
    try {
      const client = this.mcp(call.mcp);
      const result = await client.call(call.tool, call.params || {});
      return { call: `${call.mcp}.${call.tool}`, success: true, result };
    } catch (error) {
      return { call: `${call.mcp}.${call.tool}`, success: false, error: error.message };
    }
  });

  return Promise.all(promises);
}
```

### Chained Workflow

Pipe output from one MCP to another:

```typescript
async chainedWorkflow({ steps }: { steps: string }) {
  const stepDefs = JSON.parse(steps) as Array<{
    mcp: string;
    tool: string;
    params?: any;
    outputKey?: string;
    inputFrom?: string;
  }>;

  const context: Record<string, any> = {};

  for (const step of stepDefs) {
    let params = { ...step.params };

    // Inject previous output
    if (step.inputFrom && context[step.inputFrom]) {
      params = { ...params, input: context[step.inputFrom] };
    }

    try {
      const client = this.mcp(step.mcp);
      const result = await client.call(step.tool, params);

      if (step.outputKey) {
        context[step.outputKey] = result;
      }
    } catch (error) {
      throw new Error(`${step.mcp}.${step.tool} failed: ${error.message}`);
    }
  }

  return context;
}
```

## Error Handling

Always handle MCP availability gracefully:

```typescript
async checkMCP({ mcpName }: { mcpName: string }) {
  try {
    const client = this.mcp(mcpName);
    const tools = await client.list();
    return {
      name: mcpName,
      available: true,
      tools: tools.map(t => t.name)
    };
  } catch (error) {
    return {
      name: mcpName,
      available: false,
      error: error.message
    };
  }
}
```

## Runtime Requirements

The `this.mcp()` method requires an MCP client factory to be injected. This is automatically provided when running photons in:

| Runtime | MCP Dependencies | Notes |
|---------|------------------|-------|
| **NCP** | ✅ Full support | MCPs configured in NCP profile are available |
| **Beam** | ❌ Not available | Use `@mcp` declarations instead |
| **CLI** | ❌ Not available | Use `@mcp` declarations instead |

### Using with NCP

When running in NCP, configure your MCPs in your NCP profile and they become available via `this.mcp()`:

```json
{
  "mcps": {
    "tavily": {
      "command": "npx",
      "args": ["-y", "@anthropic/mcp-server-tavily"]
    },
    "browser": {
      "command": "npx",
      "args": ["-y", "@anthropic/mcp-server-browser"]
    }
  }
}
```

## Comparison: `@mcp` vs `this.mcp()`

| Feature | `@mcp` Declaration | `this.mcp()` Runtime |
|---------|-------------------|---------------------|
| Syntax | JSDoc tag | Method call |
| Resolved | Compile time | Runtime |
| Injected as | Class property | Method call |
| Available in | All runtimes | NCP only |
| Use case | Static dependencies | Dynamic orchestration |

**`@mcp` Declaration (compile-time):**
```typescript
/**
 * @mcp github anthropics/mcp-server-github
 */
export default class MyPhoton {
  async useGitHub() {
    // this.github is auto-injected
    return await this.github.list_issues({ repo: 'owner/repo' });
  }
}
```

**`this.mcp()` Runtime (dynamic):**
```typescript
export default class Orchestrator {
  async callAnyMCP({ mcpName, toolName, params }: {...}) {
    // Dynamic - can call any configured MCP
    const client = this.mcp(mcpName);
    return await client.call(toolName, params);
  }
}
```

## Complete Example

See the [MCP Orchestrator example](https://github.com/portel-dev/photons/blob/main/mcp-orchestrator.photon.ts) for a comprehensive demonstration of all these patterns.

```typescript
/**
 * MCP Orchestrator Photon
 *
 * Demonstrates how to consume multiple MCPs written in any language
 * as dependencies and orchestrate workflows that combine their capabilities.
 *
 * @version 1.0.0
 * @tags orchestrator, mcp, workflow, integration, polyglot
 * @icon 🔗
 */
export default class MCPOrchestratorPhoton extends PhotonMCP {
  // Discovery, workflows, parallel execution, chaining...
}
```

## Best Practices

1. **Graceful Degradation**: Always handle MCP unavailability
2. **Timeout Handling**: Consider timeouts for slow MCPs
3. **Error Context**: Provide meaningful error messages
4. **Parallel When Possible**: Use `Promise.all()` for independent calls
5. **Document Dependencies**: List expected MCPs in your photon's JSDoc

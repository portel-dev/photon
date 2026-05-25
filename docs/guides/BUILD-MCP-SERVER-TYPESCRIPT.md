# Build an MCP Server in TypeScript

Photon lets you build a TypeScript MCP server from one `.photon.ts` file. You
write a class with methods, and Photon exposes those methods as MCP tools for
AI agents, a CLI command surface, and a Beam web dashboard.

If you want the lowest-boilerplate path from TypeScript code to an MCP server,
start here.

## Install Photon

```bash
bun add -g @portel/photon
```

Or run Photon without a global install:

```bash
bunx @portel/photon --help
```

Photon requires Node.js 20 or newer. Bun is the preferred package manager, and
`pnpm dlx` works for one-off runs.

## Create a TypeScript MCP Server

Create `todo.photon.ts`:

```typescript
export default class Todo {
  private items: { task: string; done: boolean }[] = [];

  /**
   * Add a task to the todo list
   * @param task Task to add {@example Buy milk}
   */
  add(params: { task: string }) {
    this.items.push({ task: params.task, done: false });
    return this.items;
  }

  /**
   * List all tasks
   * @format table
   * @readOnly
   */
  list() {
    return this.items;
  }
}
```

That file is the MCP server. Photon reads the class, method names, TypeScript
types, and JSDoc comments, then derives the MCP tool definitions.

## Run the MCP Server

```bash
photon mcp todo
```

Use the generated MCP configuration in Claude Desktop, Cursor, Claude Code, or
another MCP-compatible client.

For Claude Desktop, Photon can install the local MCP server configuration:

```bash
photon mcp install todo
```

Restart Claude Desktop after installation.

## Run the Same Code from CLI

The same TypeScript methods also become CLI commands:

```bash
photon cli todo add --task "Buy milk"
photon cli todo list
```

This is useful for testing, automation, demos, and scripts. You do not need a
separate command parser.

## Open the Web Dashboard

```bash
photon
```

Beam opens a web dashboard for the same photon. Method inputs become forms, and
return values render using Photon formats such as tables, cards, charts,
markdown, mermaid, and metrics.

## Why Use Photon Instead of Hand-Writing an MCP Server?

Use Photon when you want one TypeScript capability to be available across
multiple surfaces:

| You write | Photon derives |
|---|---|
| Method signatures | MCP tool names, inputs, and output shape |
| Type annotations | Input validation and form fields |
| JSDoc comments | AI-readable tool descriptions, CLI help, and UI labels |
| `@format` tags | Beam result renderers and CLI output hints |
| Settings | Runtime configuration tools and persisted values |

Hand-writing directly against the MCP TypeScript SDK is still useful when you
need total protocol control. Photon is optimized for the common case: define the
intent once, then run it through MCP, CLI, and web UI without boilerplate.

## Next Steps

| Goal | Read |
|---|---|
| Learn the full mental model | [Core Concepts](../concepts.md) |
| Add a custom UI | [Add a UI to an MCP Server](MCP-SERVER-UI.md) |
| See every docblock tag | [Docblock Tags](../reference/DOCBLOCK-TAGS.md) |
| Deploy a Photon MCP server | [Deployment](DEPLOYMENT.md) |
| Build a full chat app demo | [From Method to Chat App](../tutorials/from-method-to-chat-app.md) |

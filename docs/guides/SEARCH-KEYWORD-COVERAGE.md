# Search Keyword Coverage

This page tracks the search and answer-engine phrases Photon should cover in
public documentation. The goal is not to stuff keywords into pages. The goal is
to answer real developer questions with precise pages that search engines and AI
answer systems can quote.

Use the [Search Measurement Playbook](SEARCH-MEASUREMENT.md) to track Google
Search Console, Bing, and AI answer-engine performance against these clusters.

## Current Keyword Coverage

| Keyword cluster | Current coverage | Priority |
|---|---|---|
| `mcp server typescript` | [Build an MCP Server in TypeScript](BUILD-MCP-SERVER-TYPESCRIPT.md), [Getting Started](../getting-started.md) | High |
| `build mcp server` | [Build an MCP Server in TypeScript](BUILD-MCP-SERVER-TYPESCRIPT.md) | High |
| `typescript mcp server tutorial` | [Build an MCP Server in TypeScript](BUILD-MCP-SERVER-TYPESCRIPT.md), [From Method to Chat App](../tutorials/from-method-to-chat-app.md) | High |
| `mcp server ui` | [Add a UI to an MCP Server](MCP-SERVER-UI.md), [Custom UI Development Guide](CUSTOM-UI.md) | High |
| `mcp app ui` | [Add a UI to an MCP Server](MCP-SERVER-UI.md), [Custom UI Development Guide](CUSTOM-UI.md) | High |
| `chatgpt mcp ui` | [From Method to Chat App](../tutorials/from-method-to-chat-app.md), [Add a UI to an MCP Server](MCP-SERVER-UI.md) | High |
| `claude desktop mcp server` | [Getting Started](../getting-started.md), [Build an MCP Server in TypeScript](BUILD-MCP-SERVER-TYPESCRIPT.md) | Medium |
| `cursor mcp server` | [Getting Started](../getting-started.md), [Complete Developer Guide](../GUIDE.md) | Medium |
| `single file mcp server` | [Getting Started](../getting-started.md), [Build an MCP Server in TypeScript](BUILD-MCP-SERVER-TYPESCRIPT.md) | High |
| `mcp cli tool` | [Getting Started](../getting-started.md), [Build an MCP Server in TypeScript](BUILD-MCP-SERVER-TYPESCRIPT.md) | Medium |
| `mcp web dashboard` | [Add a UI to an MCP Server](MCP-SERVER-UI.md), [Output Formats](../formats.md) | Medium |
| `mcp output formats` | [Output Formats](../formats.md), [Docblock Tags](../reference/DOCBLOCK-TAGS.md) | Medium |
| `mcp docblock tags` | [Docblock Tags](../reference/DOCBLOCK-TAGS.md) | Medium |
| `photon mcp` | [Home](../../README.md), [Getting Started](../getting-started.md) | High |
| `.photon.ts` | [Getting Started](../getting-started.md), [Core Concepts](../concepts.md) | High |

## Gaps to Fill Next

| Missing page | Target searches | Why it matters |
|---|---|---|
| Photon vs MCP TypeScript SDK | `photon vs mcp typescript sdk`, `mcp sdk alternative`, `typescript mcp framework` | Captures developers choosing between low-level protocol control and Photon convention. |
| What is a `.photon.ts` file? | `.photon.ts`, `photon file`, `photon typescript file` | Owns Photon's product vocabulary before third-party pages define it. |
| Deploy a remote MCP server with Photon | `deploy mcp server`, `remote mcp server`, `mcp server cloudflare` | Deployment intent is high-value and already partially covered. |
| MCP server for ChatGPT developer mode | `chatgpt mcp server`, `chatgpt developer mode mcp`, `openai apps sdk mcp` | Photon has a strong weather proof here. |
| WebMCP docs site support | `webmcp`, `navigator.modelContext`, `web mcp docs` | The docs site now has browser-side WebMCP tools. |

## Keyword Principles

- Lead with the exact developer question in the page title.
- Answer in the first paragraph before explaining background.
- Include one working code example.
- Use Photon-specific phrasing only after the generic search phrase is covered.
- Link to deeper reference pages rather than repeating long reference content.
- Keep comparison pages honest: name when the low-level MCP SDK is a better fit.

## Not Worth Chasing Yet

| Keyword | Reason |
|---|---|
| `MCP` alone | Too broad and dominated by protocol-level pages. |
| `AI agents` alone | Too broad and not specific enough to Photon. |
| `automation` alone | Too generic; only target with Photon/MCP modifiers. |
| `developer tools` alone | Too broad for early docs discovery. |

## Recommended Next Pages

1. `docs/compare/PHOTON-VS-MCP-TYPESCRIPT-SDK.md`
2. `docs/concepts/PHOTON-TS-FILE.md`
3. `docs/guides/CHATGPT-MCP-SERVER.md`
4. `docs/guides/WEBMCP-DOCS-SITE.md`

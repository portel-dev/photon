---
title: Photon Documentation
description: Photon is an open source TypeScript runtime for building MCP servers, CLI tools, and web dashboards from one .photon.ts file.
layout: home

hero:
  name: Photon
  text: Single-file TypeScript runtime for MCP, CLI, and web UI
  tagline: Define a capability once. Photon exposes it to AI agents, command lines, embedded app UIs, and Beam.
  image:
    src: /assets/photon-logo.png
    alt: Photon logo
  actions:
    - theme: brand
      text: Get Started
      link: /docs/getting-started
    - theme: alt
      text: Method to Chat App
      link: /docs/tutorials/from-method-to-chat-app
    - theme: alt
      text: GitHub
      link: https://github.com/portel-dev/photon

features:
  - title: MCP server for AI agents
    details: Methods become typed MCP tools for Claude, ChatGPT, Cursor, and other MCP-compatible clients.
  - title: CLI and web UI from the same code
    details: Run the same photon from scripts, terminal workflows, and Beam without rewriting the interface.
  - title: Intent lives in TypeScript and JSDoc
    details: Method signatures, comments, tags, and types drive validation, forms, help text, and AI-readable contracts.
---

## Install

```bash
bun add -g @portel/photon
photon new my-tool
photon mcp install my-tool
```

Prefer a one-off run?

```bash
bunx @portel/photon new my-tool
```

## What Photon Builds

```ts
export default class Hello {
  greet(params: { name: string }) {
    return `Hello, ${params.name}!`;
  }
}
```

That one file can run as a CLI command, a Beam web dashboard, and an MCP server.

## Documentation Map

| Start here | |
|---|---|
| [Getting Started](/docs/getting-started) | Install, build, and run your first photon. |
| [Core Concepts](/docs/concepts) | Learn the mental model behind methods, comments, formats, state, settings, and surfaces. |
| [From Method to Chat App](/docs/tutorials/from-method-to-chat-app) | Follow the weather showcase across CLI, Beam, MCP, and embedded chat UI. |
| [Output Formats](/docs/formats) | Browse visual formats for tables, charts, cards, dashboards, markdown, and more. |
| [Docblock Tags](/docs/reference/DOCBLOCK-TAGS) | Reference every public docblock tag Photon understands. |
| [Complete Developer Guide](/docs/GUIDE) | Deep reference for authoring, deploying, and operating photons. |


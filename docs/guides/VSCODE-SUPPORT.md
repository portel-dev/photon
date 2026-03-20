# VS Code Support Plan

Photon now has two strong building blocks for IDE support:

- generated editor declarations in `.cache/photon-types/*.generated.d.ts`
- a Beam Studio TypeScript layer that already powers hover, definitions, references, rename, quick fixes, signature help, and outline navigation

This guide outlines the recommended path for first-class VS Code support without overcommitting to a full language server too early.

## Goals

- make `.photon.ts` files feel like normal TypeScript in VS Code
- preserve Photon's zero-boilerplate authoring model
- reuse Beam Studio logic instead of forking editor behavior
- ship a practical MVP quickly, then deepen language features incrementally

## Recommended Strategy

Start with a thin VS Code extension that leans on native TypeScript plus Photon's declaration-cache flow.

The fast path is:

1. treat `.photon.ts` as TypeScript
2. generate/update `.cache/photon-types/*.generated.d.ts` on open and save
3. add Photon-specific docblock/snippet completions
4. add a small set of Photon workbench commands

This gives users immediate help for:

- `this.assets(...)`
- `this.assetUrl(...)`
- `this.storage(...)`
- `this.memory`
- `this.caller`
- `this.schedule`

without requiring a custom language server on day one.

## Why Not Start With an LSP

Beam Studio already proves the underlying editor intelligence works, but a production-quality LSP is a larger commitment:

- process management
- request routing
- workspace graph sync
- diagnostics/completion parity across two editor stacks
- versioning and public API stability

The declaration-cache approach gives most of the practical value much faster.

## Phase 0: Extract Shared Editor Primitives

Before publishing an extension, move the reusable parts behind a stable shared surface.

Primary reuse targets:

- [`/Users/arul/Projects/photon/src/photon-editor-declarations.ts`](/Users/arul/Projects/photon/src/photon-editor-declarations.ts)
- [`/Users/arul/Projects/photon/src/auto-ui/streamable-http-transport.ts`](/Users/arul/Projects/photon/src/auto-ui/streamable-http-transport.ts)
- [`/Users/arul/Projects/photon/src/auto-ui/frontend/workers/photon-ts-worker.ts`](/Users/arul/Projects/photon/src/auto-ui/frontend/workers/photon-ts-worker.ts)
- [`/Users/arul/Projects/photon/src/auto-ui/frontend/components/docblock-completions.ts`](/Users/arul/Projects/photon/src/auto-ui/frontend/components/docblock-completions.ts)

The extraction targets should be:

- declaration generation
- support-file/project graph collection
- TypeScript worker request/response shapes
- Photon docblock tag catalogs as data, not Beam-only UI code

## Phase 1: MVP Extension

Ship a standard VS Code extension, not an LSP.

Responsibilities:

- activate on `**/*.photon.ts`
- regenerate Photon declaration cache on open/save
- ensure the workspace TypeScript project sees `.cache/photon-types/**/*.d.ts`
- provide Photon docblock completion/snippets
- add basic commands:
  - Open current photon in Beam
  - Create new photon from template
  - Regenerate Photon editor cache

Good sources to reuse:

- [`/Users/arul/Projects/photon/src/cli/commands/beam.ts`](/Users/arul/Projects/photon/src/cli/commands/beam.ts)
- [`/Users/arul/Projects/photon/templates/photon.template.ts`](/Users/arul/Projects/photon/templates/photon.template.ts)
- [`/Users/arul/Projects/photon/docs/reference/DOCBLOCK-TAGS.md`](/Users/arul/Projects/photon/docs/reference/DOCBLOCK-TAGS.md)

## Phase 2: Richer Language Features

After the MVP, add Photon-specific language intelligence by reusing the Beam worker logic in a Node-friendly form.

Features to add:

- go to definition across support files
- find references
- rename preview/apply across related files
- richer hover docs for Photon helpers and tags
- project-aware outline/navigation

The preferred implementation path is a shared Photon TypeScript service module used by:

- Beam Studio
- VS Code extension host
- future LSP or tsserver integration if needed

## Phase 3: Photon Workbench UX

Once authoring is solid, add Photon-native workspace experience:

- Photon explorer/tree view
- new photon wizard
- quick actions for common tags like `@ui`, `@worker`, `@auth`, `@dependencies`
- Beam launch/open actions
- optional side preview or embedded Beam webview

## MVP Boundary

The MVP should stop at:

- declaration cache generation
- native TypeScript integration
- Photon tag/snippet completion
- essential Photon commands

Do not make the MVP depend on Beam being open.

Do not start with a custom language server.

## Risks

- internal API drift if the extension reaches into Beam-only modules directly
- duplicate logic if docblock tags and TS worker behavior diverge between Beam and VS Code
- TypeScript project hygiene around generated cache files
- multi-file rename safety for support files

## Near-Term Implementation Backlog

1. extract shared Photon editor utilities from Beam internals
2. scaffold a `packages/vscode-photon` extension
3. hook declaration-cache generation into file open/save
4. add Photon docblock completions/snippets
5. add Beam/open/new/cache commands
6. port Beam TS worker logic into a reusable Node-side service
7. layer in definitions/references/rename

## Recommendation

Build the VS Code story the same way Photon evolved Beam Studio:

- first make TypeScript understand Photon runtime magic
- then add Photon-specific authoring affordances
- then deepen navigation and refactoring

That path gives users a credible editor experience quickly while keeping Beam and VS Code aligned instead of competing implementations.

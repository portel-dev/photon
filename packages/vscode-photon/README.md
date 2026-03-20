# Photon VS Code Extension

Thin VS Code support for `.photon.ts` authoring.

Current MVP:

- regenerates Photon editor declarations on open/save
- provides Photon docblock tag completions
- provides Photon runtime/code completions for helpers like `this.assets(...)`
- shows Photon diagnostics from the shared TS service
- shows hover info and go-to-definition for Photon-aware symbols
- adds find references and rename across the current photon and local support files
- offers quick fixes from the shared Photon TypeScript engine
- shows signature help for Photon-aware function and method calls
- feeds Photon-aware symbols into the VS Code Outline view and quick symbol picker
- caches imported support files so editor features stay responsive in larger photon workspaces
- opens the current photon in Beam
- creates a new photon from the built-in template

This package is intentionally thin and reuses the shared editor-support modules in the main Photon repo.

## Dogfooding

1. From the repo root, run `npm run build`.
2. From this folder, run `npm run build`.
3. Optional sanity check: run `npm run smoke`.
4. Open VS Code and use `Developer: Install Extension from Location...` on `packages/vscode-photon`.

For a slightly stronger package-level check, run `npm run regression`.

For extension-host dogfooding in this repo:

1. Open the repo in VS Code.
2. Run the `Run Photon Extension` launch config from `packages/vscode-photon/.vscode/launch.json`.
3. Open a `.photon.ts` file in the Extension Development Host window.

To build a `.vsix` for local testing:

1. From the repo root, run `npm run build`.
2. From this folder, run `npm run package`.

# Photon VS Code Extension

Thin VS Code support for `.photon.ts` authoring.

Current MVP:

- regenerates Photon editor declarations on open/save
- provides Photon docblock tag completions
- shows Photon diagnostics from the shared TS service
- shows hover info and go-to-definition for Photon-aware symbols
- adds find references and rename across the current photon and local support files
- offers quick fixes from the shared Photon TypeScript engine
- shows signature help for Photon-aware function and method calls
- feeds Photon-aware symbols into the VS Code Outline view and quick symbol picker
- opens the current photon in Beam
- creates a new photon from the built-in template

This package is intentionally thin and reuses the shared editor-support modules in the main Photon repo.

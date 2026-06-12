/**
 * Closed format-coverage registry
 *
 * One cell per (format, target). The Record over CanonicalFormat makes the
 * registry exhaustive at compile time: adding a value to photon-core's
 * OutputFormat without declaring how every target handles it fails tsc,
 * before any test runs. Removing a format from the type strands its entry
 * here and also fails tsc.
 *
 * Every cell is either a renderer (a real dispatch path in code) or an
 * explicit fallback (a documented downgrade) — there is no "absent" state,
 * which is what made silent drops possible. tests/contract/
 * format-coverage.test.ts cross-checks renderer cells against the actual
 * dispatch code so the registry cannot drift into fiction.
 *
 * Adding a new render target = adding it to RenderTarget, which forces a
 * decision for all 30 formats at once.
 */

import type { OutputFormat } from '@portel/photon-core';

/** Literal formats; chart:* and code:* variants dispatch through their base. */
export type CanonicalFormat = Exclude<OutputFormat, `chart:${string}` | `code:${string}`>;

export type RenderTarget = 'cli' | 'beam' | 'bridge';

export type TargetCoverage = { kind: 'renderer'; via: string } | { kind: 'fallback'; to: string };

const cliBase: TargetCoverage = { kind: 'renderer', via: '@portel/cli formatOutput' };
const cliRich: TargetCoverage = { kind: 'renderer', via: 'photon-cli-runner.ts rich mapping' };
const cliQr: TargetCoverage = { kind: 'renderer', via: 'loader.ts renderTerminalQR' };
const beamCase: TargetCoverage = {
  kind: 'renderer',
  via: 'result-viewer.ts switch(layout) case',
};
const beamJson: TargetCoverage = { kind: 'fallback', to: 'json (result-viewer default case)' };
// The bridge (generateRenderersScript, served to custom UIs) is a separate
// renderer set from Beam's result-viewer. Its dispatcher json-falls-back
// for unregistered formats; cells declare which side of that line each
// format is on. tests/contract/coverage-gate.test.ts cross-checks
// renderer cells against the actual generated script.
const bridgeFn: TargetCoverage = { kind: 'renderer', via: 'bridge renderers.ts registration' };
const bridgeJson: TargetCoverage = { kind: 'fallback', to: 'json (bridge dispatcher default)' };

export const FORMAT_COVERAGE: Record<CanonicalFormat, Record<RenderTarget, TargetCoverage>> = {
  primitive: { cli: cliBase, beam: beamJson, bridge: bridgeJson },
  table: { cli: cliBase, beam: beamCase, bridge: bridgeFn },
  tree: { cli: cliBase, beam: beamCase, bridge: bridgeFn },
  list: { cli: cliBase, beam: beamCase, bridge: bridgeFn },
  none: { cli: cliBase, beam: beamJson, bridge: bridgeJson },
  json: { cli: cliBase, beam: beamCase, bridge: bridgeFn },
  markdown: { cli: cliBase, beam: beamCase, bridge: bridgeFn },
  yaml: { cli: cliBase, beam: beamJson, bridge: bridgeJson },
  xml: { cli: cliBase, beam: beamJson, bridge: bridgeJson },
  html: { cli: cliBase, beam: beamCase, bridge: bridgeJson },
  code: { cli: cliBase, beam: beamJson, bridge: bridgeFn },
  mermaid: { cli: cliRich, beam: beamCase, bridge: bridgeJson },
  slides: { cli: cliRich, beam: beamCase, bridge: bridgeJson },
  card: { cli: cliBase, beam: beamCase, bridge: bridgeFn },
  grid: { cli: cliRich, beam: beamCase, bridge: bridgeJson },
  chips: { cli: cliRich, beam: beamCase, bridge: bridgeFn },
  kv: { cli: cliRich, beam: beamCase, bridge: bridgeFn },
  qr: { cli: cliQr, beam: beamCase, bridge: bridgeFn },
  chart: { cli: cliRich, beam: beamCase, bridge: bridgeFn },
  metric: { cli: cliRich, beam: beamCase, bridge: bridgeFn },
  gauge: { cli: cliRich, beam: beamCase, bridge: bridgeFn },
  timeline: { cli: cliRich, beam: beamCase, bridge: bridgeFn },
  dashboard: { cli: cliRich, beam: beamCase, bridge: bridgeJson },
  cart: { cli: cliRich, beam: beamCase, bridge: bridgeJson },
  panels: { cli: cliRich, beam: beamCase, bridge: bridgeJson },
  tabs: { cli: cliBase, beam: beamCase, bridge: bridgeFn },
  accordion: { cli: cliBase, beam: beamCase, bridge: bridgeFn },
  stack: { cli: cliRich, beam: beamCase, bridge: bridgeJson },
  columns: { cli: cliRich, beam: beamCase, bridge: bridgeJson },
  a2ui: { cli: cliRich, beam: beamCase, bridge: bridgeFn },
};

export const RENDER_TARGETS: RenderTarget[] = ['cli', 'beam'];

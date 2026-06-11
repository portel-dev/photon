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

export type RenderTarget = 'cli' | 'beam';

export type TargetCoverage = { kind: 'renderer'; via: string } | { kind: 'fallback'; to: string };

const cliBase: TargetCoverage = { kind: 'renderer', via: '@portel/cli formatOutput' };
const cliRich: TargetCoverage = { kind: 'renderer', via: 'photon-cli-runner.ts rich mapping' };
const cliQr: TargetCoverage = { kind: 'renderer', via: 'loader.ts renderTerminalQR' };
const beamCase: TargetCoverage = {
  kind: 'renderer',
  via: 'result-viewer.ts switch(layout) case',
};
const beamJson: TargetCoverage = { kind: 'fallback', to: 'json (result-viewer default case)' };

export const FORMAT_COVERAGE: Record<CanonicalFormat, Record<RenderTarget, TargetCoverage>> = {
  primitive: { cli: cliBase, beam: beamJson },
  table: { cli: cliBase, beam: beamCase },
  tree: { cli: cliBase, beam: beamCase },
  list: { cli: cliBase, beam: beamCase },
  none: { cli: cliBase, beam: beamJson },
  json: { cli: cliBase, beam: beamCase },
  markdown: { cli: cliBase, beam: beamCase },
  yaml: { cli: cliBase, beam: beamJson },
  xml: { cli: cliBase, beam: beamJson },
  html: { cli: cliBase, beam: beamCase },
  code: { cli: cliBase, beam: beamJson },
  mermaid: { cli: cliRich, beam: beamCase },
  slides: { cli: cliRich, beam: beamCase },
  card: { cli: cliBase, beam: beamCase },
  grid: { cli: cliRich, beam: beamCase },
  chips: { cli: cliRich, beam: beamCase },
  kv: { cli: cliRich, beam: beamCase },
  qr: { cli: cliQr, beam: beamCase },
  chart: { cli: cliRich, beam: beamCase },
  metric: { cli: cliRich, beam: beamCase },
  gauge: { cli: cliRich, beam: beamCase },
  timeline: { cli: cliRich, beam: beamCase },
  dashboard: { cli: cliRich, beam: beamCase },
  cart: { cli: cliRich, beam: beamCase },
  panels: { cli: cliRich, beam: beamCase },
  tabs: { cli: cliBase, beam: beamCase },
  accordion: { cli: cliBase, beam: beamCase },
  stack: { cli: cliRich, beam: beamCase },
  columns: { cli: cliRich, beam: beamCase },
  a2ui: { cli: cliRich, beam: beamCase },
};

export const RENDER_TARGETS: RenderTarget[] = ['cli', 'beam'];

/**
 * Drift sentinel for `methodToKebab` (Track C).
 *
 * The function lives in two places:
 *   1. `src/shared/expose-route-extractor.ts` — used by the local server's
 *      @expose dispatcher and by the deploy code-gen.
 *   2. Inline in `templates/cloudflare/worker.ts.template` — used by the
 *      generated Worker's @expose dispatcher (the template body is a
 *      string substitution into the bundled Worker, so we can't import).
 *
 * They MUST produce identical output for the same method names, otherwise
 * an @expose'd photon binds to one route locally and a different route on
 * Cloudflare. This test pulls the literal source out of the template and
 * exercises both implementations against the same inputs so a future
 * edit that lands in only one of the two definitions trips the gate.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { methodToKebab as sourceImpl } from '../src/shared/expose-route-extractor.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.resolve(
  __dirname,
  '..',
  'templates',
  'cloudflare',
  'worker.ts.template'
);

/**
 * Pull the body of the inline `methodToKebab` declaration out of the
 * template and eval it in a sandbox-friendly way. We grab from the
 * `function methodToKebab(` opener through the closing `}` so a future
 * change to the implementation lands here automatically.
 */
function extractTemplateMethodToKebab(): (name: string) => string {
  const source = fs.readFileSync(TEMPLATE_PATH, 'utf-8');
  const startMarker = 'function methodToKebab(name: string): string {';
  const startIdx = source.indexOf(startMarker);
  if (startIdx < 0) {
    throw new Error(
      "templates/cloudflare/worker.ts.template no longer contains 'function methodToKebab'"
    );
  }
  let depth = 0;
  let bodyEnd = -1;
  for (let i = startIdx + startMarker.length - 1; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) {
        bodyEnd = i + 1;
        break;
      }
    }
  }
  if (bodyEnd < 0) throw new Error('Unterminated methodToKebab in template');
  const decl = source.slice(startIdx, bodyEnd).replace(/: string/g, '');
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function(`${decl}; return methodToKebab;`)() as (name: string) => string;
}

describe('methodToKebab — template / source parity', () => {
  const templateImpl = extractTemplateMethodToKebab();

  // The exact set should cover what production photons hit: simple
  // camelCase, single-word lowercase, consecutive caps (acronyms).
  const PROBES = [
    'getCurrentUser',
    'listUsers',
    'addTask',
    'removeTask',
    'billing',
    'exportcalendar',
    'parseURL',
    'exportICalFeed',
  ];

  for (const probe of PROBES) {
    it(`${probe} produces identical output in both definitions`, () => {
      expect(templateImpl(probe)).toBe(sourceImpl(probe));
    });
  }

  it('reference photon @expose-tagged methods bind to the same path on both runtimes', () => {
    // The reference photon (examples/todo-app) declares these four
    // @expose methods. If the kebab outputs ever drift, the deployed
    // worker would 404 on /api/list-tasks while the local server still
    // routes it correctly.
    for (const name of ['addTask', 'listTasks', 'removeTask', 'search']) {
      expect(templateImpl(name)).toBe(sourceImpl(name));
    }
  });
});

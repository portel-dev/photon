/**
 * Format registry unit tests
 *
 * Plan reference: server-provided-what-a-reactive-globe.md → Track A.
 *
 * Covers register/lookup, MIME canonicalisation, parseAccept ordering,
 * negotiateAccept algorithm, and the explicit JSON-fallback contract.
 */

import { describe, it, expect } from 'vitest';
import { FormatRegistry, parseAccept, negotiateAccept } from '../src/format/registry.js';
import { seedDefaultFormats, getDefaultRegistry } from '../src/format/seed.js';

describe('FormatRegistry', () => {
  it('registers and looks up by name', () => {
    const r = new FormatRegistry();
    seedDefaultFormats(r);
    expect(r.get('json')?.httpMime).toBe('application/json');
    expect(r.get('html')?.httpMime).toBe('text/html');
  });

  it('canonicalises MIME → spec mapping; isCanonicalForMime wins', () => {
    const r = new FormatRegistry();
    seedDefaultFormats(r);
    // Both 'html' and 'table' declare httpMime 'text/html'. 'html' is canonical.
    const canonical = r.lookupByMime('text/html');
    expect(canonical?.name).toBe('html');
  });

  it('list() returns every registered spec', () => {
    const r = new FormatRegistry();
    seedDefaultFormats(r);
    const names = r
      .list()
      .map((s) => s.name)
      .sort();
    expect(names).toEqual(['csv', 'html', 'json', 'markdown', 'plain', 'table', 'xml', 'yaml']);
  });
});

describe('parseAccept', () => {
  it('returns */* when header is missing', () => {
    expect(parseAccept(undefined)).toEqual([{ mime: '*/*', q: 1 }]);
    expect(parseAccept(null)).toEqual([{ mime: '*/*', q: 1 }]);
  });

  it('orders by q descending, preserving input order on ties', () => {
    const result = parseAccept('text/csv;q=0.5, application/json, text/html;q=0.5');
    expect(result.map((e) => e.mime)).toEqual(['application/json', 'text/csv', 'text/html']);
  });

  it('clamps malformed q values to [0, 1]', () => {
    const result = parseAccept('text/plain;q=2, text/html;q=-1');
    expect(result[0].q).toBe(1);
    expect(result[1].q).toBe(0);
  });
});

describe('negotiateAccept', () => {
  const registry = getDefaultRegistry();

  it('Accept: text/html on tabular value renders HTML', () => {
    const out = negotiateAccept({
      accept: 'text/html',
      value: [{ name: 'Alice' }, { name: 'Bob' }],
      registry,
    });
    expect(out.mime).toContain('text/html');
    expect(out.body).toContain('<table>');
    expect(out.body).toContain('Alice');
  });

  it('Accept: application/json renders JSON', () => {
    const out = negotiateAccept({
      accept: 'application/json',
      value: { ok: true },
      registry,
    });
    expect(out.mime).toContain('application/json');
    expect(JSON.parse(out.body as string)).toEqual({ ok: true });
  });

  it('Accept: */* prefers declared @format', () => {
    const out = negotiateAccept({
      accept: '*/*',
      declaredFormat: 'markdown',
      value: '# hello',
      registry,
    });
    expect(out.mime).toContain('text/markdown');
    expect(out.body).toBe('# hello');
  });

  it('declared @format MIME match wins over JSON sibling', () => {
    const out = negotiateAccept({
      accept: 'text/markdown, application/json',
      declaredFormat: 'markdown',
      value: '# hello',
      registry,
    });
    expect(out.mime).toContain('text/markdown');
  });

  it('Accept: text/csv on a non-tabular value falls back to JSON', () => {
    const out = negotiateAccept({
      accept: 'text/csv',
      value: { not: 'tabular' },
      registry,
    });
    expect(out.mime).toContain('application/json');
    expect(JSON.parse(out.body as string)).toEqual({ not: 'tabular' });
  });

  it('Accept: text/csv on a tabular value renders CSV', () => {
    const out = negotiateAccept({
      accept: 'text/csv',
      value: [
        { a: 1, b: 2 },
        { a: 3, b: 4 },
      ],
      registry,
    });
    expect(out.mime).toContain('text/csv');
    expect(out.body).toBe('a,b\n1,2\n3,4\n');
  });

  it('unknown MIME with no declared format falls back to JSON (explicit fallback contract)', () => {
    const out = negotiateAccept({
      accept: 'application/x-unknown',
      value: { ok: true },
      registry,
    });
    expect(out.mime).toContain('application/json');
  });

  it('honours wildcards in Accept (text/*)', () => {
    const out = negotiateAccept({
      accept: 'text/*',
      declaredFormat: 'markdown',
      value: 'hello',
      registry,
    });
    expect(out.mime).toContain('text/');
  });
});

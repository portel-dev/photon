/**
 * @expose extractor unit tests
 *
 * Plan reference: server-provided-what-a-reactive-globe.md → Track C.
 *
 * Locks the parser shape so the dispatcher and the Cloudflare deploy
 * code-gen both see the same set of @expose'd methods.
 */

import { describe, it, expect } from 'vitest';
import { extractExposesFromSource, methodToKebab } from '../src/shared/expose-route-extractor.js';

describe('extractExposesFromSource', () => {
  it('captures @expose with no argument as private', () => {
    const src = `
      export default class C {
        /** @expose */
        async getCurrentUser() {}
      }
    `;
    expect(extractExposesFromSource(src)).toEqual([
      { handler: 'getCurrentUser', visibility: 'private' },
    ]);
  });

  it('captures @expose public as public visibility', () => {
    const src = `
      export default class C {
        /** @expose public */
        async billing() {}
      }
    `;
    expect(extractExposesFromSource(src)).toEqual([{ handler: 'billing', visibility: 'public' }]);
  });

  it('ignores methods without @expose', () => {
    const src = `
      export default class C {
        /** Listing helper. */
        async listUsers() {}
        /** @expose */
        async getCurrentUser() {}
      }
    `;
    expect(extractExposesFromSource(src).map((e) => e.handler)).toEqual(['getCurrentUser']);
  });

  it('captures multiple @expose declarations in declaration order', () => {
    const src = `
      export default class C {
        /** @expose */
        async first() {}
        /** @expose public */
        async second() {}
        /** @expose */
        async third() {}
      }
    `;
    expect(extractExposesFromSource(src)).toEqual([
      { handler: 'first', visibility: 'private' },
      { handler: 'second', visibility: 'public' },
      { handler: 'third', visibility: 'private' },
    ]);
  });

  it('survives JSDoc blocks that mention @expose in prose without the tag', () => {
    const src = `
      /**
       * This class is the @exposed surface — but does not declare @expose
       * on any method. The token \`@exposed\` must NOT trip the matcher.
       */
      export default class C {
        async listUsers() {}
      }
    `;
    expect(extractExposesFromSource(src)).toEqual([]);
  });

  it('treats unknown visibility argument as private (forward-compat)', () => {
    const src = `
      export default class C {
        /** @expose internal */
        async something() {}
      }
    `;
    expect(extractExposesFromSource(src)).toEqual([
      { handler: 'something', visibility: 'private' },
    ]);
  });

  it('respects access modifiers and async on the method declaration', () => {
    const src = `
      export default class C {
        /** @expose */
        public async first() {}
        /** @expose public */
        protected second() {}
      }
    `;
    expect(
      extractExposesFromSource(src)
        .map((e) => e.handler)
        .sort()
    ).toEqual(['first', 'second']);
  });
});

describe('methodToKebab', () => {
  it('converts camelCase to kebab-case', () => {
    expect(methodToKebab('getCurrentUser')).toBe('get-current-user');
    expect(methodToKebab('listUsers')).toBe('list-users');
  });

  it('passes lowercase methods through unchanged', () => {
    expect(methodToKebab('billing')).toBe('billing');
    expect(methodToKebab('exportcalendar')).toBe('exportcalendar');
  });

  it('handles consecutive capitals (acronyms) sensibly', () => {
    expect(methodToKebab('exportICalFeed')).toBe('export-i-cal-feed');
    expect(methodToKebab('parseURL')).toBe('parse-url');
  });
});

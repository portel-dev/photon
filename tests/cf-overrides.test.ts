/**
 * Unit tests for the CF override layer — `mergeBindings` and the loader's
 * override JSON read/write helpers.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { mergeBindings, type CfBindingsConfig } from '../src/runtime/cf-local.js';
import { PhotonLoader } from '../dist/loader.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('mergeBindings', () => {
  it('returns declared verbatim when override is null', () => {
    const declared: CfBindingsConfig = { kv: { cache: 'cache-id' } };
    expect(mergeBindings(declared, null)).toEqual(declared);
  });

  it('overrides a single named binding while preserving siblings', () => {
    const declared: CfBindingsConfig = {
      kv: { cache: 'dev-cache', sessions: 'dev-sessions' },
      r2: { photos: 'dev-photos' },
    };
    const override: CfBindingsConfig = { kv: { cache: 'prod-cache' } };
    expect(mergeBindings(declared, override)).toEqual({
      kv: { cache: 'prod-cache', sessions: 'dev-sessions' },
      r2: { photos: 'dev-photos' },
    });
  });

  it('overrides boolean opt-ins independently', () => {
    const declared: CfBindingsConfig = { ai: false, images: true };
    const override: CfBindingsConfig = { ai: true };
    expect(mergeBindings(declared, override)).toEqual({ ai: true, images: true });
  });

  it('adds a binding that was not declared', () => {
    const declared: CfBindingsConfig = { kv: { cache: 'cache-id' } };
    const override: CfBindingsConfig = { kv: { cache: 'cache-id', extra: 'extra-id' } };
    expect(mergeBindings(declared, override)).toEqual({
      kv: { cache: 'cache-id', extra: 'extra-id' },
    });
  });
});

describe('PhotonLoader CF override I/O', () => {
  const baseDir = path.join(os.tmpdir(), 'photon-cf-override-' + Date.now());
  const loader = new PhotonLoader(false, undefined, baseDir);

  afterAll(async () => {
    await fs.rm(baseDir, { recursive: true, force: true });
  });

  it('returns null when override file is missing', async () => {
    const got = await (loader as any).loadCfOverride('no-such-photon');
    expect(got).toBeNull();
  });

  it('round-trips save → load', async () => {
    const written: CfBindingsConfig = { kv: { cache: 'prod-cache' }, ai: true };
    const savedAt = await loader.saveCfOverride('round-trip', written);
    expect(savedAt).toContain('cf-overrides/round-trip.json');
    const got = await (loader as any).loadCfOverride('round-trip');
    expect(got).toEqual(written);
  });
});

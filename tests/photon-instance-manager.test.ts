/**
 * Tests for Global Photon Instance Manager
 * Verifies patch application, event emission, and global instance injection
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  PhotonSessionProxy,
  GlobalSessionManager,
  initializeGlobalPhotonSession,
  getGlobalSessionManager,
} from '../src/auto-ui/frontend/services/photon-instance-manager.js';

describe('PhotonSessionProxy', () => {
  let proxy: PhotonSessionProxy;

  beforeEach(() => {
    proxy = new PhotonSessionProxy({
      name: 'TestPhoton',
      initialState: {
        items: [],
        count: 0,
        metadata: { title: 'Test' },
      },
    });

    // Make properties accessible
    proxy.makeProperty('items');
    proxy.makeProperty('count');
    proxy.makeProperty('metadata');
  });

  it('stores initial state', () => {
    expect(proxy.state).toEqual({
      items: [],
      count: 0,
      metadata: { title: 'Test' },
    });
  });

  it('provides property access via descriptors', () => {
    expect(proxy.items).toEqual([]);
    expect(proxy.count).toEqual(0);
    expect(proxy.metadata).toEqual({ title: 'Test' });
  });

  it('applies add patch to array', async () => {
    return new Promise<void>((resolve) => {
      proxy.on('state-changed', (patches) => {
        expect(patches).toHaveLength(1);
        expect(patches[0].op).toBe('add');
        expect(proxy.items).toEqual([{ id: 1, name: 'Item 1' }]);
        resolve();
      });

      proxy.applyPatches([{ op: 'add', path: '/items/0', value: { id: 1, name: 'Item 1' } }]);
    });
  });

  it('applies remove patch to array', async () => {
    proxy = new PhotonSessionProxy({
      name: 'TestPhoton',
      initialState: {
        items: [{ id: 1 }, { id: 2 }, { id: 3 }],
      },
    });
    proxy.makeProperty('items');

    return new Promise<void>((resolve) => {
      proxy.on('state-changed', (patches) => {
        expect(patches).toHaveLength(1);
        expect(patches[0].op).toBe('remove');
        expect(proxy.items).toEqual([{ id: 1 }, { id: 3 }]);
        resolve();
      });

      proxy.applyPatches([{ op: 'remove', path: '/items/1' }]);
    });
  });

  it('applies replace patch', async () => {
    return new Promise<void>((resolve) => {
      proxy.on('state-changed', (patches) => {
        expect(patches).toHaveLength(1);
        expect(patches[0].op).toBe('replace');
        expect(proxy.count).toBe(42);
        resolve();
      });

      proxy.applyPatches([{ op: 'replace', path: '/count', value: 42 }]);
    });
  });

  it('applies nested object patches', async () => {
    return new Promise<void>((resolve) => {
      proxy.on('state-changed', (patches) => {
        expect(patches).toHaveLength(1);
        expect(proxy.metadata.title).toBe('Updated');
        resolve();
      });

      proxy.applyPatches([{ op: 'replace', path: '/metadata/title', value: 'Updated' }]);
    });
  });

  it('batches multiple patches into single event', async () => {
    return new Promise<void>((resolve) => {
      let eventCount = 0;
      proxy.on('state-changed', (patches) => {
        eventCount++;
        if (eventCount === 1) {
          expect(patches).toHaveLength(3);
          expect(proxy.items).toHaveLength(1);
          expect(proxy.count).toBe(1);
          resolve();
        }
      });

      proxy.applyPatches([
        { op: 'add', path: '/items/0', value: { id: 1 } },
        { op: 'replace', path: '/count', value: 1 },
        { op: 'replace', path: '/metadata/title', value: 'New' },
      ]);
    });
  });

  it('unescapes JSON Pointer paths', async () => {
    proxy = new PhotonSessionProxy({
      name: 'TestPhoton',
      initialState: {
        'key/with/slashes': 'value',
        'key~with~tildes': 'value',
      },
    });
    proxy.makeProperty('key/with/slashes');
    proxy.makeProperty('key~with~tildes');

    return new Promise<void>((resolve) => {
      proxy.on('state-changed', (patches) => {
        expect(patches).toHaveLength(2);
        expect((proxy as any)['key/with/slashes']).toBe('updated1');
        expect((proxy as any)['key~with~tildes']).toBe('updated2');
        resolve();
      });

      proxy.applyPatches([
        { op: 'replace', path: '/key~1with~1slashes', value: 'updated1' },
        { op: 'replace', path: '/key~0with~0tildes', value: 'updated2' },
      ]);
    });
  });

  it('tracks pagination state', () => {
    proxy.setPaginationState('items', { pageSize: 50, currentPage: 1, hasMore: true });

    const state = proxy.getPaginationState('items');
    expect(state.pageSize).toBe(50);
    expect(state.currentPage).toBe(1);
    expect(state.hasMore).toBe(true);
  });

  it('returns default pagination state for unknown properties', () => {
    const state = proxy.getPaginationState('unknown');
    expect(state.pageSize).toBe(20);
    expect(state.currentPage).toBe(0);
    expect(state.hasMore).toBe(true);
  });

  it('emits propertyChanged event on direct assignment', async () => {
    return new Promise<void>((resolve) => {
      proxy.on('propertyChanged', (event) => {
        expect(event.property).toBe('count');
        expect(event.value).toBe(99);
        resolve();
      });

      proxy.count = 99;
    });
  });

  it('handles copy patch operation', async () => {
    proxy = new PhotonSessionProxy({
      name: 'TestPhoton',
      initialState: {
        items: [{ id: 1, name: 'Original' }],
        backup: null,
      },
    });
    proxy.makeProperty('items');
    proxy.makeProperty('backup');

    return new Promise<void>((resolve) => {
      proxy.on('state-changed', (patches) => {
        expect(patches[0].op).toBe('copy');
        expect((proxy as any).backup).toEqual({ id: 1, name: 'Original' });
        resolve();
      });

      proxy.applyPatches([{ op: 'copy', from: '/items/0', path: '/backup' }]);
    });
  });

  it('resets state', () => {
    proxy.applyPatches([{ op: 'add', path: '/items/0', value: { id: 1 } }]);

    let resetEmitted = false;
    proxy.on('reset', () => {
      resetEmitted = true;
    });

    proxy.reset({ items: [], count: 0, metadata: {} });

    expect(proxy.items).toEqual([]);
    expect(resetEmitted).toBe(true);
  });
});

describe('GlobalSessionManager', () => {
  let manager: GlobalSessionManager;

  beforeEach(() => {
    manager = new GlobalSessionManager();
  });

  it('creates new instance', () => {
    const instance = manager.createOrGetSession('TestPhoton', { items: [] });

    expect(instance.name).toBe('TestPhoton');
    expect(instance.state).toEqual({ items: [] });
  });

  it('returns existing instance on subsequent calls', () => {
    const instance1 = manager.createOrGetSession('TestPhoton', { items: [] });
    const instance2 = manager.createOrGetSession('TestPhoton', { items: [1, 2, 3] });

    expect(instance1).toBe(instance2);
    expect(instance1.state).toEqual({ items: [] }); // Original state preserved
  });

  it('retrieves instance by name', () => {
    const created = manager.createOrGetSession('TestPhoton', { items: [] });
    const retrieved = manager.getSession('TestPhoton');

    expect(retrieved).toBe(created);
  });

  it('returns undefined for non-existent instance', () => {
    expect(manager.getSession('NonExistent')).toBeUndefined();
  });

  it('applies patches to instance', () => {
    const instance = manager.createOrGetSession('TestPhoton', { items: [] });
    instance.makeProperty('items');

    const result = manager.applyPatches('TestPhoton', [
      { op: 'add', path: '/items/0', value: { id: 1 } },
    ]);

    expect(result).toBe(true);
  });

  it('returns false when applying patches to non-existent instance', () => {
    const result = manager.applyPatches('NonExistent', [
      { op: 'add', path: '/items/0', value: { id: 1 } },
    ]);

    expect(result).toBe(false);
  });

  it('removes instance', () => {
    manager.createOrGetSession('TestPhoton', { items: [] });
    expect(manager.getSession('TestPhoton')).toBeDefined();

    manager.removeSession('TestPhoton');
    expect(manager.getSession('TestPhoton')).toBeUndefined();
  });

  it('lists all instance names', () => {
    manager.createOrGetSession('Photon1', { items: [] });
    manager.createOrGetSession('Photon2', { items: [] });
    manager.createOrGetSession('Photon3', { items: [] });

    const names = manager.getSessionNames();

    expect(names).toContain('Photon1');
    expect(names).toContain('Photon2');
    expect(names).toContain('Photon3');
    expect(names).toHaveLength(3);
  });
});

describe('Global Instance Manager Singleton', () => {
  it('returns same instance on multiple calls', () => {
    const manager1 = getGlobalSessionManager();
    const manager2 = getGlobalSessionManager();

    expect(manager1).toBe(manager2);
  });
});

describe('Global Photon Instance Initialization', () => {
  it('initializes global instance with correct name', () => {
    const instance = initializeGlobalPhotonSession('TestPhoton', { items: [] });

    expect(instance.name).toBe('TestPhoton');
  });

  it('makes properties accessible after initialization', () => {
    const instance = initializeGlobalPhotonSession('TestPhoton2', {
      items: [],
      count: 0,
    });

    // initializeGlobalPhotonSession auto-makes properties
    expect(instance.getProperties()).toContain('items');
    expect(instance.getProperties()).toContain('count');
    expect(instance.items).toEqual([]);
    expect(instance.count).toBe(0);
  });
});

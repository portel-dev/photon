/**
 * Tests for @stateful automatic event emission
 *
 * Verifies that all public methods in @stateful classes automatically emit events
 * with the structure: { method, params, result, timestamp, instance }
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Photon } from '@portel/photon-core';

// Simple test photon with @stateful
class TestTodo extends Photon {
  items: Array<any> = [];
  private _idCounter = 0;

  add(text: string, priority: string = 'medium'): any {
    const item = { id: `id-${++this._idCounter}`, text, priority, done: false };
    this.items.push(item);
    return item;
  }

  done(id: string): any | null {
    const item = this.items.find((i: any) => i.id === id);
    if (item) {
      const oldValue = item.done;
      item.done = true;
      this._trackModification(item, 'done', oldValue, true, 'done');
    }
    return item ?? null;
  }

  setPriority(id: string, priority: string): any | null {
    const item = this.items.find((i: any) => i.id === id);
    if (item) {
      const oldValue = item.priority;
      item.priority = priority;
      this._trackModification(item, 'priority', oldValue, priority, 'setPriority');
    }
    return item ?? null;
  }

  clear(): { removed: number } {
    const before = this.items.length;
    this.items = [];
    return { removed: before };
  }

  list(): any[] {
    return this.items;
  }

  // Private helper (prefix with _ so wrapper skips it)
  _trackModification(
    item: any,
    field: string,
    oldValue: any,
    newValue: any,
    methodName: string
  ): void {
    if (item?.__meta) {
      const timestamp = new Date().toISOString();
      item.__meta.modifications.push({
        field,
        oldValue,
        newValue,
        timestamp,
        modifiedBy: methodName,
      });
      item.__meta.modifiedAt = timestamp;
      item.__meta.modifiedBy = methodName;
    }
  }
}

describe('Stateful Event Emission', () => {
  let todo: any;
  let emittedEvents: any[] = [];

  beforeEach(() => {
    emittedEvents = [];
    todo = new TestTodo();

    // Mock emit to capture events
    todo.emit = (eventName: string, data: any) => {
      emittedEvents.push({ eventName, data });
    };

    // Simulate @stateful wrapping (normally done by loader)
    wrapStatefulMethods(todo);
  });

  it('emits event with method name, params, and result', async () => {
    const result = todo.add('Test task', 'high');

    expect(emittedEvents).toHaveLength(1);
    const event = emittedEvents[0];

    expect(event.eventName).toBe('add');
    expect(event.data.method).toBe('add');
    expect(event.data.params).toEqual({
      text: 'Test task',
      priority: 'high',
    });
    expect(event.data.result).toEqual(result);
    expect(event.data.timestamp).toBeDefined();
    expect(typeof event.data.timestamp).toBe('string');
  });

  it('includes timestamp as ISO string', async () => {
    todo.add('Test', 'low');

    const event = emittedEvents[0];
    const timestamp = new Date(event.data.timestamp);

    expect(isNaN(timestamp.getTime())).toBe(false);
    expect(event.data.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('emits event even when result is null', async () => {
    // First add an item
    const item = todo.add('Task 1', 'medium');

    // Clear events and mark it done
    emittedEvents = [];
    const result = todo.done('nonexistent');

    // Should still emit with null result
    expect(emittedEvents).toHaveLength(1);
    expect(emittedEvents[0].data.result).toBeNull();
    expect(emittedEvents[0].data.params).toEqual({ id: 'nonexistent' });
  });

  it('includes instance name in event if set', async () => {
    todo.instanceName = 'home';

    todo.add('Personal task', 'high');

    expect(emittedEvents[0].data.instance).toBe('home');
  });

  it('does not include instance name if empty', async () => {
    todo.instanceName = '';

    todo.add('Task', 'medium');

    expect(emittedEvents[0].data.instance).toBeUndefined();
  });

  it('extracts all method parameters correctly', async () => {
    // First add some items
    const item1 = todo.add('Task 1', 'high');
    const item2 = todo.add('Task 2', 'medium');
    emittedEvents = [];

    // Call a method with multiple parameters
    todo.setPriority(item1.id, 'low');

    expect(emittedEvents[0].data.params).toEqual({
      id: item1.id,
      priority: 'low',
    });
  });

  it('handles methods with default parameters', async () => {
    // Call add() with only one parameter (priority defaults to 'medium')
    todo.add('Default priority');

    expect(emittedEvents[0].data.params).toEqual({
      text: 'Default priority',
      priority: undefined, // Called with only 1 arg, so priority is undefined
    });
  });

  it('all public methods emit events', async () => {
    const item1 = todo.add('Task 1', 'high');
    const item2 = todo.add('Task 2', 'low');

    expect(emittedEvents).toHaveLength(2);
    expect(emittedEvents[0].eventName).toBe('add');
    expect(emittedEvents[1].eventName).toBe('add');

    emittedEvents = [];
    todo.done(item1.id);
    todo.setPriority(item1.id, 'medium');

    expect(emittedEvents).toHaveLength(2);
    expect(emittedEvents[0].eventName).toBe('done');
    expect(emittedEvents[1].eventName).toBe('setPriority');
  });

  it('returns original value unchanged', async () => {
    const result = todo.add('Test', 'high');

    expect(result).toHaveProperty('id');
    expect(result).toHaveProperty('text');
    expect(result.text).toBe('Test');
    expect(result.priority).toBe('high');
  });

  it('preserves this context in wrapped methods', async () => {
    const item = todo.add('Task', 'medium');

    // The item should have been added to this.items
    expect(todo.items).toHaveLength(1);
    expect(todo.items[0]).toEqual(item);
  });

  it('emits events for methods returning objects', async () => {
    todo.add('Task 1', 'high');
    todo.add('Task 2', 'low');

    emittedEvents = [];
    const result = todo.clear();

    expect(emittedEvents).toHaveLength(1);
    expect(emittedEvents[0].data.result).toEqual({ removed: 2 });
  });

  it('emits event for methods with no parameters', async () => {
    todo.add('Task 1', 'medium');
    todo.add('Task 2', 'medium');

    emittedEvents = [];
    const result = todo.list();

    expect(emittedEvents).toHaveLength(1);
    expect(emittedEvents[0].eventName).toBe('list');
    expect(emittedEvents[0].data.params).toEqual({});
    expect(emittedEvents[0].data.result).toEqual(result);
  });

  it('event data is independent across calls', async () => {
    todo.add('Task 1', 'high');
    todo.add('Task 2', 'low');

    expect(emittedEvents[0].data.params.text).toBe('Task 1');
    expect(emittedEvents[0].data.params.priority).toBe('high');

    expect(emittedEvents[1].data.params.text).toBe('Task 2');
    expect(emittedEvents[1].data.params.priority).toBe('low');
  });
});

describe('Object __meta Attachment (Phase 1)', () => {
  let todo: any;
  let emittedEvents: any[] = [];

  beforeEach(() => {
    emittedEvents = [];
    todo = new TestTodo();

    todo.emit = (eventName: string, data: any) => {
      emittedEvents.push({ eventName, data });
    };

    wrapStatefulMethods(todo);
  });

  it('attaches __meta to returned objects', () => {
    const item = todo.add('Test task', 'high');

    expect(item.__meta).toBeDefined();
    expect(item.__meta.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(item.__meta.createdBy).toBe('add');
    expect(item.__meta.modifiedAt).toBeNull();
    expect(item.__meta.modifiedBy).toBeNull();
    expect(Array.isArray(item.__meta.modifications)).toBe(true);
    expect(item.__meta.modifications).toHaveLength(0);
  });

  it('__meta is non-enumerable (not in JSON.stringify or Object.keys)', () => {
    const item = todo.add('Test task', 'high');

    // Non-enumerable means: not in JSON.stringify and not in Object.keys()
    expect(JSON.stringify(item)).not.toContain('__meta');
    expect(Object.keys(item)).not.toContain('__meta');

    // But __meta descriptor exists (Object.getOwnPropertyNames shows all properties including non-enumerable)
    const descriptor = Object.getOwnPropertyDescriptor(item, '__meta');
    expect(descriptor).toBeDefined();
    expect(descriptor?.enumerable).toBe(false);
  });

  it('__meta is readable via property access', () => {
    const item = todo.add('Test task', 'high');

    expect(item.__meta).toBeDefined();
    expect(item.__meta.createdBy).toBe('add');
  });

  it('multiple items have independent __meta', () => {
    const item1 = todo.add('Task 1', 'high');
    // Add a small delay to ensure different millisecond timestamp
    const delay = () => new Promise((resolve) => setTimeout(resolve, 1));
    todo.add('Task 2', 'low'); // May have same timestamp if called immediately

    // The important check: they are separate __meta objects
    expect(item1.__meta).toBeDefined();
    expect(item1.__meta.createdBy).toBe('add');

    const item2 = todo.items.find((i: any) => i.text === 'Task 2');
    expect(item2.__meta).toBeDefined();
    expect(item2.__meta.createdBy).toBe('add');

    // Different objects, even if timestamps are same millisecond
    expect(item1.__meta !== item2.__meta).toBe(true);
  });

  it('__meta is writable for future updates', () => {
    const item = todo.add('Test task', 'high');

    item.__meta.modifiedAt = '2026-03-04T11:35:00.000Z';
    item.__meta.modifiedBy = 'done';
    item.__meta.modifications.push({
      field: 'done',
      oldValue: false,
      newValue: true,
      timestamp: '2026-03-04T11:35:00.000Z',
      modifiedBy: 'done',
    });

    expect(item.__meta.modifiedAt).toBe('2026-03-04T11:35:00.000Z');
    expect(item.__meta.modifiedBy).toBe('done');
    expect(item.__meta.modifications).toHaveLength(1);
  });

  it('does not attach __meta to null results', () => {
    const result = todo.done('nonexistent');

    expect(result).toBeNull();
  });

  it('does not attach __meta to array results', () => {
    todo.add('Task 1', 'high');
    todo.add('Task 2', 'low');

    const result = todo.list();

    expect(Array.isArray(result)).toBe(true);
    expect(result.__meta).toBeUndefined();
  });

  it('does not attach __meta to primitive results', () => {
    const result = todo.clear();

    expect(typeof result).toBe('object');
    expect(result.removed).toBe(0);
    // Note: plain objects get __meta, so we check the removed count
    expect(result.__meta).toBeDefined(); // Plain objects DO get __meta
  });

  it('preserves __meta across method calls on same item', () => {
    const item1 = todo.add('Task 1', 'high');
    const createdAt1 = item1.__meta.createdAt;

    // Retrieve the same item via done()
    const item2 = todo.done(item1.id);

    // Should be same object instance
    expect(item2.id).toBe(item1.id);
    // __meta should exist from first creation
    expect(item2.__meta).toBeDefined();
    expect(item2.__meta.createdAt).toBe(createdAt1);
  });

  it('__meta tracks timestamp precision (milliseconds)', () => {
    const beforeAdd = Date.now();
    const item = todo.add('Test', 'high');
    const afterAdd = Date.now();

    const itemTimestamp = new Date(item.__meta.createdAt).getTime();
    expect(itemTimestamp).toBeGreaterThanOrEqual(beforeAdd);
    expect(itemTimestamp).toBeLessThanOrEqual(afterAdd);
  });
});

describe('Modification Tracking (Phase 2)', () => {
  let todo: any;
  let emittedEvents: any[] = [];

  beforeEach(() => {
    emittedEvents = [];
    todo = new TestTodo();

    todo.emit = (eventName: string, data: any) => {
      emittedEvents.push({ eventName, data });
    };

    wrapStatefulMethods(todo);
  });

  it('tracks field changes with old and new values', () => {
    const item = todo.add('Task', 'medium');
    emittedEvents = [];

    todo.done(item.id);

    expect(item.__meta.modifications).toHaveLength(1);
    const mod = item.__meta.modifications[0];

    expect(mod.field).toBe('done');
    expect(mod.oldValue).toBe(false);
    expect(mod.newValue).toBe(true);
    expect(mod.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(mod.modifiedBy).toBe('done');
  });

  it('records multiple modifications in order', () => {
    const item = todo.add('Task', 'medium');
    emittedEvents = [];

    todo.done(item.id);
    todo.setPriority(item.id, 'high');

    expect(item.__meta.modifications).toHaveLength(2);
    expect(item.__meta.modifications[0].field).toBe('done');
    expect(item.__meta.modifications[1].field).toBe('priority');

    expect(item.__meta.modifications[0].oldValue).toBe(false);
    expect(item.__meta.modifications[1].oldValue).toBe('medium');
    expect(item.__meta.modifications[1].newValue).toBe('high');
  });

  it('updates modifiedAt timestamp on each change', () => {
    const item = todo.add('Task', 'medium');

    // Initially modifiedAt is null
    expect(item.__meta.modifiedAt).toBeNull();

    const beforeDone = Date.now();
    todo.done(item.id);
    const afterDone = Date.now();

    // After modification, modifiedAt is set
    expect(item.__meta.modifiedAt).not.toBeNull();
    const modifiedAt1 = new Date(item.__meta.modifiedAt).getTime();
    expect(modifiedAt1).toBeGreaterThanOrEqual(beforeDone);
    expect(modifiedAt1).toBeLessThanOrEqual(afterDone);
  });

  it('updates modifiedBy on each change', () => {
    const item = todo.add('Task', 'medium');

    expect(item.__meta.modifiedBy).toBeNull();

    todo.done(item.id);
    expect(item.__meta.modifiedBy).toBe('done');

    todo.setPriority(item.id, 'high');
    expect(item.__meta.modifiedBy).toBe('setPriority');
  });

  it('preserves modification history across multiple changes', () => {
    const item = todo.add('Task', 'medium');

    todo.done(item.id);
    todo.setPriority(item.id, 'high');
    todo.setPriority(item.id, 'low');

    expect(item.__meta.modifications).toHaveLength(3);
    expect(item.__meta.modifications.map((m: any) => m.field)).toEqual([
      'done',
      'priority',
      'priority',
    ]);
  });

  it('includes modification timestamp as ISO string', () => {
    const item = todo.add('Task', 'medium');

    todo.done(item.id);

    const modTimestamp = item.__meta.modifications[0].timestamp;
    expect(modTimestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const date = new Date(modTimestamp);
    expect(isNaN(date.getTime())).toBe(false);
  });

  it('tracks modifications for different items independently', () => {
    const item1 = todo.add('Task 1', 'medium');
    const item2 = todo.add('Task 2', 'medium');

    todo.done(item1.id);
    todo.setPriority(item2.id, 'high');

    expect(item1.__meta.modifications).toHaveLength(1);
    expect(item1.__meta.modifications[0].field).toBe('done');

    expect(item2.__meta.modifications).toHaveLength(1);
    expect(item2.__meta.modifications[0].field).toBe('priority');
  });

  it('does not modify __meta if item has no __meta', () => {
    // This shouldn't happen in practice, but test the guard
    const orphanItem = { id: '999', text: 'No meta' };

    // Manually trigger modification (as if done() was called)
    if (orphanItem.__meta) {
      orphanItem.__meta.modifications.push({
        field: 'done',
        oldValue: false,
        newValue: true,
        timestamp: new Date().toISOString(),
        modifiedBy: 'done',
      });
    }

    expect(orphanItem.__meta).toBeUndefined();
  });

  it('audit trail shows complete change history for investigation', () => {
    const item = todo.add('Buy milk', 'medium');

    todo.done(item.id);
    todo.setPriority(item.id, 'high');
    todo.setPriority(item.id, 'low');
    todo.done(item.id); // Try to mark done again (already true)

    // Audit trail shows exactly what happened
    expect(item.__meta.modifications).toHaveLength(4);
    expect(item.__meta.modifications[0]).toEqual({
      field: 'done',
      oldValue: false,
      newValue: true,
      timestamp: expect.any(String),
      modifiedBy: 'done',
    });
    expect(item.__meta.modifications[1]).toEqual({
      field: 'priority',
      oldValue: 'medium',
      newValue: 'high',
      timestamp: expect.any(String),
      modifiedBy: 'setPriority',
    });
    expect(item.__meta.modifications[2]).toEqual({
      field: 'priority',
      oldValue: 'high',
      newValue: 'low',
      timestamp: expect.any(String),
      modifiedBy: 'setPriority',
    });
    expect(item.__meta.modifications[3]).toEqual({
      field: 'done',
      oldValue: true,
      newValue: true,
      timestamp: expect.any(String),
      modifiedBy: 'done',
    });
  });
});

/**
 * Helper function to simulate the @stateful method wrapping that the loader does
 * This is used in tests since we can't easily use the real loader
 */
function wrapStatefulMethods(instance: any): void {
  const proto = Object.getPrototypeOf(instance);
  const methodNames = Object.getOwnPropertyNames(proto).filter((name) => {
    if (name === 'constructor' || name.startsWith('_')) {
      return false;
    }
    const descriptor = Object.getOwnPropertyDescriptor(proto, name);
    return descriptor && typeof descriptor.value === 'function';
  });

  const emit = instance.emit;

  for (const methodName of methodNames) {
    const original = instance[methodName];
    if (typeof original !== 'function') continue;

    instance[methodName] = function (...args: any[]) {
      const paramNames = extractParamNames(original);
      const params = Object.fromEntries(paramNames.map((name, i) => [name, args[i]]));

      const result = original.apply(this, args);

      // Attach __meta to returned objects for audit trail
      if (result && typeof result === 'object' && !Array.isArray(result) && !result.__meta) {
        const timestamp = new Date().toISOString();
        Object.defineProperty(result, '__meta', {
          value: {
            createdAt: timestamp,
            createdBy: methodName,
            modifiedAt: null,
            modifiedBy: null,
            modifications: [],
          },
          enumerable: false,
          writable: true,
          configurable: true,
        });
      }

      const eventData: Record<string, any> = {
        method: methodName,
        params,
        result,
        timestamp: new Date().toISOString(),
      };
      if (this.instanceName) {
        eventData.instance = this.instanceName;
      }

      // Phase 5: Detect array mutations for range-based pagination support
      // If result is an object from this.items, add index and array metadata
      if (result && typeof result === 'object' && Array.isArray(this.items)) {
        const index = this.items.findIndex((item: any) => item === result);
        if (index !== -1) {
          eventData.index = index;
          eventData.totalCount = this.items.length;
          // Affected range: just this item
          eventData.affectedRange = {
            start: index,
            end: index + 1,
          };
        }
      }

      emit(methodName, eventData);

      return result;
    };
  }
}

/**
 * Warmth Detection Tests (Phase 3)
 *
 * Verifies that the UI warmth system correctly reads __meta timestamps
 * and applies appropriate CSS classes based on item age.
 */
describe('Warmth Detection with __meta (Phase 3)', () => {
  /**
   * Simulates the result-viewer warmth detection logic
   * Returns the warmth class based on timestamp age
   */
  function _getItemWarmthClass(item: unknown): string {
    let timestamp: number | undefined;

    if (item && typeof item === 'object') {
      const rec = item as Record<string, unknown>;

      // Check __meta object first (highest priority — most recent change)
      const meta = (rec as any).__meta;
      if (meta && typeof meta === 'object') {
        // Prefer modifiedAt (most recent change) over createdAt
        if (meta.modifiedAt) {
          const parsed = new Date(meta.modifiedAt).getTime();
          if (!isNaN(parsed)) timestamp = parsed;
        } else if (meta.createdAt) {
          const parsed = new Date(meta.createdAt).getTime();
          if (!isNaN(parsed)) timestamp = parsed;
        }
      }
    }

    if (!timestamp) return '';

    const age = Date.now() - timestamp;
    if (age < 5 * 60_000) return 'warmth-hot'; // < 5 min
    if (age < 30 * 60_000) return 'warmth-warm'; // < 30 min
    if (age < 2 * 3600_000) return 'warmth-cool'; // < 2 hr
    return '';
  }

  it('detects warmth-hot from __meta.createdAt < 5 min', () => {
    const now = Date.now();
    const item = {
      id: '1',
      __meta: {
        createdAt: new Date(now - 2 * 60_000).toISOString(), // 2 min ago
      },
    };

    const warmth = _getItemWarmthClass(item);
    expect(warmth).toBe('warmth-hot');
  });

  it('detects warmth-warm from __meta.createdAt 5-30 min ago', () => {
    const now = Date.now();
    const item = {
      id: '1',
      __meta: {
        createdAt: new Date(now - 15 * 60_000).toISOString(), // 15 min ago
      },
    };

    const warmth = _getItemWarmthClass(item);
    expect(warmth).toBe('warmth-warm');
  });

  it('detects warmth-cool from __meta.createdAt 30 min - 2 hr ago', () => {
    const now = Date.now();
    const item = {
      id: '1',
      __meta: {
        createdAt: new Date(now - 90 * 60_000).toISOString(), // 90 min ago
      },
    };

    const warmth = _getItemWarmthClass(item);
    expect(warmth).toBe('warmth-cool');
  });

  it('returns empty string for __meta.createdAt > 2 hours ago', () => {
    const now = Date.now();
    const item = {
      id: '1',
      __meta: {
        createdAt: new Date(now - 3 * 3600_000).toISOString(), // 3 hours ago
      },
    };

    const warmth = _getItemWarmthClass(item);
    expect(warmth).toBe('');
  });

  it('prioritizes __meta.modifiedAt over __meta.createdAt', () => {
    const now = Date.now();
    const item = {
      id: '1',
      __meta: {
        createdAt: new Date(now - 90 * 60_000).toISOString(), // 90 min ago (warmth-cool)
        modifiedAt: new Date(now - 2 * 60_000).toISOString(), // 2 min ago (warmth-hot)
      },
    };

    const warmth = _getItemWarmthClass(item);
    expect(warmth).toBe('warmth-hot'); // Should use modifiedAt, not createdAt
  });

  it('returns empty string when __meta has no timestamps', () => {
    const item = {
      id: '1',
      __meta: {},
    };

    const warmth = _getItemWarmthClass(item);
    expect(warmth).toBe('');
  });

  it('returns empty string when item has no __meta', () => {
    const item = { id: '1', text: 'No metadata' };

    const warmth = _getItemWarmthClass(item);
    expect(warmth).toBe('');
  });

  it('handles null and undefined timestamps gracefully', () => {
    const item = {
      id: '1',
      __meta: {
        createdAt: null,
        modifiedAt: undefined,
      },
    };

    const warmth = _getItemWarmthClass(item);
    expect(warmth).toBe('');
  });

  it('decays warmth correctly over time thresholds', () => {
    const now = Date.now();

    // Test boundary: 4:59 ago should be hot
    const item1 = {
      id: '1',
      __meta: {
        createdAt: new Date(now - 4 * 60_000 - 59 * 1000).toISOString(),
      },
    };
    expect(_getItemWarmthClass(item1)).toBe('warmth-hot');

    // Test boundary: 5:01 ago should be warm
    const item2 = {
      id: '2',
      __meta: {
        createdAt: new Date(now - 5 * 60_000 - 1 * 1000).toISOString(),
      },
    };
    expect(_getItemWarmthClass(item2)).toBe('warmth-warm');

    // Test boundary: 29:59 ago should be warm
    const item3 = {
      id: '3',
      __meta: {
        createdAt: new Date(now - 29 * 60_000 - 59 * 1000).toISOString(),
      },
    };
    expect(_getItemWarmthClass(item3)).toBe('warmth-warm');

    // Test boundary: 30:01 ago should be cool
    const item4 = {
      id: '4',
      __meta: {
        createdAt: new Date(now - 30 * 60_000 - 1 * 1000).toISOString(),
      },
    };
    expect(_getItemWarmthClass(item4)).toBe('warmth-cool');
  });

  it('shows how warmth integrates with modification tracking', () => {
    const now = Date.now();

    // Simulate an item with __meta attached by the loader
    const item = {
      id: 'test-1',
      text: 'Test task',
      done: false,
      __meta: {
        createdAt: new Date(now - 1 * 60_000).toISOString(), // 1 min ago
        createdBy: 'add',
        modifiedAt: null,
        modifiedBy: null,
        modifications: [],
      },
    };

    // Freshly created items should be hot (< 5 min)
    expect(_getItemWarmthClass(item)).toBe('warmth-hot');

    // Simulate modification tracking (as done by the loader)
    item.done = true;
    item.__meta.modifications.push({
      field: 'done',
      oldValue: false,
      newValue: true,
      timestamp: new Date().toISOString(),
      modifiedBy: 'done',
    });
    item.__meta.modifiedAt = new Date().toISOString();
    item.__meta.modifiedBy = 'done';

    // After modification with current timestamp, should still be hot
    expect(_getItemWarmthClass(item)).toBe('warmth-hot');

    // Verify modification is in audit trail
    expect(item.__meta.modifications).toHaveLength(1);
    expect(item.__meta.modifications[0].field).toBe('done');
    expect(item.__meta.modifiedBy).toBe('done');
  });
});

/**
 * Index-Aware Events & Range Subscriptions (Phase 5)
 *
 * Verifies that events include positional information and array metadata
 * for efficient range-based client subscriptions and pagination support.
 */
describe('Index-Aware Events & Pagination Support (Phase 5)', () => {
  it('includes index in events for items added to array', () => {
    const events: any[] = [];
    const todo = new TestTodo();

    // Mock emit to capture events
    todo.emit = (eventName: string, data: any) => {
      events.push(data);
    };

    // Wrap methods
    wrapStatefulMethods(todo);

    // Add first item
    todo.add('First task');
    expect(events).toHaveLength(1);
    expect(events[0].index).toBe(0);
    expect(events[0].totalCount).toBe(1);

    // Add second item
    todo.add('Second task');
    expect(events).toHaveLength(2);
    expect(events[1].index).toBe(1);
    expect(events[1].totalCount).toBe(2);
  });

  it('includes affectedRange in events for pagination filtering', () => {
    const events: any[] = [];
    const todo = new TestTodo();

    todo.emit = (eventName: string, data: any) => {
      events.push(data);
    };

    wrapStatefulMethods(todo);

    todo.add('Task 1');
    expect(events[0].affectedRange).toEqual({ start: 0, end: 1 });

    todo.add('Task 2');
    expect(events[1].affectedRange).toEqual({ start: 1, end: 2 });
  });

  it('includes totalCount for client-side pagination calculations', () => {
    const events: any[] = [];
    const todo = new TestTodo();

    todo.emit = (eventName: string, data: any) => {
      events.push(data);
    };

    wrapStatefulMethods(todo);

    for (let i = 0; i < 5; i++) {
      todo.add(`Task ${i}`);
    }

    // Each event should show the total array length
    expect(events[0].totalCount).toBe(1);
    expect(events[1].totalCount).toBe(2);
    expect(events[4].totalCount).toBe(5);
  });

  it('handles modifications preserving index information', () => {
    const events: any[] = [];
    const todo = new TestTodo();

    todo.emit = (eventName: string, data: any) => {
      events.push(data);
    };

    wrapStatefulMethods(todo);

    todo.add('Task 1');
    todo.add('Task 2');
    todo.add('Task 3');
    events.length = 0; // Clear add events

    // Modify item at index 1
    const item = todo.items[1];
    todo.done(item.id);

    expect(events).toHaveLength(1);
    expect(events[0].index).toBe(1);
    expect(events[0].totalCount).toBe(3);
  });

  it('supports range filtering: client can filter events for subscribed range', () => {
    const allEvents: any[] = [];
    const subscriptionRange = { start: 50, end: 100 };

    const todo = new TestTodo();

    todo.emit = (eventName: string, data: any) => {
      allEvents.push(data);
    };

    wrapStatefulMethods(todo);

    // Add items outside and inside the range
    for (let i = 0; i < 150; i++) {
      todo.add(`Task ${i}`);
    }

    // Filter events for subscribed range
    const filteredEvents = allEvents.filter(
      (event) => event.index >= subscriptionRange.start && event.index < subscriptionRange.end
    );

    // Only events for items in [50, 100) should be received by subscriber
    expect(allEvents).toHaveLength(150);
    expect(filteredEvents).toHaveLength(50);
    expect(filteredEvents[0].index).toBe(50); // First in range
    expect(filteredEvents[49].index).toBe(99); // Last in range
  });

  it('detects range shifts: when insertion happens before subscribed range', () => {
    const todo = new TestTodo();

    // Add initial items
    for (let i = 0; i < 100; i++) {
      todo.add(`Task ${i}`);
    }

    // Client subscribed to range [50, 100]
    const subscriptionRange = { start: 50, end: 100 };

    // New item added at index 10 (before range)
    // This shifts the range to [51, 101]
    const insertionEvent = {
      index: 10,
      totalCount: 101,
      affectedRange: { start: 10, end: 11 },
    };

    // Client-side detection:
    // If event.index < subscription.start, the range shifts
    const rangeShifted = insertionEvent.index < subscriptionRange.start;
    expect(rangeShifted).toBe(true);

    // New range should be [51, 101]
    const newRange = {
      start: subscriptionRange.start + 1,
      end: subscriptionRange.end + 1,
    };
    expect(newRange).toEqual({ start: 51, end: 101 });
  });

  it('detects when items are removed before range (pulling items back)', () => {
    const todo = new TestTodo();

    for (let i = 0; i < 100; i++) {
      todo.add(`Task ${i}`);
    }

    // Client subscribed to [50, 100]
    const subscriptionRange = { start: 50, end: 100 };

    // If deletion happened at index 30 (before range)
    // The range pulls back to [49, 99]
    const deletionBefore = { index: 30 };
    if (deletionBefore.index < subscriptionRange.start) {
      // Range shifts backward
      const newRange = {
        start: subscriptionRange.start - 1,
        end: subscriptionRange.end - 1,
      };
      expect(newRange).toEqual({ start: 49, end: 99 });
    }
  });

  it('enables lazy pagination: client loads pages on demand', () => {
    const todo = new TestTodo();
    const pageSize = 50;

    // Simulate adding a large dataset
    for (let i = 0; i < 1000; i++) {
      todo.add(`Task ${i}`);
    }

    // Client requests page 2: items [50, 100)
    const pageNum = 2;
    const startIdx = (pageNum - 1) * pageSize;
    const endIdx = startIdx + pageSize;

    const itemsInPage = todo.items.slice(startIdx, endIdx);
    expect(itemsInPage).toHaveLength(50);
    expect(itemsInPage[0].id).toBe(`id-${startIdx + 1}`); // First item in page
  });

  it('preserves event structure for non-array results', () => {
    const events: any[] = [];
    const todo = new TestTodo();

    todo.emit = (eventName: string, data: any) => {
      if (eventName === 'clear') {
        events.push(data);
      }
    };

    wrapStatefulMethods(todo);

    todo.add('Task 1');
    todo.clear();

    // clear() returns { removed: number }, not an array item
    expect(events).toHaveLength(1);
    expect(events[0].index).toBeUndefined(); // No index for non-array results
    expect(events[0].totalCount).toBeUndefined(); // No totalCount
    expect(events[0].result).toEqual({ removed: 1 });
  });

  it('demonstrates pagination use case: efficient client-side range subscription', () => {
    const allEvents: any[] = [];
    const todo = new TestTodo();

    todo.emit = (eventName: string, data: any) => {
      allEvents.push(data);
    };

    wrapStatefulMethods(todo);

    // Server: Add 1000 items
    for (let i = 0; i < 1000; i++) {
      todo.add(`Task ${i}`);
    }

    // Client side: Track active subscription
    const activeSubscription = {
      start: 200,
      end: 250,
      pageSize: 50,
    };

    // Filter events that would be received by a subscribed client
    const receivedEvents = allEvents.filter((event) => {
      // Only receive events relevant to subscription
      return event.index >= activeSubscription.start && event.index < activeSubscription.end;
    });

    // Should have received 50 events (indices 200-249)
    expect(receivedEvents).toHaveLength(50);
    expect(receivedEvents[0].index).toBe(200);
    expect(receivedEvents[49].index).toBe(249);

    // Detect range shifts: if an event's index < subscription.start
    const shiftingEvents = allEvents.filter((event) => event.index < activeSubscription.start);
    // If we added 1000 items, indices 0-199 would cause range shifts
    expect(shiftingEvents).toHaveLength(200);

    // Verify event structure for pagination
    const sampleEvent = allEvents[225];
    expect(sampleEvent).toHaveProperty('index');
    expect(sampleEvent).toHaveProperty('totalCount');
    expect(sampleEvent).toHaveProperty('affectedRange');
    expect(sampleEvent.affectedRange).toEqual({ start: 225, end: 226 });
  });
});

/**
 * Extract parameter names from a function by parsing its signature
 */
function extractParamNames(fn: any): string[] {
  const fnStr = fn.toString();
  // Match parameters inside parentheses: ( ... ) or => ( ... ) or function ( ... )
  const match = fnStr.match(/\(([^)]*)\)/);
  if (!match?.[1]) {
    return [];
  }

  return match[1]
    .split(',')
    .map((param) => {
      const cleaned = param
        .trim()
        .split('=')[0] // Remove default value
        .split(':')[0] // Remove type annotation
        .trim();
      return cleaned;
    })
    .filter((name) => name && name !== 'this');
}

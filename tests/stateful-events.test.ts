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

  add(text: string, priority: string = 'medium'): any {
    const item = { id: `${Date.now()}`, text, priority, done: false };
    this.items.push(item);
    return item;
  }

  done(id: string): any | null {
    const item = this.items.find((i: any) => i.id === id);
    if (item) {
      item.done = true;
    }
    return item ?? null;
  }

  setPriority(id: string, priority: string): any | null {
    const item = this.items.find((i: any) => i.id === id);
    if (item) {
      item.priority = priority;
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

      const eventData: Record<string, any> = {
        method: methodName,
        params,
        result,
        timestamp: new Date().toISOString(),
      };
      if (this.instanceName) {
        eventData.instance = this.instanceName;
      }
      emit(methodName, eventData);

      return result;
    };
  }
}

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

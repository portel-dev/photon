import { describe, expect, test, vi } from 'vitest';
import { PhotonLoader } from '../src/loader.js';
import * as path from 'path';
import * as fs from 'fs';
import { tmpdir } from 'os';

describe('Stateful synchronization and @sharedState metadata', () => {
  test('loader extracts property-level @sharedState JSDoc blocks', async () => {
    const loader = new PhotonLoader();
    const source = `
      /**
       * Stateful Counter App
       * @stateful
       */
      export default class CounterApp {
        /**
         * The click counters
         * @sharedState
         */
        public counters = { clickCount: 0 };

        /**
         * Plain unshared property
         */
        public plainProp = 'hello';

        async increment() {
          this.counters.clickCount++;
        }
      }
    `;

    // Create a temporary file to load
    const tempFile = path.join(tmpdir(), `test-counter-${Date.now()}.photon.ts`);
    fs.writeFileSync(tempFile, source, 'utf-8');

    try {
      const loaded = await loader.loadFile(tempFile);
      expect(loaded.sharedStates).toBeDefined();
      expect(loaded.sharedStates).toContain('counters');
      expect(loaded.sharedStates).not.toContain('plainProp');
    } finally {
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    }
  });

  test('reactive proxy triggers emit on property mutation', async () => {
    const loader = new PhotonLoader();
    const source = `
      /**
       * @stateful
       */
      export default class TodoApp {
        /**
         * @sharedState
         */
        public todos: string[] = [];

        async addTodo(text: string) {
          this.todos.push(text);
        }
      }
    `;

    const tempFile = path.join(tmpdir(), `test-todo-${Date.now()}.photon.ts`);
    fs.writeFileSync(tempFile, source, 'utf-8');

    try {
      const loaded = await loader.loadFile(tempFile);
      const instance = loaded.instance as any;

      // Mock emit function
      const emitMock = vi.fn();
      instance.emit = emitMock;

      // Verify proxy mutation
      instance.todos.push('Buy milk');
      expect(emitMock).toHaveBeenCalled();

      const lastCall = emitMock.mock.calls[0][0];
      expect(lastCall.event).toBe('state-changed');
      expect(lastCall.channel).toContain('state-changed');

      instance.todos.push({ 'label/with~separator': 'value' } as any);
      instance.todos[1]['label/with~separator'] = 'updated';
      const escapedPatch = emitMock.mock.calls.at(-1)?.[0].data.patches[0];
      expect(escapedPatch.path).toContain('label~1with~0separator');
    } finally {
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    }
  });
});

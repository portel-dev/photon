/**
 * this.render() Pipeline Tests
 *
 * Tests the render() method across all layers:
 *   Layer 1: Base class — render() emits correct event shape
 *   Layer 2: Loader outputHandler — render emit triggers format rendering
 *   Layer 3: STDIO server — render emit becomes MCP notification
 *   Layer 4: Beam SSE transport — render emit becomes beam/render broadcast
 *
 * Run: npx vitest run tests/render.test.ts
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PhotonLoader } from '../src/loader.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

let testDir: string;

beforeEach(async () => {
  testDir = path.join(os.tmpdir(), `photon-render-test-${Date.now()}`);
  await fs.mkdir(testDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(testDir, { recursive: true, force: true });
});

async function createTestPhoton(name: string, content: string): Promise<string> {
  const filePath = path.join(testDir, `${name}.photon.ts`);
  await fs.writeFile(filePath, content, 'utf-8');
  return filePath;
}

// ═══════════════════════════════════════════════════════════════════════════════
// LAYER 1: Base Class — this.render() emits correct event shape
// ═══════════════════════════════════════════════════════════════════════════════

describe('Layer 1: Base Class render()', () => {
  it('emits { emit: "render", format, value } via this.emit()', async () => {
    const { Photon } = await import('@portel/photon-core');
    const photon = new Photon();

    const emitted: any[] = [];
    (photon as any).emit = (data: any) => emitted.push(data);

    (photon as any).render('table', [
      ['Name', 'Age'],
      ['Alice', 30],
    ]);

    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toEqual({
      emit: 'render',
      format: 'table',
      value: [
        ['Name', 'Age'],
        ['Alice', 30],
      ],
    });
  });

  it('supports string values (e.g. QR)', async () => {
    const { Photon } = await import('@portel/photon-core');
    const photon = new Photon();

    const emitted: any[] = [];
    (photon as any).emit = (data: any) => emitted.push(data);

    (photon as any).render('qr', 'https://example.com');

    expect(emitted[0].format).toBe('qr');
    expect(emitted[0].value).toBe('https://example.com');
  });

  it('supports composite dashboard values', async () => {
    const { Photon } = await import('@portel/photon-core');
    const photon = new Photon();

    const emitted: any[] = [];
    (photon as any).emit = (data: any) => emitted.push(data);

    (photon as any).render('dashboard', {
      chart: { format: 'chart:bar', data: [1, 2, 3] },
      status: { format: 'text', data: 'OK' },
    });

    expect(emitted[0].format).toBe('dashboard');
    expect(emitted[0].value.chart.format).toBe('chart:bar');
    expect(emitted[0].value.status.data).toBe('OK');
  });

  it('can change format dynamically between calls', async () => {
    const { Photon } = await import('@portel/photon-core');
    const photon = new Photon();

    const emitted: any[] = [];
    (photon as any).emit = (data: any) => emitted.push(data);

    (photon as any).render('qr', 'https://example.com');
    (photon as any).render('text', 'Scanned successfully!');
    (photon as any).render('table', [['Status'], ['Connected']]);

    expect(emitted).toHaveLength(3);
    expect(emitted[0].format).toBe('qr');
    expect(emitted[1].format).toBe('text');
    expect(emitted[2].format).toBe('table');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// LAYER 2: Loader outputHandler — render emit flows through executeTool
// ═══════════════════════════════════════════════════════════════════════════════

describe('Layer 2: Loader outputHandler receives render events', () => {
  it('this.render() in a photon method triggers outputHandler with render emit', async () => {
    const photonContent = `
      export default class RenderTest {
        /**
         * Test render with table format
         */
        async showTable() {
          this.render('table', [['Name', 'Score'], ['Alice', 95]]);
          return { done: true };
        }
      }
    `;

    const testFile = await createTestPhoton('render-table', photonContent);
    const loader = new PhotonLoader();
    const mcp = await loader.loadFile(testFile);

    const captured: any[] = [];
    const outputHandler = (emit: any) => {
      captured.push(emit);
    };

    const result = await loader.executeTool(mcp, 'showTable', {}, { outputHandler });

    expect(result).toEqual({ done: true });

    // The outputHandler should have received the render emit
    const renderEvents = captured.filter((e) => e?.emit === 'render');
    expect(renderEvents).toHaveLength(1);
    expect(renderEvents[0].format).toBe('table');
    expect(renderEvents[0].value).toEqual([
      ['Name', 'Score'],
      ['Alice', 95],
    ]);
  });

  it('multiple render calls produce multiple events in order', async () => {
    const photonContent = `
      export default class MultiRender {
        /**
         * Simulates a wizard flow
         */
        async wizard() {
          this.render('text', 'Step 1: Connecting...');
          this.render('qr', 'https://pair.example.com/abc');
          this.render('text', 'Step 2: Authenticated!');
          this.render('table', [['Status', 'Value'], ['Connected', 'Yes']]);
          return 'complete';
        }
      }
    `;

    const testFile = await createTestPhoton('multi-render', photonContent);
    const loader = new PhotonLoader();
    const mcp = await loader.loadFile(testFile);

    const captured: any[] = [];
    const outputHandler = (emit: any) => {
      captured.push(emit);
    };

    await loader.executeTool(mcp, 'wizard', {}, { outputHandler });

    const renderEvents = captured.filter((e) => e?.emit === 'render');
    expect(renderEvents).toHaveLength(4);
    expect(renderEvents.map((e) => e.format)).toEqual(['text', 'qr', 'text', 'table']);
    expect(renderEvents[0].value).toBe('Step 1: Connecting...');
    expect(renderEvents[1].value).toBe('https://pair.example.com/abc');
  });

  it('render events interleave correctly with other emit types', async () => {
    const photonContent = `
      export default class InterleaveTest {
        /**
         * Mix render with progress/status/log
         */
        async mixed() {
          this.emit({ emit: 'status', message: 'Starting...' });
          this.render('text', 'Initializing');
          this.emit({ emit: 'progress', value: 0.5, message: 'Halfway' });
          this.render('table', [['Step', 'Done'], ['Init', 'Yes']]);
          this.emit({ emit: 'log', message: 'All done', level: 'info' });
          return 'ok';
        }
      }
    `;

    const testFile = await createTestPhoton('interleave', photonContent);
    const loader = new PhotonLoader();
    const mcp = await loader.loadFile(testFile);

    const captured: any[] = [];
    const outputHandler = (emit: any) => {
      captured.push(emit);
    };

    await loader.executeTool(mcp, 'mixed', {}, { outputHandler });

    // Verify ordering
    const types = captured.map((e) => e?.emit).filter(Boolean);
    expect(types).toEqual(['status', 'render', 'progress', 'render', 'log']);
  });

  it('render works with async generators (yield-based methods)', async () => {
    const photonContent = `
      export default class GeneratorRender {
        /**
         * Async generator that uses render
         */
        async *process() {
          this.render('text', 'Processing...');
          yield { emit: 'progress', value: 0.5, message: 'Half done' };
          this.render('table', [['Result'], ['Done']]);
          return 'finished';
        }
      }
    `;

    const testFile = await createTestPhoton('gen-render', photonContent);
    const loader = new PhotonLoader();
    const mcp = await loader.loadFile(testFile);

    const captured: any[] = [];
    const outputHandler = (emit: any) => {
      captured.push(emit);
    };

    await loader.executeTool(mcp, 'process', {}, { outputHandler });

    const renderEvents = captured.filter((e) => e?.emit === 'render');
    expect(renderEvents).toHaveLength(2);
    expect(renderEvents[0].format).toBe('text');
    expect(renderEvents[1].format).toBe('table');

    // Progress should also be there
    const progressEvents = captured.filter((e) => e?.emit === 'progress');
    expect(progressEvents).toHaveLength(1);
  });

  it('render with custom (non-built-in) format name passes through', async () => {
    const photonContent = `
      export default class CustomFormatTest {
        /**
         * Uses a custom format
         */
        async show() {
          this.render('chat-bubble', [
            { from: 'Alice', text: 'Hello!' },
            { from: 'Bob', text: 'Hi there!' }
          ]);
          return 'rendered';
        }
      }
    `;

    const testFile = await createTestPhoton('custom-format', photonContent);
    const loader = new PhotonLoader();
    const mcp = await loader.loadFile(testFile);

    const captured: any[] = [];
    const outputHandler = (emit: any) => {
      captured.push(emit);
    };

    await loader.executeTool(mcp, 'show', {}, { outputHandler });

    const renderEvents = captured.filter((e) => e?.emit === 'render');
    expect(renderEvents).toHaveLength(1);
    expect(renderEvents[0].format).toBe('chat-bubble');
    expect(renderEvents[0].value).toHaveLength(2);
    expect(renderEvents[0].value[0].from).toBe('Alice');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// LAYER 3: STDIO Server — render emit becomes MCP notification
// ═══════════════════════════════════════════════════════════════════════════════

describe('Layer 3: STDIO Server render notifications', () => {
  it('render emit is forwarded as notifications/message with _render payload', async () => {
    // Create a photon that uses render
    const photonContent = `
      export default class ServerRenderTest {
        /**
         * Renders a table mid-execution
         */
        async getData() {
          this.render('table', [['Name'], ['Alice']]);
          return { result: 'ok' };
        }
      }
    `;

    const testFile = await createTestPhoton('server-render', photonContent);

    // Import PhotonServer and simulate what happens
    // We can't easily test the full STDIO pipe, but we can verify the
    // outputHandler construction by testing the pattern used in server.ts
    const loader = new PhotonLoader();
    const mcp = await loader.loadFile(testFile);

    // Simulate what server.ts does: create an outputHandler that collects
    // the same notifications the server would send
    const notifications: any[] = [];
    const outputHandler = (emit: any) => {
      // Mirror server.ts logic for render events
      if (emit?.emit === 'render') {
        notifications.push({
          method: 'notifications/message',
          params: {
            level: 'info',
            data: JSON.stringify({
              _render: true,
              format: emit.format,
              value: emit.value,
            }),
          },
        });
      } else if (emit?.emit === 'progress') {
        const rawValue = typeof emit.value === 'number' ? emit.value : 0;
        const progress = rawValue <= 1 ? rawValue * 100 : rawValue;
        notifications.push({
          method: 'notifications/progress',
          params: {
            progressToken: `progress_getData`,
            progress,
            total: 100,
          },
        });
      }
    };

    await loader.executeTool(mcp, 'getData', {}, { outputHandler });

    // Verify the render notification
    expect(notifications).toHaveLength(1);
    expect(notifications[0].method).toBe('notifications/message');

    const payload = JSON.parse(notifications[0].params.data);
    expect(payload._render).toBe(true);
    expect(payload.format).toBe('table');
    expect(payload.value).toEqual([['Name'], ['Alice']]);
  });

  it('render and progress notifications maintain correct order', async () => {
    const photonContent = `
      export default class OrderTest {
        /**
         * Mix of render and progress
         */
        async process() {
          this.emit({ emit: 'progress', value: 0.25, message: 'Starting' });
          this.render('text', 'Step 1');
          this.emit({ emit: 'progress', value: 0.75, message: 'Almost' });
          this.render('table', [['Done'], ['Yes']]);
          return 'ok';
        }
      }
    `;

    const testFile = await createTestPhoton('order-test', photonContent);
    const loader = new PhotonLoader();
    const mcp = await loader.loadFile(testFile);

    const events: Array<{ type: string; data?: any }> = [];
    const outputHandler = (emit: any) => {
      if (emit?.emit === 'render') {
        events.push({ type: 'render', data: { format: emit.format, value: emit.value } });
      } else if (emit?.emit === 'progress') {
        events.push({ type: 'progress', data: { value: emit.value } });
      }
    };

    await loader.executeTool(mcp, 'process', {}, { outputHandler });

    expect(events).toHaveLength(4);
    expect(events[0].type).toBe('progress');
    expect(events[1].type).toBe('render');
    expect(events[1].data.format).toBe('text');
    expect(events[2].type).toBe('progress');
    expect(events[3].type).toBe('render');
    expect(events[3].data.format).toBe('table');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// LAYER 4: Beam SSE Transport — render emit becomes beam/render broadcast
// ═══════════════════════════════════════════════════════════════════════════════

describe('Layer 4: Beam transport render broadcast', () => {
  it('outputHandler in SSE transport broadcasts beam/render with correct shape', async () => {
    // Simulate what streamable-http-transport.ts does with the outputHandler
    // We test the handler construction pattern, not a full HTTP server

    const photonContent = `
      export default class BeamRenderTest {
        /**
         * Renders mid-execution for Beam
         */
        async connect() {
          this.render('qr', 'https://pair.example.com/xyz');
          this.render('text', 'Scan the QR code');
          return { connected: true };
        }
      }
    `;

    const testFile = await createTestPhoton('beam-render', photonContent);
    const loader = new PhotonLoader();
    const mcp = await loader.loadFile(testFile);

    // Simulate Beam's outputHandler pattern from streamable-http-transport.ts
    const broadcasts: any[] = [];
    const photonName = 'beam-render';
    const methodName = 'connect';

    const outputHandler = (yieldValue: any) => {
      // Mirror streamable-http-transport.ts logic
      if (yieldValue?.emit === 'render') {
        broadcasts.push({
          jsonrpc: '2.0',
          method: 'beam/render',
          params: {
            photon: photonName,
            method: methodName,
            format: yieldValue.format,
            value: yieldValue.value,
          },
        });
      } else if (yieldValue?.emit === 'progress') {
        const rawValue = typeof yieldValue.value === 'number' ? yieldValue.value : 0;
        const progress = rawValue <= 1 ? rawValue * 100 : rawValue;
        broadcasts.push({
          jsonrpc: '2.0',
          method: 'notifications/progress',
          params: {
            progressToken: `progress_${photonName}_${methodName}`,
            progress,
            total: 100,
            message: yieldValue.message || null,
          },
        });
      }
    };

    const result = await loader.executeTool(mcp, 'connect', {}, { outputHandler });
    expect(result).toEqual({ connected: true });

    // Verify beam/render broadcasts
    expect(broadcasts).toHaveLength(2);

    // First: QR code
    expect(broadcasts[0].method).toBe('beam/render');
    expect(broadcasts[0].params.photon).toBe('beam-render');
    expect(broadcasts[0].params.method).toBe('connect');
    expect(broadcasts[0].params.format).toBe('qr');
    expect(broadcasts[0].params.value).toBe('https://pair.example.com/xyz');

    // Second: text
    expect(broadcasts[1].method).toBe('beam/render');
    expect(broadcasts[1].params.format).toBe('text');
    expect(broadcasts[1].params.value).toBe('Scan the QR code');
  });

  it('beam/render carries _source when photon name is set', async () => {
    const photonContent = `
      export default class SourceTest {
        /**
         * Test source attribution
         */
        async show() {
          this.render('metric', { label: 'Users', value: 42 });
          return 'ok';
        }
      }
    `;

    const testFile = await createTestPhoton('source-test', photonContent);
    const loader = new PhotonLoader();
    const mcp = await loader.loadFile(testFile);

    const captured: any[] = [];
    const outputHandler = (emit: any) => {
      captured.push(emit);
    };

    await loader.executeTool(mcp, 'show', {}, { outputHandler });

    const renderEvent = captured.find((e) => e?.emit === 'render');
    expect(renderEvent).toBeDefined();
    // _source is added by the emit() pipeline when _photonName is set
    expect(renderEvent._source).toBe('source-test');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CROSS-CUTTING: EmitRender type validation
// ═══════════════════════════════════════════════════════════════════════════════

describe('EmitRender type', () => {
  it('is part of the EmitYield union', async () => {
    // Verify the type exists and has the right shape
    const {} = await import('@portel/photon-core');

    // If this compiles and runs, the type is correctly exported
    const renderEmit: import('@portel/photon-core').EmitRender = {
      emit: 'render',
      format: 'table',
      value: [1, 2, 3],
    };

    expect(renderEmit.emit).toBe('render');
    expect(renderEmit.format).toBe('table');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// RENDER ZONE: CLI clear-and-replace behavior
// ═══════════════════════════════════════════════════════════════════════════════

describe('CLI Render Zone', () => {
  it('clearRenderZone is exported from loader', async () => {
    const { clearRenderZone } = await import('../src/loader.js');
    expect(typeof clearRenderZone).toBe('function');
    // Should not throw when called with no active render
    clearRenderZone();
  });
});

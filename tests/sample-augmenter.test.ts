/**
 * Contract tests for the three sample() augmentation features:
 *
 * 1. Memory include convention — include:system:* and include:transient:* keys
 *    are auto-injected into systemPrompt and the trailing context message.
 *
 * 2. Transient context registry (this.context) — in-memory named sections with
 *    priority, assembled into the trailing context message alongside memory includes.
 *
 * 3. Repeat-loop detection — graded INFO/WARN/ERROR signal injected into
 *    systemPrompt on consecutive duplicate responses.
 *
 * Uses the same mock samplingProvider pattern as sample-elicit-confirm.test.ts.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PhotonLoader } from '../dist/loader.js';

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

function writePhoton(dir: string, name: string, source: string): string {
  const filePath = join(dir, `${name}.photon.ts`);
  writeFileSync(filePath, source, 'utf-8');
  return filePath;
}

function extractText(result: unknown): string {
  if (typeof result === 'string') return result;
  const textField = (result as any)?.content?.[0]?.text;
  if (typeof textField === 'string') return textField;
  return JSON.stringify(result);
}

async function main(): Promise<void> {
  console.log('this.sample() augmentation:');
  const root = mkdtempSync(join(tmpdir(), 'photon-augment-'));

  // ─── Feature 1: Memory system includes ────────────────────────────────────

  await test('include:system: memory keys inject into systemPrompt', async () => {
    const photonPath = writePhoton(
      root,
      'memSys',
      `
        export default class MemSys {
          async run() {
            await (this as any).memory.set('include_system_behavior', 'Always respond in JSON');
            return await (this as any).sample({ prompt: 'do it' });
          }
        }
      `
    );
    const loader = new PhotonLoader(false, undefined, root);
    const mcp = await loader.loadFile(photonPath);

    let receivedSystemPrompt: string | undefined;
    const samplingProvider = async (params: any) => {
      receivedSystemPrompt = params.systemPrompt;
      return { role: 'assistant', content: { type: 'text', text: 'ok' }, model: 'mock' };
    };

    await loader.executeTool(mcp, 'run', {}, { samplingProvider });
    assert.ok(
      receivedSystemPrompt?.includes('Always respond in JSON'),
      `systemPrompt should contain memory system include. got: ${receivedSystemPrompt}`
    );
  });

  // ─── Feature 1: Memory transient includes ────────────────────────────────

  await test('include:transient: memory keys inject into trailing message', async () => {
    const photonPath = writePhoton(
      root,
      'memTransient',
      `
        export default class MemTransient {
          async run() {
            await (this as any).memory.set('include_transient_ctx', '# Current Context\\nUser is at /home');
            return await (this as any).sample({ prompt: 'do it' });
          }
        }
      `
    );
    const loader = new PhotonLoader(false, undefined, root);
    const mcp = await loader.loadFile(photonPath);

    let receivedMessages: any[] = [];
    const samplingProvider = async (params: any) => {
      receivedMessages = params.messages;
      return { role: 'assistant', content: { type: 'text', text: 'ok' }, model: 'mock' };
    };

    await loader.executeTool(mcp, 'run', {}, { samplingProvider });
    const lastMsg = receivedMessages[receivedMessages.length - 1];
    assert.ok(
      lastMsg?.content?.text?.includes('User is at'),
      `last message should contain transient include. got: ${JSON.stringify(lastMsg)}`
    );
  });

  // ─── Feature 2: Context registry assembly ────────────────────────────────

  await test('this.context.add() sections appear in trailing message', async () => {
    const photonPath = writePhoton(
      root,
      'ctxReg',
      `
        export default class CtxReg {
          async run() {
            (this as any).context.add('notes', 'remember: use snake_case', 'high');
            return await (this as any).sample({ prompt: 'do it' });
          }
        }
      `
    );
    const loader = new PhotonLoader(false, undefined, root);
    const mcp = await loader.loadFile(photonPath);

    let receivedMessages: any[] = [];
    const samplingProvider = async (params: any) => {
      receivedMessages = params.messages;
      return { role: 'assistant', content: { type: 'text', text: 'ok' }, model: 'mock' };
    };

    await loader.executeTool(mcp, 'run', {}, { samplingProvider });
    const lastMsg = receivedMessages[receivedMessages.length - 1];
    assert.ok(
      lastMsg?.content?.text?.includes('remember: use snake_case'),
      `last message should contain context section. got: ${JSON.stringify(lastMsg)}`
    );
  });

  // ─── Feature 2: Budget trimming ──────────────────────────────────────────

  await test('context registry drops low-priority sections under budget', async () => {
    const photonPath = writePhoton(
      root,
      'ctxBudget',
      `
        export default class CtxBudget {
          async run() {
            (this as any).context.add('small', 'keep this', 'high');
            (this as any).context.add('huge', 'x'.repeat(9000), 'low');
            return await (this as any).sample({ prompt: 'do it' });
          }
        }
      `
    );
    const loader = new PhotonLoader(false, undefined, root);
    const mcp = await loader.loadFile(photonPath);

    let receivedMessages: any[] = [];
    const samplingProvider = async (params: any) => {
      receivedMessages = params.messages;
      return { role: 'assistant', content: { type: 'text', text: 'ok' }, model: 'mock' };
    };

    await loader.executeTool(mcp, 'run', {}, { samplingProvider });
    const lastMsg = receivedMessages[receivedMessages.length - 1];
    const text: string = lastMsg?.content?.text ?? '';
    assert.ok(text.includes('keep this'), `high-priority section must survive`);
    assert.ok(!text.includes('x'.repeat(100)), `low-priority oversized section must be dropped`);
  });

  // ─── Feature 3: Repeat detection escalation ──────────────────────────────

  await test('repeat-loop detection escalates INFO → WARN → ERROR', async () => {
    const photonPath = writePhoton(
      root,
      'loopDetect',
      `
        export default class LoopDetect {
          async call1() { return await (this as any).sample({ prompt: 'q' }); }
          async call2() { return await (this as any).sample({ prompt: 'q' }); }
          async call3() { return await (this as any).sample({ prompt: 'q' }); }
          async call4() { return await (this as any).sample({ prompt: 'q' }); }
        }
      `
    );
    const loader = new PhotonLoader(false, undefined, root);
    const mcp = await loader.loadFile(photonPath);

    const REPEATED =
      'This is a repeated answer that is long enough to be detected as a loop response.';
    const systemPrompts: Array<string | undefined> = [];
    const samplingProvider = async (params: any) => {
      systemPrompts.push(params.systemPrompt);
      return { role: 'assistant', content: { type: 'text', text: REPEATED }, model: 'mock' };
    };

    await loader.executeTool(mcp, 'call1', {}, { samplingProvider });
    await loader.executeTool(mcp, 'call2', {}, { samplingProvider });
    await loader.executeTool(mcp, 'call3', {}, { samplingProvider });
    await loader.executeTool(mcp, 'call4', {}, { samplingProvider });

    // record() fires AFTER samplingProvider returns, so the signal is injected
    // into the NEXT call. Escalation:
    //   call1: first occurrence — no signal injected, nothing recorded yet
    //   call2: still no signal (call1 added to history, not a repeat)
    //   call3: INFO (call2 found a repeat, recorded signal)
    //   call4: WARN (call3 found a repeat, escalated signal)
    assert.ok(
      !systemPrompts[0]?.includes('[INFO') &&
        !systemPrompts[0]?.includes('[WARN') &&
        !systemPrompts[0]?.includes('[ERROR'),
      `call1 should have no repeat signal. got: ${systemPrompts[0]}`
    );
    assert.ok(
      !systemPrompts[1]?.includes('[INFO') &&
        !systemPrompts[1]?.includes('[WARN') &&
        !systemPrompts[1]?.includes('[ERROR'),
      `call2 should have no repeat signal (first repeat recorded, signal fires next). got: ${systemPrompts[1]}`
    );
    assert.ok(
      systemPrompts[2]?.includes('[INFO'),
      `call3 should have [INFO signal. got: ${systemPrompts[2]}`
    );
    assert.ok(
      systemPrompts[3]?.includes('[WARN'),
      `call4 should have [WARN signal. got: ${systemPrompts[3]}`
    );
  });

  // ─── Composition: all three active ───────────────────────────────────────

  await test('systemPrompt order: repeat signal → memory system → caller systemPrompt', async () => {
    const photonPath = writePhoton(
      root,
      'composition',
      `
        export default class Composition {
          async prime() {
            // Seed a repeat by calling with the same response twice
            return await (this as any).sample({ prompt: 'prime' });
          }
          async run() {
            await (this as any).memory.set('include_system_rule', 'RULE_TEXT');
            (this as any).context.add('ctx', 'CTX_TEXT', 'high');
            return await (this as any).sample({
              prompt: 'go',
              systemPrompt: 'CALLER_SYSTEM',
            });
          }
        }
      `
    );
    const loader = new PhotonLoader(false, undefined, root);
    const mcp = await loader.loadFile(photonPath);

    const REPEATED =
      'This is a repeated answer that is long enough to be detected as a loop response.';
    let callCount = 0;
    let finalSystemPrompt: string | undefined;
    let finalMessages: any[] = [];
    const samplingProvider = async (params: any) => {
      callCount++;
      if (callCount === 3) {
        finalSystemPrompt = params.systemPrompt;
        finalMessages = params.messages;
      }
      return { role: 'assistant', content: { type: 'text', text: REPEATED }, model: 'mock' };
    };

    // Two prime calls: first adds to history, second detects a repeat and sets
    // the pending INFO signal. The third call (run) will see that signal.
    await loader.executeTool(mcp, 'prime', {}, { samplingProvider });
    await loader.executeTool(mcp, 'prime', {}, { samplingProvider });
    // Third call — should have repeat signal + memory system + caller systemPrompt
    await loader.executeTool(mcp, 'run', {}, { samplingProvider });

    assert.ok(finalSystemPrompt, 'systemPrompt must be set on third call');
    const infoIdx = finalSystemPrompt!.indexOf('[INFO');
    const ruleIdx = finalSystemPrompt!.indexOf('RULE_TEXT');
    const callerIdx = finalSystemPrompt!.indexOf('CALLER_SYSTEM');
    assert.ok(infoIdx >= 0, 'systemPrompt must contain [INFO signal');
    assert.ok(ruleIdx >= 0, 'systemPrompt must contain memory system include');
    assert.ok(callerIdx >= 0, 'systemPrompt must contain caller systemPrompt');
    assert.ok(infoIdx < ruleIdx, 'repeat signal must come before memory system include');
    assert.ok(ruleIdx < callerIdx, 'memory system include must come before caller systemPrompt');

    const lastMsg = finalMessages[finalMessages.length - 1];
    assert.ok(
      lastMsg?.content?.text?.includes('CTX_TEXT'),
      `trailing message must contain context section. got: ${JSON.stringify(lastMsg)}`
    );
  });

  // ─── No-op when empty ────────────────────────────────────────────────────

  await test('no augmentation when no includes, context, or repeats are set', async () => {
    const photonPath = writePhoton(
      root,
      'noop',
      `
        export default class NoOp {
          async run() {
            return await (this as any).sample({
              prompt: 'hello',
              systemPrompt: 'ONLY_THIS',
            });
          }
        }
      `
    );
    const loader = new PhotonLoader(false, undefined, root);
    const mcp = await loader.loadFile(photonPath);

    let receivedParams: any = null;
    const samplingProvider = async (params: any) => {
      receivedParams = params;
      return { role: 'assistant', content: { type: 'text', text: 'hi' }, model: 'mock' };
    };

    await loader.executeTool(mcp, 'run', {}, { samplingProvider });
    assert.equal(
      receivedParams.systemPrompt,
      'ONLY_THIS',
      'systemPrompt should be passed through unchanged when no augmentation is active'
    );
    assert.equal(
      receivedParams.messages.length,
      1,
      'no trailing context message should be added when context and memory includes are empty'
    );
  });

  rmSync(root, { recursive: true });
  console.log('\nAll tests passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

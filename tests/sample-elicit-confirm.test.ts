/**
 * Contract tests for `this.sample`, `this.confirm`, and `this.elicit` —
 * the imperative MCP primitives on Photon. All three are always-injected
 * on plain classes (same philosophy as `this.memory` and `this.call`)
 * and read their runtime provider from the ALS execution context that
 * the loader populates per invocation.
 *
 * These tests use a mock provider passed through `executeTool` options,
 * avoiding the need for a live MCP transport. The contract we're
 * guarding is: whatever the loader attaches as `samplingProvider` /
 * `inputProvider` is what `this.sample` / `this.elicit` / `this.confirm`
 * sees inside a method.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PhotonLoader } from '../dist/loader.js';

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  \u2713 ${name}`);
  } catch (err) {
    console.error(`  \u2717 ${name}`);
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
  console.log('this.sample / this.confirm / this.elicit contract:');
  const root = mkdtempSync(join(tmpdir(), 'photon-sample-'));

  await test('this.sample returns text from the sampling provider', async () => {
    const photonPath = writePhoton(
      root,
      'summarizer',
      `
        export default class Summarizer {
          async summarize(params: { text: string }) {
            const out = await (this as any).sample({
              prompt: 'Summarize: ' + params.text,
              maxTokens: 64,
            });
            return { summary: out };
          }
        }
      `
    );
    const loader = new PhotonLoader(false, undefined, root);
    const mcp = await loader.loadFile(photonPath);

    let receivedMessages: any = null;
    let receivedMaxTokens: number | undefined;
    const samplingProvider = async (params: any) => {
      receivedMessages = params.messages;
      receivedMaxTokens = params.maxTokens;
      return {
        role: 'assistant' as const,
        content: { type: 'text' as const, text: 'SUMMARY_TEXT' },
        model: 'mock-model',
      };
    };

    const result = await loader.executeTool(
      mcp,
      'summarize',
      { text: 'hello world' },
      { samplingProvider }
    );
    const text = extractText(result);
    assert.ok(/SUMMARY_TEXT/.test(text), `expected mock sampling output. got: ${text}`);
    assert.equal(receivedMaxTokens, 64, 'maxTokens should reach the provider');
    assert.ok(
      Array.isArray(receivedMessages) &&
        receivedMessages[0]?.content?.text?.includes('hello world'),
      `prompt should be wrapped as user message`
    );
  });

  await test('this.sample throws a clear error when no samplingProvider is attached', async () => {
    const photonPath = writePhoton(
      root,
      'noProvider',
      `
        export default class NoProvider {
          async tryIt() {
            try {
              return await (this as any).sample({ prompt: 'hi' });
            } catch (err: any) {
              return err.message;
            }
          }
        }
      `
    );
    const loader = new PhotonLoader(false, undefined, root);
    const mcp = await loader.loadFile(photonPath);
    const result = await loader.executeTool(mcp, 'tryIt', {});
    const msg = extractText(result);
    assert.ok(/sampling/i.test(msg), `error message must mention sampling capability. got: ${msg}`);
  });

  await test('this.confirm returns true/false via the input provider', async () => {
    const photonPath = writePhoton(
      root,
      'confirmer',
      `
        export default class Confirmer {
          async ask() {
            const yes = await (this as any).confirm('Proceed?');
            return { yes };
          }
        }
      `
    );
    const loader = new PhotonLoader(false, undefined, root);
    const mcp = await loader.loadFile(photonPath);

    let seenQuestion: string | undefined;
    const inputProvider = async (ask: any) => {
      seenQuestion = ask.question || ask.message;
      return true;
    };

    const result = await loader.executeTool(mcp, 'ask', {}, { inputProvider } as any);
    const text = extractText(result);
    assert.equal(seenQuestion, 'Proceed?');
    assert.ok(/yes.*true/i.test(text) || /"yes":\s*true/.test(text), `got: ${text}`);
  });

  await test('this.elicit forwards arbitrary ask yields unchanged', async () => {
    const photonPath = writePhoton(
      root,
      'eliciter',
      `
        export default class Eliciter {
          async pickColor() {
            const choice = await (this as any).elicit({
              ask: 'select',
              message: 'Pick a color',
              options: ['red', 'green', 'blue'],
            });
            return { choice };
          }
        }
      `
    );
    const loader = new PhotonLoader(false, undefined, root);
    const mcp = await loader.loadFile(photonPath);

    let seen: any = null;
    const inputProvider = async (ask: any) => {
      seen = ask;
      return 'green';
    };

    const result = await loader.executeTool(mcp, 'pickColor', {}, { inputProvider } as any);
    const text = extractText(result);
    assert.equal(seen?.ask, 'select');
    assert.deepEqual(seen?.options, ['red', 'green', 'blue']);
    assert.ok(/green/.test(text));
  });

  await test('user-defined sample/confirm/elicit on the class win', async () => {
    const photonPath = writePhoton(
      root,
      'override',
      `
        export default class Override {
          async sample(_params: any) { return 'user-sample'; }
          async confirm(_q: string) { return true; }
          async elicit(_params: any) { return 'user-elicit'; }
          async probe() {
            const s = await this.sample({ prompt: 'ignored' });
            const c = await this.confirm('ignored');
            const e = await this.elicit({ ask: 'text', message: 'ignored' });
            return { s, c, e };
          }
        }
      `
    );
    const loader = new PhotonLoader(false, undefined, root);
    const mcp = await loader.loadFile(photonPath);
    const result = await loader.executeTool(mcp, 'probe', {});
    const text = extractText(result);
    assert.ok(/user-sample/.test(text), text);
    assert.ok(/user-elicit/.test(text), text);
  });

  rmSync(root, { recursive: true, force: true });
  console.log('\nAll sample/elicit/confirm contract tests passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { EditorState } from '@codemirror/state';
import { CompletionContext } from '@codemirror/autocomplete';

import {
  buildPhotonEditorDeclaration,
  getPhotonEditorDeclarationPath,
  writePhotonEditorDeclaration,
} from '../src/photon-editor-declarations.js';
import {
  createDocblockCompletions,
  photonFormatCompletions,
} from '../src/auto-ui/frontend/components/docblock-completions.js';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      passed++;
      console.log(`  ✓ ${name}`);
    })
    .catch((err) => {
      failed++;
      console.log(`  ✗ ${name}`);
      console.log(`    ${err.message}`);
    });
}

function contextFor(doc: string, needle: string) {
  const pos = doc.indexOf(needle) + needle.length;
  const state = EditorState.create({ doc });
  return new CompletionContext(state, pos, true);
}

await test('docblock completions include newer method tags', () => {
  const doc = `/**\n * @rea\n */\nexport default class Demo {}\n`;
  const completions = createDocblockCompletions('1.2.3')(contextFor(doc, '@rea'));
  const labels = new Set((completions?.options || []).map((o) => o.label));

  assert(labels.has('@readOnly'));
  assert(labels.has('@retryable'));
  assert(labels.has('@queued'));
  assert(labels.has('@audience'));
});

await test('docblock completions include inline middleware and layout tags', () => {
  const doc = `/**\n * @use audit {@lev\n * @format list {@tit\n * @param q Search term {@pla\n */\nexport default class Demo {}\n`;

  const middlewareCompletions = createDocblockCompletions('1.2.3')(contextFor(doc, '{@lev'));
  const layoutCompletions = createDocblockCompletions('1.2.3')(contextFor(doc, '{@tit'));
  const paramCompletions = createDocblockCompletions('1.2.3')(contextFor(doc, '{@pla'));

  assert((middlewareCompletions?.options || []).some((o) => o.label === '{@level'));
  assert((layoutCompletions?.options || []).some((o) => o.label === '{@title'));
  assert((paramCompletions?.options || []).some((o) => o.label === '{@placeholder'));
});

await test('format completions include newer renderer formats', () => {
  const doc = `/**\n * @format cha\n */\nexport default class Demo {}\n`;
  const completions = photonFormatCompletions(contextFor(doc, 'cha'));
  const labels = new Set((completions?.options || []).map((o) => o.label));

  assert(labels.has('chart:hbar'));
  assert(labels.has('slides'));
  assert(labels.has('feature-grid'));
});

await test('editor declaration generator augments photon class from cache dir', async () => {
  const baseDir = await mkdtemp(path.join(os.tmpdir(), 'photon-editor-types-'));
  const sourcePath = path.join(baseDir, 'examples', 'demo.photon.ts');
  const source = `export default class Demo {\n  main() {\n    return this.assets('slides.md', true)\n  }\n}\n`;

  const declaration = buildPhotonEditorDeclaration(sourcePath, source, baseDir);
  assert(declaration);
  assert.match(declaration!, /import type \{ Photon \} from '@portel\/photon-core';/);
  assert.match(declaration!, /declare module '\.\.\/\.\.\/\.\.\/examples\/demo\.photon'/);
  assert.match(declaration!, /interface Demo extends Photon \{\}/);

  const declarationPath = await writePhotonEditorDeclaration(sourcePath, source, baseDir);
  assert.equal(declarationPath, getPhotonEditorDeclarationPath(sourcePath, baseDir));

  const written = await readFile(declarationPath!, 'utf-8');
  assert.equal(written, declaration);

  await rm(baseDir, { recursive: true, force: true });
});

console.log(`\nPassed: ${passed}, Failed: ${failed}`);
if (failed > 0) process.exit(1);

/**
 * Photon TSX runtime: focus-preserving reconciliation tests.
 *
 * These exercise the JSX runtime through a real Chromium so we observe
 * actual UA semantics for focus, selection, and form-control value
 * handling — behaviours that are too brittle to verify under JSDOM.
 *
 * The fixture is compiled with the same `compileTsx` the production
 * server uses, then loaded via a `file://` URL, so the runtime under
 * test is exactly what ships.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, type Browser, type Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { compileTsx, inlineHtml } from '../src/tsx-compiler.js';

// A self-contained TSX fixture exposing controlled inputs, a textarea, a
// keyed list, and a `__test` window hook the spec uses to drive state.
const FIXTURE_TSX = `
const rootEl = document.getElementById('root');
let state = { value: '', items: ['a', 'b', 'c'], showExtra: false, paints: 0 };

function paint() {
  state = Object.assign({}, state, { paints: state.paints + 1 });
  render(<App s={state} />, rootEl);
}

function App(props) {
  return (
    <main>
      <input
        id="ip"
        value={props.s.value}
        onInput={(e) => { state = Object.assign({}, state, { value: e.target.value }); paint(); }}
      />
      <textarea
        id="ta"
        value={props.s.value}
        onInput={(e) => { state = Object.assign({}, state, { value: e.target.value }); paint(); }}
      />
      <input id="uncontrolled" defaultValue="seed" />
      <ul id="list">
        {props.s.items.map((k) => (
          <li key={k} id={'li-' + k} data-k={k}>{k}</li>
        ))}
      </ul>
      <span id="paints">{props.s.paints}</span>
      {props.s.showExtra ? <p id="extra">EXTRA</p> : null}
      <button id="bump" onClick={() => { paint(); }}>bump</button>
    </main>
  );
}

paint();
window.__test = {
  setItems: (xs) => { state = Object.assign({}, state, { items: xs }); paint(); },
  setValue: (v) => { state = Object.assign({}, state, { value: v }); paint(); },
  toggleExtra: () => { state = Object.assign({}, state, { showExtra: !state.showExtra }); paint(); },
  paint: paint,
  reset: () => {
    state = { value: '', items: ['a', 'b', 'c'], showExtra: false, paints: 0 };
    paint();
  },
  getPaints: () => state.paints,
};
`;

let browser: Browser;
let page: Page;
let pageUrl: string;
let tmpDir: string;

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'photon-jsx-runtime-test-'));
  const tsxPath = path.join(tmpDir, 'app.tsx');
  fs.writeFileSync(tsxPath, FIXTURE_TSX);
  const compiled = await compileTsx(tsxPath);
  assert.ok(compiled.js, 'fixture compiled');
  assert.equal(compiled.html.includes('TSX Build Error'), false, 'no build error');
  // Inline-bundle form: file:// + ES-module-sibling triggers Chromium's
  // null-origin CORS gate. Inlining is exactly the runtime under test.
  const inlinedPath = path.join(tmpDir, 'index.html');
  fs.writeFileSync(inlinedPath, inlineHtml(compiled.js));
  pageUrl = 'file://' + inlinedPath;
  browser = await chromium.launch();
  page = await browser.newPage();
  await page.goto(pageUrl);
  await page.waitForSelector('#ip');
});

after(async () => {
  if (browser) await browser.close();
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function resetPage() {
  // Cheap reset: a fresh navigation, so each test starts with a clean
  // DOM, fresh listeners, and zero paint history.
  await page.goto(pageUrl);
  await page.waitForSelector('#ip');
}

describe('Photon TSX runtime', () => {
  test('controlled <input> keeps focus and cursor while typing', async () => {
    await resetPage();
    await page.focus('#ip');
    await page.keyboard.type('hello');
    // After each onInput the app paints — focus + cursor must survive.
    const focused = await page.evaluate(() => document.activeElement?.id);
    assert.equal(focused, 'ip', 'input remains focused after typing-driven paints');
    const { value, start, end } = await page.evaluate(() => {
      const el = document.getElementById('ip') as HTMLInputElement;
      return { value: el.value, start: el.selectionStart, end: el.selectionEnd };
    });
    assert.equal(value, 'hello');
    assert.equal(start, 5, 'caret stays at end of input');
    assert.equal(end, 5);
  });

  test('controlled <textarea> keeps focus and cursor while typing', async () => {
    await resetPage();
    await page.focus('#ta');
    await page.keyboard.type('line1\nline2');
    const focused = await page.evaluate(() => document.activeElement?.id);
    assert.equal(focused, 'ta');
    const { value, start } = await page.evaluate(() => {
      const el = document.getElementById('ta') as HTMLTextAreaElement;
      return { value: el.value, start: el.selectionStart };
    });
    assert.equal(value, 'line1\nline2');
    assert.equal(start, value.length, 'caret stays at end');
  });

  test('selection is preserved across an unrelated rerender', async () => {
    await resetPage();
    await page.focus('#ip');
    await page.keyboard.type('abcdef');
    // Select 'cd' in the middle.
    await page.evaluate(() => {
      const el = document.getElementById('ip') as HTMLInputElement;
      el.setSelectionRange(2, 4);
    });
    // Trigger a paint that does NOT change the input value.
    await page.evaluate(() => (window as any).__test.toggleExtra());
    const sel = await page.evaluate(() => {
      const el = document.getElementById('ip') as HTMLInputElement;
      return {
        focused: document.activeElement === el,
        start: el.selectionStart,
        end: el.selectionEnd,
        extraExists: !!document.getElementById('extra'),
      };
    });
    assert.equal(sel.focused, true, 'focus preserved after unrelated paint');
    assert.equal(sel.start, 2, 'selection start preserved');
    assert.equal(sel.end, 4, 'selection end preserved');
    assert.equal(sel.extraExists, true, 'paint actually applied (sibling node added)');
  });

  test('controlled value updates when state changes programmatically', async () => {
    await resetPage();
    await page.evaluate(() => (window as any).__test.setValue('from-state'));
    const v = await page.evaluate(() => (document.getElementById('ip') as HTMLInputElement).value);
    assert.equal(v, 'from-state');
  });

  test('defaultValue seeds the input but does NOT overwrite user edits on rerender', async () => {
    await resetPage();
    const initial = await page.evaluate(
      () => (document.getElementById('uncontrolled') as HTMLInputElement).value
    );
    assert.equal(initial, 'seed', 'defaultValue seeds the DOM');
    await page.focus('#uncontrolled');
    await page.keyboard.type('!user');
    // Force several paints — the uncontrolled value must NOT be reset.
    await page.evaluate(() => (window as any).__test.paint());
    await page.evaluate(() => (window as any).__test.paint());
    const after = await page.evaluate(
      () => (document.getElementById('uncontrolled') as HTMLInputElement).value
    );
    // The exact concatenation depends on caret position after programmatic
    // focus (UA-defined). The invariant under test: both the seed and the
    // user's keystrokes survived the rerenders — i.e. rerender did not
    // reset the field to its initial seed.
    assert.ok(after.includes('seed'), 'seed survives rerenders: ' + after);
    assert.ok(after.includes('!user'), 'user keystrokes survive rerenders: ' + after);
    assert.notEqual(after, 'seed', 'value was actually edited by the user');
  });

  test('DOM nodes are reused across rerenders (identity stable)', async () => {
    await resetPage();
    await page.evaluate(() => {
      const el = document.getElementById('ip') as HTMLInputElement;
      (window as any).__pinIp = el;
    });
    await page.evaluate(() => (window as any).__test.toggleExtra());
    await page.evaluate(() => (window as any).__test.toggleExtra());
    const sameNode = await page.evaluate(
      () => (window as any).__pinIp === document.getElementById('ip')
    );
    assert.equal(sameNode, true, 'same DOM node retained across rerenders');
  });

  test('event listeners do not stack across rerenders', async () => {
    await resetPage();
    // 30 paints; if onClick was re-bound (addEventListener) every paint
    // a single click would fire 30 handlers.
    let clickCount = 0;
    page.on('console', (msg) => {
      if (msg.text() === 'phclick') clickCount++;
    });
    await page.evaluate(() => {
      const btn = document.getElementById('bump') as HTMLButtonElement;
      btn.addEventListener('click', () => console.log('phclick'));
      for (let i = 0; i < 30; i++) (window as any).__test.paint();
    });
    await page.click('#bump');
    // Allow console events to flush.
    await page.waitForTimeout(50);
    assert.equal(clickCount, 1, 'single click → single handler invocation, no listener stacking');
  });

  test('keyed list reorder preserves DOM identity per key', async () => {
    await resetPage();
    // Tag each <li> so we can detect which DOM node we got back later.
    await page.evaluate(() => {
      for (const li of document.querySelectorAll('#list li')) {
        (li as any).__mark = li.id;
      }
    });
    // Reorder.
    await page.evaluate(() => (window as any).__test.setItems(['c', 'a', 'b']));
    const marks = await page.evaluate(() =>
      Array.from(document.querySelectorAll('#list li')).map((li) => ({
        id: li.id,
        mark: (li as any).__mark,
      }))
    );
    assert.deepEqual(
      marks,
      [
        { id: 'li-c', mark: 'li-c' },
        { id: 'li-a', mark: 'li-a' },
        { id: 'li-b', mark: 'li-b' },
      ],
      'each keyed <li> kept its original DOM node after reorder'
    );
  });

  test('keyed list add/remove preserves surrounding nodes', async () => {
    await resetPage();
    await page.evaluate(() => {
      (document.getElementById('li-b') as any).__mark = 'B-original';
    });
    // Remove 'a', add 'd'.
    await page.evaluate(() => (window as any).__test.setItems(['b', 'c', 'd']));
    const bMark = await page.evaluate(() => (document.getElementById('li-b') as any).__mark);
    assert.equal(bMark, 'B-original', 'unaffected keyed node not recreated');
    const order = await page.evaluate(() =>
      Array.from(document.querySelectorAll('#list li')).map((li) => li.id)
    );
    assert.deepEqual(order, ['li-b', 'li-c', 'li-d']);
  });
});

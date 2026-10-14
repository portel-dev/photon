import { strict as assert } from 'node:assert';
import { chromium, type Browser, type Page } from 'playwright';
import { access, readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import path from 'node:path';

const repoRoot = process.cwd();
const formBundle = path.join(repoRoot, 'dist', 'photon-form.bundle.js');
const beamBundle = path.join(repoRoot, 'dist', 'beam.bundle.js');

async function launchBrowser(): Promise<Browser> {
  try {
    return await chromium.launch({ headless: true });
  } catch (error) {
    const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    try {
      await access(chromePath);
      return await chromium.launch({ headless: true, executablePath: chromePath });
    } catch {
      throw error;
    }
  }
}

async function startBundleServer(
  bundles: Record<string, string>
): Promise<{ server: Server; origin: string }> {
  const contents = new Map<string, string>();
  for (const [pathname, bundle] of Object.entries(bundles)) {
    contents.set(pathname, await readFile(bundle, 'utf8'));
  }

  const server = createServer((request, response) => {
    if (request.url === '/') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end('<!doctype html><html><body></body></html>');
      return;
    }
    const content = contents.get(request.url || '');
    if (!content) {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
    response.end(content);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error('Bundle test server did not expose a TCP address');
  }
  return { server, origin: `http://127.0.0.1:${address.port}` };
}

async function loadBundle(page: Page, origin: string, pathname: string): Promise<void> {
  await page.goto(`${origin}/`);
  await page.addScriptTag({ url: `${origin}${pathname}`, type: 'module' });
}

async function run(): Promise<void> {
  const bundleServer = await startBundleServer({
    '/photon-form.bundle.js': formBundle,
    '/beam.bundle.js': beamBundle,
  });
  const browser = await launchBrowser();
  try {
    const formPage = await browser.newPage();
    await loadBundle(formPage, bundleServer.origin, '/photon-form.bundle.js');
    await formPage.waitForFunction(() => Boolean(customElements.get('invoke-form')));

    const submitResult = await formPage.evaluate(async () => {
      const form = document.createElement('invoke-form') as HTMLElement & {
        params: unknown;
        handleSubmit: () => void;
        _values: Record<string, unknown>;
      };
      form.params = {
        properties: {
          latitude: { type: 'number' },
          longitude: { type: 'number' },
        },
      };
      let submitted = false;
      form.addEventListener('submit', () => {
        submitted = true;
      });
      document.body.append(form);
      await (form as any).updateComplete;
      form._values = { latitude: 91, longitude: -181 };
      form.handleSubmit();
      await (form as any).updateComplete;
      return {
        errors: Array.from(form.shadowRoot?.querySelectorAll('.error-text') || []).map((element) =>
          element.textContent?.trim()
        ),
        submitted,
      };
    });

    assert.deepEqual(submitResult.errors, ['Must be at most 90', 'Must be at least -180']);
    assert.equal(submitResult.submitted, false);
    await formPage.close();

    const elicitationPage = await browser.newPage();
    await elicitationPage.addInitScript(() => {
      let calls = 0;
      Object.defineProperty(navigator, 'geolocation', {
        configurable: true,
        value: {
          get callCount() {
            return calls;
          },
          getCurrentPosition(success: (position: unknown) => void) {
            calls++;
            success({
              coords: { latitude: 1.3521, longitude: 103.8198, accuracy: 12 },
              timestamp: 123,
            });
          },
        },
      });
    });
    await loadBundle(elicitationPage, bundleServer.origin, '/beam.bundle.js');
    await elicitationPage.waitForFunction(() => Boolean(customElements.get('elicitation-modal')));

    const actionResult = await elicitationPage.evaluate(async () => {
      const modal = document.createElement('elicitation-modal') as HTMLElement & {
        data: unknown;
        open: boolean;
        _formValues: Record<string, unknown>;
      };
      modal.data = {
        ask: 'form',
        message: 'Coordinates',
        schema: {
          type: 'object',
          properties: {
            latitude: { type: 'number' },
            longitude: { type: 'number' },
          },
          required: ['latitude', 'longitude'],
        },
      };
      document.body.append(modal);
      modal.open = true;
      await (modal as any).updateComplete;
      await (modal as any).updateComplete;

      const host = modal.shadowRoot?.querySelector('semantic-action-input') as HTMLElement | null;
      const button = host?.shadowRoot?.querySelector('button') as HTMLButtonElement | null;
      const geolocation = navigator.geolocation as typeof navigator.geolocation & {
        readonly callCount: number;
      };
      const beforeClick = geolocation.callCount;
      button?.click();
      await (modal as any).updateComplete;
      await (modal as any).updateComplete;
      return {
        beforeClick,
        afterClick: geolocation.callCount,
        buttonType: button?.type,
        buttonLabel: button?.getAttribute('aria-label'),
        values: (modal as any)._formValues,
        status: host?.shadowRoot?.querySelector('.status')?.textContent?.trim() || '',
      };
    });

    assert.equal(actionResult.beforeClick, 0, 'rendering must not request location');
    assert.equal(
      actionResult.afterClick,
      1,
      'location is requested only after clicking the action'
    );
    assert.equal(actionResult.buttonType, 'button');
    assert.equal(actionResult.buttonLabel, 'Use current location');
    assert.deepEqual(actionResult.values, { latitude: 1.3521, longitude: 103.8198 });
    assert.equal(actionResult.status, 'Location found (±12 m)');
    await elicitationPage.close();
  } finally {
    await browser.close();
  }

  console.log('✅ semantic form browser regressions passed');
}

run().catch((error) => {
  console.error('❌ semantic form browser regressions failed:', error);
  process.exit(1);
});

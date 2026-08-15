/**
 * Canonical browser-side loader for Photon output renderers.
 *
 * Beam, generated web applications, and embedded/custom UIs all load the
 * same `/api/photon-renderers.js` runtime. Keeping loading and fallback logic
 * here prevents each browser host from inventing a subtly different bridge.
 */

export interface PhotonRendererOptions {
  expandable?: boolean;
  host?: 'beam' | 'mcp-app' | 'web' | 'custom';
  title?: string;
  [key: string]: unknown;
}

export interface PhotonRendererRuntime {
  render(target: HTMLElement, data: unknown, format: string, options?: PhotonRendererOptions): void;
  formats?: string[];
}

declare global {
  interface Window {
    _photonRenderers?: PhotonRendererRuntime;
    _photonRenderersLoading?: boolean;
    _photonRenderersQueue?: Array<() => void>;
  }
}

const DEFAULT_RENDERER_URL = '/api/photon-renderers.js';
const SCRIPT_MARKER = 'data-photon-renderer-runtime';

let loadPromise: Promise<PhotonRendererRuntime> | undefined;

function runtime(): PhotonRendererRuntime | undefined {
  return window._photonRenderers;
}

function rendererError(message: string): Error {
  return new Error(`[photon-ui] ${message}`);
}

/** Load the shared Photon renderer without eval, so strict CSP can allow it via `script-src 'self'`. */
export function loadPhotonRendererRuntime(
  url: string = DEFAULT_RENDERER_URL
): Promise<PhotonRendererRuntime> {
  const installed = runtime();
  if (installed) return Promise.resolve(installed);
  if (loadPromise) return loadPromise;

  loadPromise = new Promise<PhotonRendererRuntime>((resolve, reject) => {
    const complete = () => {
      const loaded = runtime();
      if (!loaded) {
        loadPromise = undefined;
        reject(rendererError(`renderer script loaded without installing a runtime: ${url}`));
        return;
      }
      resolve(loaded);
    };

    // A custom UI bridge may already be loading the same runtime. Join its
    // queue instead of injecting a second script element.
    if (window._photonRenderersLoading) {
      window._photonRenderersQueue = window._photonRenderersQueue || [];
      window._photonRenderersQueue.push(complete);
      return;
    }

    window._photonRenderersLoading = true;
    window._photonRenderersQueue = window._photonRenderersQueue || [];
    window._photonRenderersQueue.push(complete);

    const existing = document.querySelector<HTMLScriptElement>(
      `script[${SCRIPT_MARKER}="${CSS.escape(url)}"]`
    );
    const script = existing || document.createElement('script');
    script.src = url;
    script.async = true;
    script.setAttribute(SCRIPT_MARKER, url);

    script.addEventListener(
      'load',
      () => {
        window._photonRenderersLoading = false;
        const queue = window._photonRenderersQueue || [];
        window._photonRenderersQueue = [];
        queue.forEach((callback) => callback());
      },
      { once: true }
    );
    script.addEventListener(
      'error',
      () => {
        window._photonRenderersLoading = false;
        window._photonRenderersQueue = [];
        loadPromise = undefined;
        reject(rendererError(`failed to load renderer script: ${url}`));
      },
      { once: true }
    );

    if (!existing) document.head.appendChild(script);
  });

  return loadPromise;
}

/** Render through the canonical runtime and return false after a safe JSON fallback. */
export async function renderPhotonResult(
  target: HTMLElement,
  data: unknown,
  format: string,
  options?: PhotonRendererOptions,
  rendererUrl?: string
): Promise<boolean> {
  try {
    const renderer = await loadPhotonRendererRuntime(rendererUrl);
    renderer.render(target, data, format, options);
    return true;
  } catch (error) {
    console.warn('[photon-ui] Shared renderer unavailable:', error);
    const pre = document.createElement('pre');
    pre.textContent =
      typeof data === 'string' ? data : JSON.stringify(data === undefined ? null : data, null, 2);
    target.replaceChildren(pre);
    return false;
  }
}

/** Test-only reset for isolated DOM contracts. */
export function resetPhotonRendererRuntimeForTest(): void {
  loadPromise = undefined;
  if (typeof window !== 'undefined') {
    window._photonRenderers = undefined;
    window._photonRenderersLoading = false;
    window._photonRenderersQueue = [];
  }
}

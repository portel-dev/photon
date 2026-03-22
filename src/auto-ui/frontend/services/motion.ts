/**
 * Universal Motion Observer
 *
 * Watches for elements with data-enter, data-exit, data-depth attributes
 * and applies the corresponding motion CSS classes automatically.
 *
 * Works with any DOM element in any Beam component — not slide-specific.
 * Uses MutationObserver + IntersectionObserver for lifecycle detection.
 *
 * Usage:
 *   import { MotionObserver } from '../services/motion.js';
 *
 *   // In a Lit component:
 *   private _motion = new MotionObserver();
 *
 *   firstUpdated() {
 *     this._motion.observe(this.shadowRoot!);
 *   }
 *
 *   disconnectedCallback() {
 *     this._motion.disconnect();
 *   }
 */

const ENTER_EFFECTS = new Set([
  'fade-in',
  'slide-up',
  'slide-down',
  'slide-in-right',
  'slide-in-left',
  'scale-in',
  'scale-up',
  'flip-in',
  'drop-in',
  'stagger',
  'stagger-fast',
]);

const EXIT_EFFECTS = new Set(['fade-out', 'slide-out-down', 'scale-out', 'zoom-out', 'flip-out']);

const DEPTH_PRESETS: Record<string, string> = {
  front: 'motion-depth-front',
  back: 'motion-depth-back',
  float: 'motion-depth-float',
  tilt: 'motion-tilt',
  'tilt-right': 'motion-tilt-right',
};

/**
 * Parse a depth directive like "tilt(-5, 2)" into inline CSS
 */
function parseDepthDirective(value: string): { className?: string; style?: string } {
  // Check for preset names first
  const preset = DEPTH_PRESETS[value];
  if (preset) return { className: preset };

  // Parse tilt(rotateY, rotateX) syntax
  const tiltMatch = value.match(/^tilt\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)$/);
  if (tiltMatch) {
    const rotY = tiltMatch[1];
    const rotX = tiltMatch[2];
    return { style: `transform: rotateY(${rotY}deg) rotateX(${rotX}deg)` };
  }

  // Parse translateZ value
  const zMatch = value.match(/^z\(\s*([-\d.]+)\s*\)$/);
  if (zMatch) {
    return { style: `transform: translateZ(${zMatch[1]}px)` };
  }

  return {};
}

export class MotionObserver {
  private _mutationObserver: MutationObserver | null = null;
  private _intersectionObserver: IntersectionObserver | null = null;
  private _root: DocumentFragment | HTMLElement | null = null;
  private _observed = new WeakSet<Element>();

  /**
   * Start observing a root element (typically a shadow root) for motion attributes
   */
  observe(root: DocumentFragment | HTMLElement): void {
    this._root = root;

    // Respect reduced motion preference
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }

    // Process existing elements
    this._processExistingElements(root);

    // Watch for new elements being added
    this._mutationObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof HTMLElement) {
            this._processElement(node);
            // Also check children
            for (const child of node.querySelectorAll('[data-enter], [data-depth]')) {
              this._processElement(child as HTMLElement);
            }
          }
        }
      }
    });

    this._mutationObserver.observe(root instanceof HTMLElement ? root : (root as ShadowRoot).host, {
      childList: true,
      subtree: true,
    });

    // IntersectionObserver for viewport-triggered animations
    this._intersectionObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const el = entry.target as HTMLElement;
            const enterEffect = el.dataset.enterOnVisible;
            if (enterEffect && ENTER_EFFECTS.has(enterEffect)) {
              el.classList.add(`motion-${enterEffect}`);
              this._intersectionObserver?.unobserve(el);
            }
          }
        }
      },
      { threshold: 0.1 }
    );
  }

  /**
   * Stop observing
   */
  disconnect(): void {
    this._mutationObserver?.disconnect();
    this._intersectionObserver?.disconnect();
    this._mutationObserver = null;
    this._intersectionObserver = null;
    this._root = null;
  }

  private _processExistingElements(root: DocumentFragment | HTMLElement): void {
    const elements = (root as HTMLElement).querySelectorAll?.(
      '[data-enter], [data-depth], [data-enter-on-visible]'
    );
    if (elements) {
      for (const el of elements) {
        this._processElement(el as HTMLElement);
      }
    }
  }

  private _processElement(el: HTMLElement): void {
    if (this._observed.has(el)) return;
    this._observed.add(el);

    // Enter effect — applied immediately
    const enterEffect = el.dataset.enter;
    if (enterEffect && ENTER_EFFECTS.has(enterEffect)) {
      el.classList.add(`motion-${enterEffect}`);
    }

    // Enter on visible — deferred to intersection
    const enterOnVisible = el.dataset.enterOnVisible;
    if (enterOnVisible && ENTER_EFFECTS.has(enterOnVisible)) {
      this._intersectionObserver?.observe(el);
    }

    // Depth effect
    const depthDirective = el.dataset.depth;
    if (depthDirective) {
      // Ensure parent has perspective
      const parent = el.parentElement;
      if (parent && !parent.classList.contains('motion-perspective')) {
        parent.classList.add('motion-perspective');
      }

      const { className, style } = parseDepthDirective(depthDirective);
      if (className) {
        el.classList.add(className);
      }
      if (style) {
        el.style.cssText += `;${style}`;
      }
    }
  }
}

/**
 * Apply an exit animation to an element, then remove it from DOM
 */
export async function animateOut(el: HTMLElement, effect: string = 'fade-out'): Promise<void> {
  if (!EXIT_EFFECTS.has(effect)) {
    el.remove();
    return;
  }

  // Respect reduced motion
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    el.remove();
    return;
  }

  el.classList.add(`motion-${effect}`);

  return new Promise<void>((resolve) => {
    const onEnd = () => {
      el.removeEventListener('animationend', onEnd);
      el.remove();
      resolve();
    };
    el.addEventListener('animationend', onEnd);

    // Safety timeout — remove even if animation doesn't fire
    setTimeout(() => {
      if (el.parentElement) {
        el.removeEventListener('animationend', onEnd);
        el.remove();
        resolve();
      }
    }, 1000);
  });
}

/**
 * Apply a matte transition between two elements
 *
 * Captures the outgoing element's state, overlays the incoming element,
 * and reveals it using a CSS mask-image transition.
 *
 * @param container - Parent container
 * @param outgoing - Element being replaced
 * @param incoming - Element replacing it
 * @param matte - Matte type: 'radial', 'diagonal', or URL to matte image
 */
export function matteTransition(
  container: HTMLElement,
  outgoing: HTMLElement,
  incoming: HTMLElement,
  matte: string = 'radial'
): void {
  // Respect reduced motion
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    outgoing.replaceWith(incoming);
    return;
  }

  // Position incoming on top of outgoing
  incoming.style.position = 'absolute';
  incoming.style.inset = '0';
  container.style.position = 'relative';
  container.appendChild(incoming);

  // Apply matte class or custom mask-image
  if (matte === 'radial' || matte === 'diagonal') {
    incoming.classList.add(`motion-matte-${matte}`);
  } else {
    incoming.classList.add('motion-matte-reveal');
    incoming.style.maskImage = `url('${matte}')`;
    incoming.style.webkitMaskImage = `url('${matte}')`;
  }

  // Clean up after animation
  incoming.addEventListener(
    'animationend',
    () => {
      outgoing.remove();
      incoming.style.position = '';
      incoming.style.inset = '';
      incoming.style.maskImage = '';
      incoming.style.webkitMaskImage = '';
      incoming.classList.remove(
        'motion-matte-reveal',
        'motion-matte-radial',
        'motion-matte-diagonal'
      );
    },
    { once: true }
  );
}

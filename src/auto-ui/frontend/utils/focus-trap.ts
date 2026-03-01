/**
 * Focus trap utility for modal dialogs.
 * Constrains Tab/Shift+Tab to cycle within a container.
 * Returns a cleanup function to remove the trap.
 */

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

export interface FocusTrapOptions {
  /** Element that triggered the modal — focus returns here on release */
  returnFocusTo?: HTMLElement;
  /** Auto-focus first focusable element on trap activation (default: true) */
  autoFocus?: boolean;
}

export function trapFocus(
  container: HTMLElement | ShadowRoot,
  options: FocusTrapOptions = {}
): () => void {
  const { returnFocusTo, autoFocus = true } = options;
  const root = container instanceof ShadowRoot ? container : container;

  function getFocusableElements(): HTMLElement[] {
    return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
      (el) => el.offsetParent !== null // visible
    );
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key !== 'Tab') return;

    const focusable = getFocusableElements();
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active =
      root instanceof ShadowRoot ? root.activeElement : root.ownerDocument.activeElement;

    if (e.shiftKey) {
      if (active === first || !focusable.includes(active as HTMLElement)) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (active === last || !focusable.includes(active as HTMLElement)) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  // Use the actual DOM element for the event listener
  const eventTarget = container instanceof ShadowRoot ? container.host : container;
  eventTarget.addEventListener('keydown', handleKeydown as EventListener, true);

  // Auto-focus first focusable element
  if (autoFocus) {
    requestAnimationFrame(() => {
      const focusable = getFocusableElements();
      if (focusable.length > 0) {
        focusable[0].focus();
      }
    });
  }

  // Return cleanup function
  return () => {
    eventTarget.removeEventListener('keydown', handleKeydown as EventListener, true);
    if (returnFocusTo && returnFocusTo.isConnected) {
      returnFocusTo.focus();
    }
  };
}

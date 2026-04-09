/**
 * Local elicitation API — triggers the elicitation modal from any component.
 *
 * Uses a custom event on document to communicate with beam-app, which owns
 * the single elicitation-modal instance. This gives all prompts/confirms
 * the same visual treatment as MCP elicitations.
 */

import type { ElicitationData } from '../components/elicitation-modal.js';

export interface ElicitResult {
  action: 'accept' | 'cancel';
  value?: any;
}

/**
 * Show the elicitation modal with the given data and return the user's response.
 * Works from any component — beam-app listens for the event.
 */
export function elicit(data: ElicitationData): Promise<ElicitResult> {
  return new Promise((resolve) => {
    document.dispatchEvent(
      new CustomEvent('beam:elicit-local', {
        detail: { data, resolve },
      })
    );
  });
}

/**
 * Themed confirm dialog — drop-in replacement for window.confirm().
 * Shows the elicitation modal in confirm mode.
 */
export async function confirmElicit(
  message: string,
  options?: { confirm?: string; destructive?: boolean }
): Promise<boolean> {
  const result = await elicit({
    ask: 'confirm',
    message,
    default: false,
    ...(options?.confirm && { placeholder: options.confirm }),
  });
  return result.action === 'accept' && result.value !== false;
}

/**
 * Themed prompt dialog — drop-in replacement for window.prompt().
 * Shows the elicitation modal in text mode.
 */
export async function promptElicit(message: string, defaultValue = ''): Promise<string | null> {
  const result = await elicit({
    ask: 'text',
    message,
    default: defaultValue,
  });
  if (result.action === 'cancel') return null;
  return (result.value as string) ?? null;
}

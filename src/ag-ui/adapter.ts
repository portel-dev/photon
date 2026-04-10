/**
 * AG-UI Protocol Adapter
 *
 * Two functions that bridge AG-UI events with MCP notifications:
 *
 * 1. proxyExternalAgent — connects to an external AG-UI agent, proxies events
 *    back as MCP `ag-ui/event` notifications.
 *
 * 2. createAGUIOutputHandler — wraps Photon method execution so that yields
 *    (stream, progress, emit) are translated to AG-UI events and broadcast
 *    as MCP notifications.
 *
 * No npm dependencies — uses native fetch + manual SSE parsing.
 */

import { randomUUID } from 'crypto';
import { AGUIEventType, type AGUIEvent, type RunAgentInput, type BaseEvent } from './types.js';

// ════════════════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════════════════

type BroadcastFn = (notification: object) => void;

/** Wrap an AG-UI event as a JSON-RPC 2.0 notification */
function wrapNotification(event: AGUIEvent | BaseEvent): object {
  return {
    jsonrpc: '2.0',
    method: 'ag-ui/event',
    params: event,
  };
}

/** Parse a single SSE line-block into an AG-UI event. Returns null for comments/keep-alive. */
function parseSSEEvent(block: string): AGUIEvent | null {
  let data = '';
  for (const line of block.split('\n')) {
    if (line.startsWith('data: ')) {
      data += line.slice(6);
    } else if (line.startsWith('data:')) {
      data += line.slice(5);
    }
  }
  if (!data) return null;
  try {
    return JSON.parse(data) as AGUIEvent;
  } catch {
    return null;
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// PROXY EXTERNAL AGENT
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Connect to an external AG-UI agent, proxy its SSE events as MCP notifications.
 *
 * POST RunAgentInput to agentUrl, parse SSE response, and for each AG-UI event
 * broadcast it as `{ jsonrpc: '2.0', method: 'ag-ui/event', params: event }`.
 *
 * Terminates when RUN_FINISHED or RUN_ERROR is received, or the stream ends.
 */
export async function proxyExternalAgent(
  agentUrl: string,
  input: RunAgentInput,
  broadcast: BroadcastFn
): Promise<void> {
  const response = await fetch(agentUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(300_000), // 5 min timeout for long-running agents
  });

  if (!response.ok) {
    const errorEvent: AGUIEvent = {
      type: AGUIEventType.RUN_ERROR,
      message: `External agent returned HTTP ${response.status}: ${response.statusText}`,
      timestamp: Date.now(),
    };
    broadcast(wrapNotification(errorEvent));
    return;
  }

  if (!response.body) {
    const errorEvent: AGUIEvent = {
      type: AGUIEventType.RUN_ERROR,
      message: 'External agent returned no response body',
      timestamp: Date.now(),
    };
    broadcast(wrapNotification(errorEvent));
    return;
  }

  // Read SSE stream
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let terminated = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // SSE events are separated by double newlines
      let boundary: number;
      while ((boundary = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);

        const event = parseSSEEvent(block);
        if (!event) continue;

        broadcast(wrapNotification(event));

        if (event.type === AGUIEventType.RUN_FINISHED || event.type === AGUIEventType.RUN_ERROR) {
          terminated = true;
          break;
        }
      }

      if (terminated) break;
    }

    // Process any remaining data in the buffer after stream ends
    if (!terminated && buffer.trim()) {
      const event = parseSSEEvent(buffer);
      if (event) {
        broadcast(wrapNotification(event));
        if (event.type === AGUIEventType.RUN_FINISHED || event.type === AGUIEventType.RUN_ERROR) {
          terminated = true;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  // If stream ended without a terminal event, send RUN_ERROR
  if (!terminated) {
    broadcast(
      wrapNotification({
        type: AGUIEventType.RUN_ERROR,
        message: 'External agent stream ended without RUN_FINISHED or RUN_ERROR',
        timestamp: Date.now(),
      })
    );
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// AG-UI OUTPUT HANDLER (wraps photon execution)
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Create an output handler that translates Photon yield values to AG-UI events.
 *
 * Mapping:
 * - Stream chunks (strings)  → TEXT_MESSAGE_START/CONTENT/END
 * - Progress yields          → STEP_STARTED/STEP_FINISHED
 * - Emit yields (custom)     → CUSTOM event
 * - Channel events (patches) → STATE_DELTA
 *
 * Returns { outputHandler, finish, error } — call finish() after successful
 * execution or error() on failure to emit the terminal event.
 */
export function createAGUIOutputHandler(
  photonName: string,
  toolName: string,
  runId: string,
  broadcast: BroadcastFn
): {
  outputHandler: (yieldValue: any) => void;
  finish: (result?: unknown) => void;
  error: (message: string) => void;
} {
  const threadId = `${photonName}/${toolName}`;
  const messageId = randomUUID();
  let textStreamStarted = false;
  let stepActive = false;

  // Emit RUN_STARTED immediately
  broadcast(
    wrapNotification({
      type: AGUIEventType.RUN_STARTED,
      threadId,
      runId,
      timestamp: Date.now(),
    })
  );

  const outputHandler = (yieldValue: any): void => {
    const ts = Date.now();

    // String chunk → text message stream
    if (typeof yieldValue === 'string') {
      if (!textStreamStarted) {
        textStreamStarted = true;
        broadcast(
          wrapNotification({
            type: AGUIEventType.TEXT_MESSAGE_START,
            messageId,
            role: 'assistant',
            timestamp: ts,
          })
        );
      }
      broadcast(
        wrapNotification({
          type: AGUIEventType.TEXT_MESSAGE_CONTENT,
          messageId,
          delta: yieldValue,
          timestamp: ts,
        })
      );
      return;
    }

    if (!yieldValue || typeof yieldValue !== 'object') return;

    // Progress → step events
    if (yieldValue.emit === 'progress') {
      const stepName = yieldValue.message || `${photonName}/${toolName}`;
      if (!stepActive) {
        stepActive = true;
        broadcast(
          wrapNotification({
            type: AGUIEventType.STEP_STARTED,
            stepName,
            timestamp: ts,
          })
        );
      }
      // If progress is 100% or value is 1, finish the step
      const rawValue = typeof yieldValue.value === 'number' ? yieldValue.value : 0;
      const progress = rawValue <= 1 ? rawValue * 100 : rawValue;
      if (progress >= 100) {
        stepActive = false;
        broadcast(
          wrapNotification({
            type: AGUIEventType.STEP_FINISHED,
            stepName,
            timestamp: ts,
          })
        );
      }
      return;
    }

    // Channel events with patches → STATE_DELTA
    if (yieldValue.channel && yieldValue.event) {
      broadcast(
        wrapNotification({
          type: AGUIEventType.STATE_DELTA,
          delta: [
            {
              op: 'replace',
              path: `/${yieldValue.channel}/${yieldValue.event}`,
              value: yieldValue.data,
            },
          ],
          timestamp: ts,
        })
      );
      return;
    }

    // Render emit → CUSTOM
    if (yieldValue.emit === 'render') {
      broadcast(
        wrapNotification({
          type: AGUIEventType.CUSTOM,
          name: 'render',
          value: { format: yieldValue.format, value: yieldValue.value },
          timestamp: ts,
        })
      );
      return;
    }

    // Canvas UI stream → CUSTOM event with HTML layout
    if (yieldValue.emit === 'canvas:ui') {
      broadcast(
        wrapNotification({
          type: AGUIEventType.CUSTOM,
          name: 'canvas:ui',
          value: { html: yieldValue.html },
          timestamp: ts,
        })
      );
      return;
    }

    // Canvas data stream → STATE_DELTA (JSON Patch targeting slot)
    if (yieldValue.emit === 'canvas:data') {
      broadcast(
        wrapNotification({
          type: AGUIEventType.STATE_DELTA,
          delta: [
            {
              op: 'replace',
              path: `/canvas/${yieldValue.slot}`,
              value: yieldValue.data,
            },
          ],
          timestamp: ts,
        })
      );
      return;
    }

    // Any other emit → CUSTOM event
    if (yieldValue.emit) {
      broadcast(
        wrapNotification({
          type: AGUIEventType.CUSTOM,
          name: yieldValue.emit,
          value: yieldValue,
          timestamp: ts,
        })
      );
      return;
    }
  };

  const finish = (result?: unknown): void => {
    const ts = Date.now();

    // Close any open text stream
    if (textStreamStarted) {
      broadcast(
        wrapNotification({
          type: AGUIEventType.TEXT_MESSAGE_END,
          messageId,
          timestamp: ts,
        })
      );
    }

    // Close any open step
    if (stepActive) {
      broadcast(
        wrapNotification({
          type: AGUIEventType.STEP_FINISHED,
          stepName: `${photonName}/${toolName}`,
          timestamp: ts,
        })
      );
    }

    // If result is an object, emit as state snapshot
    if (result && typeof result === 'object') {
      broadcast(
        wrapNotification({
          type: AGUIEventType.STATE_SNAPSHOT,
          snapshot: result,
          timestamp: ts,
        })
      );
    }

    broadcast(
      wrapNotification({
        type: AGUIEventType.RUN_FINISHED,
        threadId,
        runId,
        timestamp: ts,
      })
    );
  };

  const error = (message: string): void => {
    const ts = Date.now();

    // Close any open text stream
    if (textStreamStarted) {
      broadcast(
        wrapNotification({
          type: AGUIEventType.TEXT_MESSAGE_END,
          messageId,
          timestamp: ts,
        })
      );
    }

    broadcast(
      wrapNotification({
        type: AGUIEventType.RUN_ERROR,
        message,
        timestamp: ts,
      })
    );
  };

  return { outputHandler, finish, error };
}

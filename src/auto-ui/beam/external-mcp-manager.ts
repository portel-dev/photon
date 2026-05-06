/**
 * External MCP lifecycle manager.
 *
 * Owns the three coupled containers (`externalMCPs`, `externalMCPClients`,
 * `externalMCPSDKClients`) that beam.ts previously held as separate fields
 * on BeamContext, plus the cohesive add/remove/close operations that
 * touch all three together.
 *
 * Implements `ExternalMCPState` so existing helpers in `external-mcp.ts`
 * (which read the maps directly) continue to work unchanged.
 */

import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { logger } from '../../shared/logger.js';
import { withTimeout } from '../../async/index.js';
import { getErrorMessage } from '../../shared/error-handler.js';
import type { ExternalMCPInfo } from '../types.js';
import type { ExternalMCPState } from './external-mcp.js';

/** Default ms to wait for graceful client close on shutdown. */
const SHUTDOWN_TIMEOUT_MS = 1000;

export class ExternalMCPManager implements ExternalMCPState {
  /** External MCP server metadata (name, methods, connected, etc.). */
  readonly externalMCPs: ExternalMCPInfo[] = [];
  /** Transport-level clients (raw, used by the streamable-HTTP path). */
  readonly externalMCPClients = new Map<string, any>();
  /** SDK Client instances (used for tool calls that need structuredContent). */
  readonly externalMCPSDKClients = new Map<string, Client>();

  /** Append-many. Used after `loadExternalMCPs(...)` returns a list. */
  addAll(mcps: ExternalMCPInfo[]): void {
    this.externalMCPs.push(...mcps);
  }

  /**
   * Remove an MCP by name from all three containers in one atomic-from-JS step.
   * Returns the SDK client (if any) so the caller can close it asynchronously
   * after all map mutations are done — matches the existing two-phase pattern
   * in beam.ts where Maps are made consistent first, then close is awaited.
   */
  removeByName(name: string): { sdkClient?: Client } {
    const idx = this.externalMCPs.findIndex((m) => m.name === name);
    if (idx !== -1) {
      this.externalMCPs.splice(idx, 1);
    }
    const sdkClient = this.externalMCPSDKClients.get(name);
    this.externalMCPSDKClients.delete(name);
    this.externalMCPClients.delete(name);
    return sdkClient ? { sdkClient } : {};
  }

  /**
   * Gracefully close every SDK client and clear the two client maps.
   * Used on Beam shutdown. Logs at debug — close errors during shutdown
   * are expected, not actionable.
   */
  async closeAllSDKClients(): Promise<void> {
    const closePromises: Promise<void>[] = [];

    for (const [name, client] of this.externalMCPSDKClients) {
      closePromises.push(
        client.close().catch((err) => {
          logger.debug(`External MCP close failed for ${name}: ${getErrorMessage(err)}`);
        })
      );
    }

    if (closePromises.length > 0) {
      await withTimeout(
        Promise.all(closePromises),
        SHUTDOWN_TIMEOUT_MS,
        'MCP client close timeout'
      ).catch((err) => {
        logger.debug(`External MCP shutdown timeout: ${getErrorMessage(err)}`);
      });
    }

    this.externalMCPSDKClients.clear();
    this.externalMCPClients.clear();
  }
}

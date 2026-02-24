/**
 * BeamState — Shared state for Beam modules.
 *
 * Replaces the ~30 closure variables in startBeam() with a single
 * typed object that route handlers and utility modules can share.
 */

import type { PhotonLoader } from '../../loader.js';
import type { MarketplaceManager } from '../../marketplace-manager.js';
import type { PhotonContext } from '../../context.js';
import type { SimpleRateLimiter } from '../../shared/security.js';
import type {
  AnyPhotonInfo,
  PhotonInfo,
  UnconfiguredPhotonInfo,
  ExternalMCPInfo,
  MCPServerConfig,
} from '../types.js';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';

/** Unified config structure for config.json */
export interface PhotonConfig {
  photons: Record<string, Record<string, string>>;
  mcpServers: Record<string, MCPServerConfig>;
}

/** Channel subscription with reference counting */
export interface ChannelSubscription {
  photonName: string;
  channelPattern: string;
  refCount: number;
  unsubscribe: () => void;
}

/** Buffered event for replay on new subscriptions */
export interface BufferedEvent {
  channel: string;
  data: unknown;
  timestamp: number;
}

/** Route handler signature: returns true if it handled the request */
export type RouteHandler = (
  req: import('http').IncomingMessage,
  res: import('http').ServerResponse,
  url: URL,
  state: BeamState
) => Promise<boolean>;

/** Callbacks that route handlers can invoke to trigger side effects */
export interface BeamActions {
  broadcastPhotonChange: () => void;
  handleFileChange: (photonName: string) => Promise<void>;
  loadSinglePhoton: (name: string) => Promise<AnyPhotonInfo | null>;
  reconnectExternalMCP: (name: string) => Promise<{ success: boolean; error?: string }>;
  loadUIAsset: (photonName: string, uiId: string) => Promise<string | null>;
  subscribeToChannel: (channel: string) => Promise<void>;
  unsubscribeFromChannel: (channel: string) => void;
  configurePhotonViaMCP: (photonName: string, config: Record<string, any>) => Promise<any>;
  reloadPhotonViaMCP: (photonName: string) => Promise<any>;
  removePhotonViaMCP: (photonName: string) => Promise<any>;
}

/**
 * BeamState — mutable shared state for the Beam server.
 *
 * Created once in startBeam() and passed to all route handlers and utilities.
 * This replaces the closure-captured variables scattered throughout the 4300-line function.
 */
export interface BeamState {
  /** Actions (callbacks) that route handlers can invoke */
  actions: BeamActions;
  /** Resolved working directory */
  workingDir: string;
  /** PhotonContext for path resolution */
  ctx: PhotonContext;
  /** Photon loader instance */
  loader: PhotonLoader;
  /** Marketplace manager */
  marketplace: MarketplaceManager;
  /** In-memory mirror of config.json */
  savedConfig: PhotonConfig;
  /** All loaded photons (configured + unconfigured) */
  photons: AnyPhotonInfo[];
  /** Map of photon name → loaded MCP instance */
  photonMCPs: Map<string, any>;
  /** External MCP server info */
  externalMCPs: ExternalMCPInfo[];
  /** Active MCP transport clients for external MCPs */
  externalMCPClients: Map<string, any>;
  /** Direct SDK clients for resource access */
  externalMCPSDKClients: Map<string, Client>;
  /** Channel subscriptions (ref-counted) */
  channelSubscriptions: Map<string, ChannelSubscription>;
  /** Event buffer for replay */
  channelEventBuffers: Map<string, BufferedEvent[]>;
  /** Per-session view state (which board each session is viewing) */
  sessionViewState: Map<string, string>;
  /** API rate limiter */
  apiRateLimiter: SimpleRateLimiter;
  /** HTTP server instance */
  server: import('http').Server | null;
  /** File watchers */
  watchers: import('fs').FSWatcher[];
  /** Pending reload debounce timers */
  pendingReloads: Map<string, NodeJS.Timeout>;
  /** Currently loading photon names (prevents duplicate loads) */
  activeLoads: Set<string>;
  /** Callbacks to run after a load completes */
  pendingAfterLoad: Map<string, Array<() => void>>;
  /** __dirname of the beam module (for resolving static assets) */
  beamDir: string;
  /** Count of configured photons */
  configuredCount: number;
  /** Count of unconfigured photons */
  unconfiguredCount: number;
}

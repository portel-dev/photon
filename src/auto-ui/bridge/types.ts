/**
 * Types for Unified UI Bridge Architecture
 *
 * Based on @modelcontextprotocol/ext-apps SDK
 */

/**
 * Photon context passed to the bridge
 */
export interface PhotonBridgeContext {
  photon: string;
  method: string;
  theme: 'light' | 'dark';
  locale?: string;
  hostName?: string;
  hostVersion?: string;
}

/**
 * Size constraints from meta tags and host context
 */
export interface SizeConstraints {
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
}

/**
 * Custom Photon notification types (JSON-RPC method names)
 */
export type PhotonNotificationMethod =
  | 'photon/notifications/progress'
  | 'photon/notifications/status'
  | 'photon/notifications/stream'
  | 'photon/notifications/emit'
  | 'photon/notifications/channel-event';

/**
 * Progress notification payload
 */
export interface ProgressNotification {
  percent?: number;
  message?: string;
}

/**
 * Status notification payload
 */
export interface StatusNotification {
  type: 'info' | 'success' | 'error' | 'warn';
  message: string;
}

/**
 * Stream notification payload
 */
export interface StreamNotification {
  chunk: string;
  done?: boolean;
}

/**
 * Emit notification payload
 */
export interface EmitNotification {
  event: string;
  data?: any;
}

/**
 * Channel event notification payload
 */
export interface ChannelEventNotification {
  channel: string;
  event: string;
  data?: any;
}

/**
 * window.photon API interface
 */
export interface PhotonAPI {
  // Data getters
  readonly toolOutput: any;
  readonly toolInput: Record<string, unknown>;
  readonly widgetState: unknown;

  // Event handlers (return unsubscribe function)
  onResult(cb: (data: any) => void): () => void;
  onThemeChange(cb: (theme: 'light' | 'dark') => void): () => void;
  onProgress(cb: (notification: ProgressNotification) => void): () => void;
  onStatus(cb: (notification: StatusNotification) => void): () => void;
  onStream(cb: (notification: StreamNotification) => void): () => void;
  onEmit(cb: (notification: EmitNotification) => void): () => void;

  // Actions
  invoke(name: string, args?: Record<string, unknown>): Promise<any>;
  callTool(name: string, args?: Record<string, unknown>): Promise<any>;
  setWidgetState(state: unknown): void;

  // Context
  readonly theme: 'light' | 'dark';
  readonly locale: string;
}

/**
 * window.openai API interface (OpenAI Apps SDK compatibility)
 */
export interface OpenAIAPI {
  // Context properties
  readonly theme: 'light' | 'dark';
  readonly displayMode: 'inline' | 'fullscreen' | 'pip';
  readonly locale: string;
  readonly maxHeight: number;
  readonly toolInput: Record<string, unknown>;
  readonly toolOutput: unknown;
  readonly widgetState: unknown;

  // Methods
  setWidgetState(state: unknown): void;
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  sendFollowUpMessage(options: { prompt: string }): Promise<void>;
  uploadFile(file: File): Promise<{ fileId: string }>;
  getFileDownloadUrl(options: { fileId: string }): Promise<string>;
  requestDisplayMode(mode: 'inline' | 'fullscreen' | 'pip'): Promise<void>;
  requestModal(options: { params: unknown; template: string }): Promise<unknown>;
  notifyIntrinsicHeight(height: number): void;
  openExternal(options: { href: string }): void;
  setOpenInAppUrl(options: { href: string }): void;
}

declare global {
  interface Window {
    photon: PhotonAPI;
    openai: OpenAIAPI;
  }
}

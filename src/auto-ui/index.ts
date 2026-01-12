/**
 * Auto-UI System for Photon Runtime
 * 
 * Automatically generates UI components based on method return types and docblock hints.
 * Supports MCP, ChatGPT Actions, and custom rendering.
 */

export { AutoUIRenderer } from './renderer';
export { ComponentRegistry } from './registry';
export { ProgressIndicator } from './components/progress';
export { TableComponent } from './components/table';
export { TreeComponent } from './components/tree';
export { FormComponent } from './components/form';
export { CardComponent } from './components/card';
export { ListComponent } from './components/list';
export { startBeam } from './beam';
export * from './types';

// PhotonBridge - unified UI communication layer
export {
  createPhotonBridge,
  generateBridgeLoaderScript,
  type PhotonBridge,
  type EmitEvent,
  type ProgressEvent,
  type StatusEvent,
  type StreamEvent,
  type AskEvent,
  type AskTextEvent,
  type AskConfirmEvent,
  type AskSelectEvent,
  type AskNumberEvent,
  type PhotonContext,
  type HostToUIMessage,
  type UIToHostMessage
} from './photon-bridge';

// PhotonHost - host-side manager for custom UI iframes
export {
  PhotonHost,
  createHostOutputHandler,
  createHostInputProvider,
  type PhotonHostOptions
} from './photon-host';

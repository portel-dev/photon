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
export { startWebSocketPlayground } from './websocket-playground';
export * from './types';

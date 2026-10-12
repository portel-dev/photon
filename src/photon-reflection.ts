import { findPhotonClass, isClass } from '@portel/photon-core';

export type PhotonConstructor = new (...args: unknown[]) => unknown;

export function findExportedPhoton(module: Record<string, unknown>): unknown {
  return findPhotonClass(module);
}

export function isPhotonClass(value: unknown): value is PhotonConstructor {
  return isClass(value);
}

export function getPhotonName(mcpClass: PhotonConstructor): string {
  const classWithStatic = mcpClass as PhotonConstructor & {
    getMCPName?: () => string;
    name: string;
  };
  if (typeof classWithStatic.getMCPName === 'function') return classWithStatic.getMCPName();
  return classWithStatic.name
    .replace(/MCP$/, '')
    .replace(/([A-Z])/g, '-$1')
    .toLowerCase()
    .replace(/^-/, '');
}

export function getPhotonToolMethods(mcpClass: PhotonConstructor): string[] {
  const classWithStatic = mcpClass as PhotonConstructor & {
    getToolMethods?: () => string[];
    prototype: Record<string, unknown>;
  };
  if (typeof classWithStatic.getToolMethods === 'function') {
    return classWithStatic.getToolMethods();
  }

  const prototype = classWithStatic.prototype;
  const methods: string[] = [];
  const conventionMethods = new Set(['constructor', 'onInitialize', 'onShutdown']);
  const builtInStatics = new Set(['length', 'name', 'prototype', 'getToolMethods']);
  Object.getOwnPropertyNames(prototype).forEach((name) => {
    if (name.startsWith('_') || conventionMethods.has(name)) return;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
    if (descriptor && typeof descriptor.value === 'function') methods.push(name);
  });
  const classAsRecord = mcpClass as unknown as Record<string, unknown>;
  Object.getOwnPropertyNames(mcpClass).forEach((name) => {
    if (
      !name.startsWith('_') &&
      !builtInStatics.has(name) &&
      !conventionMethods.has(name) &&
      typeof classAsRecord[name] === 'function'
    ) {
      methods.push(name);
    }
  });
  return methods;
}

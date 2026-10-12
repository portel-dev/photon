import type { OutputHandler } from '@portel/photon-core';

export interface ToolOutputSink {
  emit(value: any): void | Promise<void>;
}

/** Adapts generator/output events to the loader's output handler contract. */
export class OutputPolicy implements ToolOutputSink {
  constructor(private readonly handler?: OutputHandler) {}

  emit(value: any): void | Promise<void> {
    if (!this.handler) return;
    return this.handler(value);
  }
}

export function createOutputPolicy(handler?: OutputHandler): OutputPolicy {
  return new OutputPolicy(handler);
}

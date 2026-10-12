export interface WorkerDependencyPort {
  resolve(
    depName: string,
    depPath: string,
    workerPhoton: string
  ): Promise<{ toolNames: string[] } | null>;
  call(depName: string, method: string, args: Record<string, unknown>): Promise<unknown>;
}

export interface WorkerChannelPort {
  publish(channel: string, message: unknown): void;
  subscribe(workerKey: string, channel: string): void;
  unsubscribe(workerKey: string, channel: string): void;
}

export interface WorkerManagerPorts {
  dependencies?: WorkerDependencyPort;
  channels?: WorkerChannelPort;
}

export interface LoadedPhotonLike {
  instance: unknown;
}

/** Small cache port for dependency and Photon instance reuse. */
export interface PhotonCache<T extends LoadedPhotonLike = LoadedPhotonLike> {
  get(key: string): T | undefined;
  set(key: string, value: T): void;
  getPending(key: string): Promise<T> | undefined;
  setPending(key: string, value: Promise<T>): void;
  deletePending(key: string): void;
  values(): IterableIterator<T>;
  entries(): IterableIterator<[string, T]>;
}

export class InMemoryPhotonCache<
  T extends LoadedPhotonLike = LoadedPhotonLike,
> implements PhotonCache<T> {
  private readonly loaded = new Map<string, T>();
  private readonly pending = new Map<string, Promise<T>>();

  get(key: string): T | undefined {
    return this.loaded.get(key);
  }

  set(key: string, value: T): void {
    this.loaded.set(key, value);
  }

  getPending(key: string): Promise<T> | undefined {
    return this.pending.get(key);
  }

  setPending(key: string, value: Promise<T>): void {
    this.pending.set(key, value);
  }

  deletePending(key: string): void {
    this.pending.delete(key);
  }

  values(): IterableIterator<T> {
    return this.loaded.values();
  }

  entries(): IterableIterator<[string, T]> {
    return this.loaded.entries();
  }
}

/**
 * Parent Photon that injects the Emitter Photon
 * Used to test injected photon event routing
 *
 * @photon emitter ./emitter.photon.ts
 */
import { PhotonMCP } from '@portel/photon-core';

export default class ParentWithEmitter extends PhotonMCP {
  constructor(private emitter: any) {
    super();
  }

  /**
   * Call the emitter's sendAlert method
   */
  async triggerAlert(params: { message: string }): Promise<{ result: any }> {
    const result = await this.emitter.sendAlert({ message: params.message });
    return { result };
  }

  /**
   * Emit an event from this parent photon
   */
  async parentEvent(params: { data: string }): Promise<{ emitted: boolean }> {
    this.emit({ event: 'parentUpdate', data: { value: params.data } });
    return { emitted: true };
  }

  /**
   * Get identity info for both photons
   */
  async getIdentities(): Promise<{
    parent: { photonName: string | undefined; className: string };
    emitter: { photonName: string | undefined; className: string } | null;
  }> {
    let emitterIdentity = null;
    if (this.emitter && typeof this.emitter.identity === 'function') {
      emitterIdentity = await this.emitter.identity();
    }
    return {
      parent: {
        photonName: this._photonName,
        className: this.constructor.name,
      },
      emitter: emitterIdentity,
    };
  }

  /**
   * Check if emitter is available
   */
  async hasEmitter(): Promise<{ available: boolean }> {
    return { available: !!this.emitter };
  }
}

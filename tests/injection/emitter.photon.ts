/**
 * Emitter Photon - Test photon that emits events
 * Used to test injected photon event routing
 */
import { PhotonMCP } from '@portel/photon-core';

export default class EmitterPhoton extends PhotonMCP {
  /**
   * Emit a test event
   * @param message Message to emit
   */
  async sendAlert(params: { message: string }): Promise<{ sent: boolean }> {
    this.emit({ event: 'alertCreated', data: { message: params.message, timestamp: Date.now() } });
    return { sent: true };
  }

  /**
   * Emit multiple events
   */
  async broadcast(params: { count: number }): Promise<{ emitted: number }> {
    for (let i = 0; i < params.count; i++) {
      this.emit({ event: 'notification', data: { index: i } });
    }
    return { emitted: params.count };
  }

  /**
   * Get photon identity info (for testing _photonName)
   */
  async identity(): Promise<{ photonName: string | undefined; className: string }> {
    return {
      photonName: this._photonName,
      className: this.constructor.name,
    };
  }
}

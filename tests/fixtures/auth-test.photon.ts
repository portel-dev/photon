/**
 * Auth Test Photon - validates authentication across transports
 *
 * @auth required
 */
export default class AuthTest {
  /**
   * Returns secret data that requires authentication
   * @readOnly
   */
  async secret(): Promise<string> {
    return 'top-secret-data';
  }

  /**
   * Returns caller identity
   * @readOnly
   */
  async whoami(): Promise<{ id: string; anonymous: boolean }> {
    return {
      id: this.caller?.id ?? 'unknown',
      anonymous: this.caller?.anonymous ?? true,
    };
  }

  declare caller: {
    id: string;
    name?: string;
    anonymous: boolean;
    scope?: string;
    claims?: Record<string, unknown>;
  };
}

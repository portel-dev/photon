/**
 * Auth Test Photon — Fixture for validating @auth enforcement across transports
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
      id: (this as any).caller?.id ?? 'unknown',
      anonymous: (this as any).caller?.anonymous ?? true,
    };
  }
}

/**
 * Test fixture: @locked middleware compat
 * Mirrors real-world photons that use bare and named @locked tags.
 */

export default class LockedCompat {
  /**
   * Critical section; lock name defaults to photon:method
   * @locked
   */
  async critical() {
    return { ok: true };
  }

  /**
   * Sweep with a custom lock name
   * @locked board:write
   */
  async sweep() {
    return { swept: true };
  }

  /**
   * Plain method — must NOT pick up middleware
   */
  async plain() {
    return { plain: true };
  }
}

/**
 * Fixture for the transport-neutral OAuth role conformance slice.
 *
 * The role is deliberately derived from request-scoped caller claims rather
 * than from tool arguments, so loader and MCP-server tests exercise the same
 * property-based exposure contract.
 *
 * @auth oauth optional
 */
export default class OAuthRoleConformance {
  get role(): string {
    const caller = (this as any).caller;
    if (caller?.anonymous === true) return 'user';
    return typeof caller?.claims?.role === 'string' ? caller.claims.role : 'unknown';
  }

  /** Anonymous discovery and booking entry point. */
  /** @class OAuthRoleConformance {@role user} */
  async userSlots() {
    return { role: this.role, callerId: (this as any).caller?.id ?? 'anonymous' };
  }

  /** Customer-only read operation. */
  /**
   * @class OAuthRoleConformance {@role customer}
   * @scope bookings:read
   */
  async customerBookings() {
    return { role: this.role, callerId: (this as any).caller?.id };
  }

  /** Customer operation with a deliberately similar, but distinct, scope. */
  /**
   * @class OAuthRoleConformance {@role customer}
   * @scope bookings:read-extra
   */
  async customerExactScope() {
    return { role: this.role, callerId: (this as any).caller?.id };
  }

  /** Host-only management operation. */
  /**
   * @class OAuthRoleConformance {@role host}
   * @scope availability:write
   */
  async hostAvailability() {
    return { role: this.role, callerId: (this as any).caller?.id };
  }
}

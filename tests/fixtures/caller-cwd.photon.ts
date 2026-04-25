/**
 * Fixture: returns `this.callerCwd` so tests can verify the originating CLI
 * cwd propagates through the request context across worker / cross-call
 * boundaries.
 */
export default class CallerCwd {
  async whereAmI(): Promise<{ cwd: string }> {
    return { cwd: (this as any).callerCwd as string };
  }
}

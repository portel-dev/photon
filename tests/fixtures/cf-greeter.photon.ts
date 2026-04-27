/**
 * CF cross-call smoke fixture. Forwards a name to cf-formatter via this.call,
 * proving that a Worker bundles two photons as sibling DOs and that the
 * runtime shim's this.call routes through env.PHOTON_CF_FORMATTER stub.
 *
 * @version 0.0.1
 * @icon 👋
 * @photons cf-formatter
 */
export default class CfGreeter {
  /**
   * Greet a person, calling cf-formatter to decorate the message.
   *
   * @param name - Person to greet
   */
  async greet(name: string): Promise<{ greeting: string }> {
    const formatted = (await (this as any).call('cf-formatter.decorate', {
      text: `Hello, ${name}`,
    })) as { decorated: string };
    return { greeting: formatted.decorated };
  }
}

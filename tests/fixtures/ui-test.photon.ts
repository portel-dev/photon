/**
 * Test photon with UI assets for ui:// scheme testing
 * @ui main-ui ./ui/main.html
 */
export default class UITestPhoton {
  /**
   * Main method linked to UI
   * @ui main-ui
   */
  async main() {
    return { message: 'Hello from UI test' };
  }
}

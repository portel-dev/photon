/**
 * Photon Walkthrough
 *
 * An interactive step-by-step guide to building photons.
 * Slides are in walkthrough/slides.md — edit the markdown,
 * not this file, to update the presentation.
 *
 * @version 1.0.0
 * @icon 📖
 */
export default class Walkthrough {
  /**
   * Learn to build photons — from zero to production
   * @format slides
   */
  main() {
    return this.assets('slides.md', { load: true });
  }
}

import * as fs from 'fs';
import * as path from 'path';

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
  start() {
    const slidesPath = path.join(
      path.dirname(import.meta.url.replace('file://', '')),
      'walkthrough',
      'slides.md'
    );
    return fs.readFileSync(slidesPath, 'utf-8');
  }
}

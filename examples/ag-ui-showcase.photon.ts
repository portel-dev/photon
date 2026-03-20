/**
 * AG-UI Event Showcase
 *
 * Demonstrates how photon yields map to AG-UI protocol events.
 * String yields become TEXT_MESSAGE events, progress yields become
 * STEP events, and return values become STATE_SNAPSHOT events.
 *
 * @version 1.0.0
 * @runtime ^1.9.0
 */

import { io } from '@portel/photon-core';

export default class AGUIShowcase {
  /**
   * Stream text content as AG-UI TEXT_MESSAGE events
   *
   * Each string yield maps to TEXT_MESSAGE_CONTENT.
   * The first yield triggers TEXT_MESSAGE_START.
   *
   * @param topic Subject to stream about
   */
  async *stream(params: { topic: string }) {
    yield `Starting analysis of "${params.topic}"...\n`;
    yield `Key findings for ${params.topic}:\n`;
    yield `- Finding 1: relevant data point\n`;
    yield `- Finding 2: supporting evidence\n`;
    yield `Analysis complete.`;

    return { topic: params.topic, chunks: 5 };
  }

  /**
   * Demonstrate step progress as AG-UI STEP events
   *
   * Progress yields with value < 1.0 trigger STEP_STARTED.
   * Progress at 1.0 triggers STEP_FINISHED.
   *
   * @param steps Number of steps to execute
   */
  async *progress(params: { steps: number }) {
    const total = Math.max(1, params.steps);

    for (let i = 0; i < total; i++) {
      yield io.emit.progress(i / total, `Step ${i + 1} of ${total}`);
      await new Promise((r) => setTimeout(r, 50));
    }

    yield io.emit.progress(1.0, 'All steps complete');

    return { steps: total, status: 'finished' };
  }

  /**
   * Return a state snapshot as AG-UI STATE_SNAPSHOT event
   *
   * The return value of any method is automatically wrapped
   * as a STATE_SNAPSHOT when using the AG-UI adapter.
   *
   * @param key State key name
   * @param value State value to capture
   */
  async snapshot(params: { key: string; value: string }) {
    return {
      [params.key]: params.value,
      capturedAt: new Date().toISOString(),
    };
  }
}

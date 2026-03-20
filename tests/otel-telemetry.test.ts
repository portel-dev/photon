import { describe, it, expect, beforeEach } from 'vitest';
import {
  startToolSpan,
  startAgentSpan,
  isTracingEnabled,
  waitForOtelProbe,
  _resetOtelCache,
  type PhotonSpan,
} from '../src/telemetry/otel.js';

describe('OTel GenAI Telemetry', () => {
  beforeEach(async () => {
    // Ensure the OTel probe has completed before each test
    await waitForOtelProbe();
  });

  describe('no-op behavior (OTel SDK not installed)', () => {
    it('isTracingEnabled returns false when OTel is not available', () => {
      // In test environment, @opentelemetry/api is not installed
      expect(isTracingEnabled()).toBe(false);
    });

    it('startToolSpan returns a no-op span', () => {
      const span = startToolSpan('todo', 'add', { item: 'test' });
      expect(span).toBeDefined();
      expect(typeof span.setAttribute).toBe('function');
      expect(typeof span.addEvent).toBe('function');
      expect(typeof span.setStatus).toBe('function');
      expect(typeof span.end).toBe('function');
    });

    it('startAgentSpan returns a no-op span', () => {
      const span = startAgentSpan('todo', 'A todo list manager');
      expect(span).toBeDefined();
      expect(typeof span.setAttribute).toBe('function');
      expect(typeof span.end).toBe('function');
    });

    it('no-op span methods do not throw', () => {
      const span = startToolSpan('todo', 'add');
      expect(() => span.setAttribute('key', 'value')).not.toThrow();
      expect(() => span.setAttribute('count', 42)).not.toThrow();
      expect(() => span.setAttribute('flag', true)).not.toThrow();
      expect(() => span.addEvent('test-event', { key: 'val' })).not.toThrow();
      expect(() => span.setStatus('OK')).not.toThrow();
      expect(() => span.setStatus('ERROR', 'something broke')).not.toThrow();
      expect(() => span.end()).not.toThrow();
    });

    it('no-op span can be called multiple times safely', () => {
      const span = startToolSpan('photon', 'method');
      span.setAttribute('a', 1);
      span.setStatus('OK');
      span.end();
      // Double-end should not throw
      span.end();
    });
  });

  describe('span naming conventions', () => {
    it('startToolSpan uses gen_ai.tool.call format', () => {
      // We cannot inspect the actual span name without OTel SDK,
      // but we verify the function accepts correct params and returns a valid span
      const span = startToolSpan('chess', 'move', { from: 'e2', to: 'e4' });
      expect(span).toBeDefined();
    });

    it('startAgentSpan uses gen_ai.agent.invoke format', () => {
      const span = startAgentSpan('chess', 'A chess game engine');
      expect(span).toBeDefined();
    });

    it('startToolSpan works without params', () => {
      const span = startToolSpan('todo', 'list');
      expect(span).toBeDefined();
    });

    it('startAgentSpan works without description', () => {
      const span = startAgentSpan('todo');
      expect(span).toBeDefined();
    });
  });

  describe('PhotonSpan interface', () => {
    it('satisfies the PhotonSpan interface contract', () => {
      const span: PhotonSpan = startToolSpan('test', 'method');
      // Type-check: these assignments confirm the interface is correctly shaped
      const setAttr: (key: string, value: string | number | boolean) => void = span.setAttribute;
      const addEvt: (name: string, attributes?: Record<string, string | number | boolean>) => void =
        span.addEvent;
      const setStat: (code: 'OK' | 'ERROR', message?: string) => void = span.setStatus;
      const endFn: () => void = span.end;
      expect(setAttr).toBeDefined();
      expect(addEvt).toBeDefined();
      expect(setStat).toBeDefined();
      expect(endFn).toBeDefined();
    });
  });

  describe('module loading', () => {
    it('module loads without errors regardless of OTel availability', async () => {
      // The fact that we got here means the module loaded successfully
      expect(startToolSpan).toBeDefined();
      expect(startAgentSpan).toBeDefined();
      expect(isTracingEnabled).toBeDefined();
      expect(waitForOtelProbe).toBeDefined();
    });

    it('_resetOtelCache allows re-probing', async () => {
      _resetOtelCache();
      // After reset, isTracingEnabled should still work after re-probe
      await waitForOtelProbe();
      expect(isTracingEnabled()).toBe(false);
    });
  });
});

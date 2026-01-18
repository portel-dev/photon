import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { Logger } from '../dist/shared/logger.js';

class MemoryWritable extends Writable {
  public chunks: string[] = [];
  _write(chunk: any, _encoding: string, callback: (error?: Error | null) => void) {
    this.chunks.push(chunk.toString());
    callback();
  }
  toString() {
    return this.chunks.join('');
  }
}

(async () => {
  // Plain text logging respects log level
  const textStream = new MemoryWritable();
  const textLogger = new Logger({ component: 'test', scope: 'unit', destination: textStream, level: 'info' });
  textLogger.debug('hidden');
  textLogger.info('visible', { run: 42 });
  const plain = textStream.toString();
  assert(!plain.includes('hidden'), 'debug message should be filtered out');
  assert(plain.includes('INFO'), 'info line should include level label');
  assert(plain.includes('[test:unit]'), 'component + scope should be rendered');
  assert(plain.includes('run'), 'metadata should be serialized');

  // JSON logging includes structured payloads
  const jsonStream = new MemoryWritable();
  const jsonLogger = new Logger({ component: 'test', json: true, destination: jsonStream, level: 'debug' });
  jsonLogger.warn('oops', { code: 500 });
  const payload = jsonStream.toString().trim();
  const parsed = JSON.parse(payload);
  assert.equal(parsed.level, 'warn');
  assert.equal(parsed.component, 'test');
  assert.equal(parsed.message, 'oops');
  assert.equal(parsed.code, 500);

  // Minimal logging should suppress timestamp and level labels
  const minimalStream = new MemoryWritable();
  const minimalLogger = new Logger({ component: 'mini', minimal: true, destination: minimalStream });
  minimalLogger.info('compact', { task: 'sync' });
  const minimal = minimalStream.toString().trim();
  assert(minimal.startsWith('[mini] compact'), 'minimal logs should start with label + message');
  assert(minimal.includes('"task":"sync"'), 'metadata should be serialized as JSON');

  // Sink should receive structured records
  let sinkRecord: any = null;
  const sinkStream = new MemoryWritable();
  const sinkLogger = new Logger({ component: 'sink', sink: (record) => { sinkRecord = record; }, destination: sinkStream, minimal: true });
  sinkLogger.error('boom', { detail: 123 });
  assert(sinkRecord, 'sink should capture record');
  assert.equal(sinkRecord.message, 'boom');
  assert.equal(sinkRecord.level, 'error');
  assert.equal(sinkRecord.detail, 123);

  console.log('Logger tests passed');
})();

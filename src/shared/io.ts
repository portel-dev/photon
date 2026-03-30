/**
 * Optimized File I/O
 *
 * Uses Bun.file() / Bun.write() when running on Bun for native performance.
 * Falls back to Node.js fs module on Node.
 *
 * Why: Bun's fs module is a separate reimplementation that does NOT delegate
 * to Bun.file() internally. Using Bun.file().json() avoids the intermediate
 * string allocation that fs.readFile + JSON.parse requires.
 */

import * as fs from 'fs/promises';
import { readFileSync, writeFileSync, existsSync } from 'fs';

const IS_BUN = typeof (globalThis as any).Bun !== 'undefined';
const Bun: any = IS_BUN ? (globalThis as any).Bun : null;

// ════════════════════════════════════════════════════════════════════════════════
// ASYNC — hot path for loader, server, marketplace
// ════════════════════════════════════════════════════════════════════════════════

/** Read a file as UTF-8 text */
export async function readText(filePath: string): Promise<string> {
  if (Bun) return Bun.file(filePath).text();
  return fs.readFile(filePath, 'utf-8');
}

/** Read a JSON file, parsed */
export async function readJSON<T = any>(filePath: string): Promise<T> {
  if (Bun) return Bun.file(filePath).json();
  const raw = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(raw);
}

/** Write UTF-8 text to a file */
export async function writeText(filePath: string, content: string): Promise<void> {
  if (Bun) {
    await Bun.write(filePath, content);
    return;
  }
  await fs.writeFile(filePath, content, 'utf-8');
}

/** Write an object as JSON to a file */
export async function writeJSON(filePath: string, data: unknown, indent = 2): Promise<void> {
  const content = JSON.stringify(data, null, indent);
  if (Bun) {
    await Bun.write(filePath, content);
    return;
  }
  await fs.writeFile(filePath, content, 'utf-8');
}

/** Write raw bytes to a file */
export async function writeBytes(filePath: string, data: Buffer | Uint8Array): Promise<void> {
  if (Bun) {
    await Bun.write(filePath, data);
    return;
  }
  await fs.writeFile(filePath, data);
}

/** Read raw bytes from a file */
export async function readBytes(filePath: string): Promise<Buffer> {
  if (Bun) {
    const ab = await Bun.file(filePath).arrayBuffer();
    return Buffer.from(ab);
  }
  return fs.readFile(filePath);
}

// ════════════════════════════════════════════════════════════════════════════════
// SYNC — Bun.file() is async-only, so sync paths use Node's fs on both runtimes.
// No perf loss: sync I/O is used for startup/CLI where latency isn't the bottleneck.
// ════════════════════════════════════════════════════════════════════════════════

/** Read a file as UTF-8 text (sync) */
export function readTextSync(filePath: string): string {
  return readFileSync(filePath, 'utf-8');
}

/** Read a JSON file, parsed (sync) */
export function readJSONSync<T = any>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf-8'));
}

/** Write UTF-8 text to a file (sync) */
export function writeTextSync(filePath: string, content: string): void {
  writeFileSync(filePath, content, 'utf-8');
}

/** Write an object as JSON to a file (sync) */
export function writeJSONSync(filePath: string, data: unknown, indent = 2): void {
  writeFileSync(filePath, JSON.stringify(data, null, indent), 'utf-8');
}

/** Check if a file exists */
export function fileExists(filePath: string): boolean {
  return existsSync(filePath);
}

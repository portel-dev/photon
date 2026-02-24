/**
 * Async Discipline Primitives
 *
 * Reusable patterns for safe concurrent async operations:
 * - LoadingGate: one-shot init barrier (coalesces concurrent callers)
 * - DedupMap: Map with dedup'd async creation (prevents duplicate factories)
 */

export { LoadingGate } from './loading-gate.js';
export { DedupMap } from './dedup-map.js';
export { withTimeout } from './with-timeout.js';

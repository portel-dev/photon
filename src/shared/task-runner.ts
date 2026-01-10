import { performance } from 'node:perf_hooks';

export async function runTask<T>(label: string, task: () => Promise<T>): Promise<T> {
  const start = performance.now();
  process.stdout.write(`▸ ${label}...`);
  try {
    const result = await task();
    const duration = ((performance.now() - start) / 1000).toFixed(1);
    process.stdout.write(`\r✔ ${label} (${duration}s)\n`);
    return result;
  } catch (error) {
    process.stdout.write(`\r✖ ${label}\n`);
    throw error;
  }
}

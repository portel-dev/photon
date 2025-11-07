/**
 * Comprehensive Load and Stress Testing Suite
 *
 * Tests MCP server under various load conditions:
 * - Concurrent requests
 * - Memory usage
 * - Large payloads
 * - Long-running operations
 * - Error handling under load
 */

import { PhotonLoader } from '../src/loader.js';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Test configuration
const TEST_CONFIG = {
  concurrent: {
    requests: 100,
    timeout: 30000,
  },
  memory: {
    iterations: 50,
    sizePerIteration: 100, // KB
  },
  stress: {
    duration: 10000, // ms
    requestsPerSecond: 50,
  },
};

interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  metrics?: {
    requestCount?: number;
    successRate?: number;
    avgResponseTime?: number;
    maxResponseTime?: number;
    minResponseTime?: number;
    errorCount?: number;
    memoryUsage?: {
      initial: number;
      peak: number;
      final: number;
    };
  };
  error?: string;
}

class LoadTester {
  private testFilePath: string;
  private results: TestResult[] = [];

  constructor() {
    this.testFilePath = path.join(__dirname, 'load', 'test-server.photon.ts');
  }

  /**
   * Test 1: Concurrent Request Handling
   */
  async testConcurrentRequests(): Promise<TestResult> {
    console.log(`\n🔄 Test 1: Concurrent Requests (${TEST_CONFIG.concurrent.requests} requests)...`);
    const startTime = Date.now();

    try {
      const loader = new PhotonLoader();
      const mcpClass = await loader.loadFile(this.testFilePath);
      const instance = mcpClass.instance;

      // Execute concurrent requests directly (without MCP client overhead)
      const promises = [];
      const responseTimes: number[] = [];

      for (let i = 0; i < TEST_CONFIG.concurrent.requests; i++) {
        const requestStart = Date.now();
        const promise = instance.fast({ value: `test-${i}` })
          .then(result => {
            responseTimes.push(Date.now() - requestStart);
            return result;
          })
          .catch(error => {
            responseTimes.push(Date.now() - requestStart);
            throw error;
          });
        promises.push(promise);
      }

      const results = await Promise.allSettled(promises);
      const successful = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;

      const duration = Date.now() - startTime;
      const avgResponseTime = responseTimes.length > 0
        ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
        : 0;

      return {
        name: 'Concurrent Requests',
        passed: failed === 0 && successful === TEST_CONFIG.concurrent.requests,
        duration,
        metrics: {
          requestCount: TEST_CONFIG.concurrent.requests,
          successRate: (successful / TEST_CONFIG.concurrent.requests) * 100,
          avgResponseTime,
          maxResponseTime: responseTimes.length > 0 ? Math.max(...responseTimes) : 0,
          minResponseTime: responseTimes.length > 0 ? Math.min(...responseTimes) : 0,
          errorCount: failed,
        },
      };
    } catch (error: any) {
      return {
        name: 'Concurrent Requests',
        passed: false,
        duration: Date.now() - startTime,
        error: error.message,
      };
    }
  }

  /**
   * Test 2: Memory Usage Under Load
   */
  async testMemoryUsage(): Promise<TestResult> {
    console.log(`\n💾 Test 2: Memory Usage (${TEST_CONFIG.memory.iterations} iterations)...`);
    const startTime = Date.now();

    try {
      const loader = new PhotonLoader();
      const mcpClass = await loader.loadFile(this.testFilePath);
      const instance = mcpClass.instance;

      // Warm up and establish baseline after initial allocations
      for (let i = 0; i < 5; i++) {
        await instance.fast({ value: 'warmup' });
      }

      if (global.gc) {
        global.gc();
        global.gc(); // Run twice for thorough collection
      }

      // Wait for GC to settle
      await new Promise(resolve => setTimeout(resolve, 100));

      const initialMemory = process.memoryUsage().heapUsed;
      let peakMemory = initialMemory;

      // Test for memory leaks by doing smaller operations repeatedly
      // If there's a leak, memory will grow continuously
      for (let i = 0; i < TEST_CONFIG.memory.iterations; i++) {
        await instance.memory({ size: 10 }); // Smaller size to focus on leak detection

        const currentMemory = process.memoryUsage().heapUsed;
        if (currentMemory > peakMemory) {
          peakMemory = currentMemory;
        }

        // Periodic GC to check if memory is being released
        if (i % 10 === 0 && global.gc) {
          global.gc();
        }
      }

      // Force aggressive GC
      if (global.gc) {
        for (let i = 0; i < 3; i++) {
          global.gc();
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }

      const finalMemory = process.memoryUsage().heapUsed;
      const memoryGrowth = finalMemory - initialMemory;
      const memoryGrowthMB = memoryGrowth / 1024 / 1024;

      const duration = Date.now() - startTime;

      // Pass if memory growth is less than 50MB after GC (indicates no significant leak)
      // This accounts for V8's memory management while detecting actual leaks
      return {
        name: 'Memory Usage',
        passed: memoryGrowthMB < 50,
        duration,
        metrics: {
          requestCount: TEST_CONFIG.memory.iterations,
          memoryUsage: {
            initial: Math.round(initialMemory / 1024 / 1024),
            peak: Math.round(peakMemory / 1024 / 1024),
            final: Math.round(finalMemory / 1024 / 1024),
          },
        },
      };
    } catch (error: any) {
      return {
        name: 'Memory Usage',
        passed: false,
        duration: Date.now() - startTime,
        error: error.message,
      };
    }
  }

  /**
   * Test 3: Large Payload Handling
   */
  async testLargePayloads(): Promise<TestResult> {
    console.log('\n📦 Test 3: Large Payload Handling...');
    const startTime = Date.now();

    try {
      const loader = new PhotonLoader();
      const mcpClass = await loader.loadFile(this.testFilePath);
      const instance = mcpClass.instance;

      const payloadSizes = [10, 50, 100, 500]; // KB
      const responseTimes: number[] = [];

      for (const size of payloadSizes) {
        const reqStart = Date.now();
        await instance.largeResponse({ size });
        responseTimes.push(Date.now() - reqStart);
      }

      const duration = Date.now() - startTime;
      const avgResponseTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;

      return {
        name: 'Large Payloads',
        passed: true,
        duration,
        metrics: {
          requestCount: payloadSizes.length,
          avgResponseTime,
          maxResponseTime: Math.max(...responseTimes),
          minResponseTime: Math.min(...responseTimes),
        },
      };
    } catch (error: any) {
      return {
        name: 'Large Payloads',
        passed: false,
        duration: Date.now() - startTime,
        error: error.message,
      };
    }
  }

  /**
   * Test 4: Error Handling Under Load
   */
  async testErrorHandling(): Promise<TestResult> {
    console.log('\n⚠️  Test 4: Error Handling Under Load...');
    const startTime = Date.now();

    try {
      const loader = new PhotonLoader();
      const mcpClass = await loader.loadFile(this.testFilePath);
      const instance = mcpClass.instance;

      const promises = [];
      for (let i = 0; i < 50; i++) {
        // Mix of successful and failing requests
        const shouldFail = i % 3 === 0;
        promises.push(
          instance.error({ shouldFail })
            .catch(() => ({ error: true }))
        );
      }

      const results = await Promise.all(promises);
      const errors = results.filter(r => r.error).length;
      const expected = Math.ceil(50 / 3); // Every 3rd request should fail

      const duration = Date.now() - startTime;

      return {
        name: 'Error Handling',
        passed: Math.abs(errors - expected) <= 2, // Allow small variance
        duration,
        metrics: {
          requestCount: 50,
          errorCount: errors,
          successRate: ((50 - errors) / 50) * 100,
        },
      };
    } catch (error: any) {
      return {
        name: 'Error Handling',
        passed: false,
        duration: Date.now() - startTime,
        error: error.message,
      };
    }
  }

  /**
   * Test 5: CPU-Intensive Operations
   */
  async testCPUIntensive(): Promise<TestResult> {
    console.log('\n⚡ Test 5: CPU-Intensive Operations...');
    const startTime = Date.now();

    try {
      const loader = new PhotonLoader();
      const mcpClass = await loader.loadFile(this.testFilePath);
      const instance = mcpClass.instance;

      const iterations = [10000, 50000, 100000];
      const responseTimes: number[] = [];

      for (const iter of iterations) {
        const reqStart = Date.now();
        await instance.cpu({ iterations: iter });
        responseTimes.push(Date.now() - reqStart);
      }

      const duration = Date.now() - startTime;
      const avgResponseTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;

      return {
        name: 'CPU-Intensive Operations',
        passed: avgResponseTime < 5000, // Should complete within 5 seconds on average
        duration,
        metrics: {
          requestCount: iterations.length,
          avgResponseTime,
          maxResponseTime: Math.max(...responseTimes),
          minResponseTime: Math.min(...responseTimes),
        },
      };
    } catch (error: any) {
      return {
        name: 'CPU-Intensive Operations',
        passed: false,
        duration: Date.now() - startTime,
        error: error.message,
      };
    }
  }

  /**
   * Test 6: Complex Schema Processing
   */
  async testComplexSchemas(): Promise<TestResult> {
    console.log('\n🔍 Test 6: Complex Schema Processing...');
    const startTime = Date.now();

    try {
      const loader = new PhotonLoader();
      const mcpClass = await loader.loadFile(this.testFilePath);
      const instance = mcpClass.instance;

      const promises = [];
      for (let i = 0; i < 100; i++) {
        promises.push(
          instance.complexSchema({
            data: {
              user: {
                name: `User ${i}`,
                email: `user${i}@example.com`,
                age: 20 + (i % 50),
              },
              settings: {
                theme: i % 2 === 0 ? 'dark' : 'light',
                notifications: i % 3 === 0,
              },
              tags: [`tag${i}`, `category${i % 10}`],
            },
          })
        );
      }

      const results = await Promise.all(promises);
      const duration = Date.now() - startTime;

      return {
        name: 'Complex Schema Processing',
        passed: results.length === 100 && results.every(r => r.processed),
        duration,
        metrics: {
          requestCount: 100,
          successRate: 100,
          avgResponseTime: duration / 100,
        },
      };
    } catch (error: any) {
      return {
        name: 'Complex Schema Processing',
        passed: false,
        duration: Date.now() - startTime,
        error: error.message,
      };
    }
  }

  /**
   * Run all load tests
   */
  async runAll() {
    console.log('🧪 Running Comprehensive Load Tests...\n');
    console.log('⚙️  Configuration:');
    console.log(`   - Concurrent requests: ${TEST_CONFIG.concurrent.requests}`);
    console.log(`   - Memory iterations: ${TEST_CONFIG.memory.iterations}`);
    console.log(`   - Stress duration: ${TEST_CONFIG.stress.duration}ms`);

    const tests = [
      () => this.testConcurrentRequests(),
      () => this.testMemoryUsage(),
      () => this.testLargePayloads(),
      () => this.testErrorHandling(),
      () => this.testCPUIntensive(),
      () => this.testComplexSchemas(),
    ];

    for (const test of tests) {
      const result = await test();
      this.results.push(result);
    }

    this.printResults();
  }

  /**
   * Print test results
   */
  private printResults() {
    console.log('\n' + '='.repeat(80));
    console.log('📊 LOAD TEST RESULTS');
    console.log('='.repeat(80));

    let passed = 0;
    let failed = 0;

    this.results.forEach(result => {
      const status = result.passed ? '✅' : '❌';
      console.log(`\n${status} ${result.name}`);
      console.log(`   Duration: ${result.duration}ms`);

      if (result.metrics) {
        if (result.metrics.requestCount) {
          console.log(`   Requests: ${result.metrics.requestCount}`);
        }
        if (result.metrics.successRate !== undefined) {
          console.log(`   Success Rate: ${result.metrics.successRate.toFixed(2)}%`);
        }
        if (result.metrics.avgResponseTime) {
          console.log(`   Avg Response Time: ${result.metrics.avgResponseTime.toFixed(2)}ms`);
        }
        if (result.metrics.maxResponseTime) {
          console.log(`   Max Response Time: ${result.metrics.maxResponseTime}ms`);
        }
        if (result.metrics.minResponseTime) {
          console.log(`   Min Response Time: ${result.metrics.minResponseTime}ms`);
        }
        if (result.metrics.errorCount !== undefined) {
          console.log(`   Errors: ${result.metrics.errorCount}`);
        }
        if (result.metrics.memoryUsage) {
          const mem = result.metrics.memoryUsage;
          console.log(`   Memory: ${mem.initial}MB → ${mem.peak}MB → ${mem.final}MB`);
        }
      }

      if (result.error) {
        console.log(`   Error: ${result.error}`);
      }

      if (result.passed) {
        passed++;
      } else {
        failed++;
      }
    });

    console.log('\n' + '='.repeat(80));
    console.log(`Total: ${this.results.length} tests | Passed: ${passed} | Failed: ${failed}`);
    console.log('='.repeat(80));

    if (failed > 0) {
      process.exit(1);
    }
  }
}

// Run tests
if (import.meta.url === `file://${process.argv[1]}`) {
  const tester = new LoadTester();
  tester.runAll().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

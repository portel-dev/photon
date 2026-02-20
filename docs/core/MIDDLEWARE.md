# Middleware: Bridging Ideal Code and the Real World

## The Problem

Every developer writes the same boilerplate. You have a clean function that does one thing well — then you wrap it in try/catch for retries, add a cache layer, bolt on rate limiting, sprinkle timeout protection, and suddenly your 10-line function is 60 lines of infrastructure.

```typescript
// What you WANT to write
async getWeather(city: string) {
  const res = await fetch(`https://api.weather.com/${city}`);
  return res.json();
}

// What you ACTUALLY write (in production)
async getWeather(city: string) {
  // Rate limiting
  if (this.callCount > 30) throw new Error('Rate limited');
  this.callCount++;
  setTimeout(() => this.callCount--, 60000);

  // Caching
  const cacheKey = `weather:${city}`;
  const cached = this.cache.get(cacheKey);
  if (cached && Date.now() - cached.time < 900000) return cached.data;

  // Retry loop with timeout
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      const res = await fetch(`https://api.weather.com/${city}`, {
        signal: controller.signal
      });
      clearTimeout(timer);
      const data = await res.json();
      this.cache.set(cacheKey, { data, time: Date.now() });
      return data;
    } catch (e) {
      lastError = e;
      await new Promise(r => setTimeout(r, 500));
    }
  }
  throw lastError;
}
```

The logic is the same. The intent is the same. But production demands have buried it under defensive infrastructure. This pattern repeats across every method in every service, and the infrastructure code often dwarfs the business logic.

## The Photon Approach

Write the ideal code. Declare the real-world constraints as tags. The runtime bridges the gap.

```typescript
/**
 * @cached 15m
 * @timeout 10s
 * @retryable 2 500ms
 * @throttled 30/min
 */
async getWeather(params: { city: string }) {
  const res = await fetch(`https://api.weather.com/${params.city}`);
  return res.json();
}
```

Four lines of declarations replace fifty lines of infrastructure. The method body stays clean — pure intent, zero ceremony. The runtime automatically wraps execution with caching, timeouts, retries, and rate limiting in the correct order.

This isn't configuration. It's **behavior composition**. Each tag is a middleware that wraps the method execution at a specific phase in the pipeline.

## Eight Real-World Patterns

Every middleware tag addresses one of eight gaps between ideal code and production reality:

### 1. "The world is unreliable" — `@timeout` + `@retryable`

APIs go down. Networks partition. Services hang. Ideal code assumes everything responds instantly and correctly. Reality demands timeout protection and retry logic.

```typescript
/** @timeout 30s @retryable 3 1s */
async fetchData(params: { url: string }) {
  return await fetch(params.url).then(r => r.json());
}
```

### 2. "Don't overwhelm the world" — `@throttled` + `@debounced`

External services have rate limits. Users trigger rapid actions. Ideal code calls whenever it needs to. Reality requires restraint.

```typescript
/** @throttled 10/min */
async sendNotification(params: { message: string }) {
  await this.mailer.send(params.message);
}

/** @debounced 500ms */
async savePreferences(params: { prefs: object }) {
  await this.storage.write('prefs', params.prefs);
}
```

### 3. "Don't corrupt shared state" — `@locked` + `@queued`

Multiple clients call the same method simultaneously. Ideal code assumes sequential execution. Reality is concurrent — two writes to the same file interleave, two board mutations produce invalid state.

```typescript
/** @locked board:write */
async moveTask(params: { id: string; column: string }) {
  const board = await this.loadBoard();
  const task = board.tasks.find(t => t.id === params.id);
  task.column = params.column;
  await this.saveBoard(board);
}

/** @queued 1 */
async processPayment(params: { orderId: string }) {
  return await this.stripe.charge(params.orderId);
}
```

### 4. "Don't ask the world twice" — `@cached`

The same data is requested repeatedly. Ideal code fetches fresh every time. Reality wastes bandwidth, hits rate limits, and adds latency for data that hasn't changed.

```typescript
/** @cached 1h */
async getExchangeRates() {
  return await fetch('https://api.exchange.com/rates').then(r => r.json());
}
```

### 5. "Trust but verify" — `@validate`

Parameters come from AI models, form inputs, and API calls. Ideal code trusts its callers. Reality sends malformed emails, negative amounts, and empty strings.

```typescript
/**
 * @validate params.email must be a valid email
 * @validate params.amount must be positive
 */
async charge(params: { email: string; amount: number }) {
  return await this.stripe.charge(params.email, params.amount);
}
```

### 6. "Fail gracefully" — `@fallback`

Methods that read config files, query external services, or load state often fail — the file doesn't exist yet, the service is down, the data is corrupt. Ideal code assumes success. Reality needs a safe default when things break.

```typescript
/** @fallback [] */
async loadHistory(params: { path: string }) {
  return JSON.parse(await fs.readFile(params.path, 'utf-8'));
}

/** @fallback null */
async findUser(params: { id: string }) {
  return await this.db.findOne({ id: params.id });
}
```

The `@fallback` tag wraps the entire pipeline — if retries are exhausted, if a timeout fires, if rate limiting rejects, the fallback catches everything and returns the default value. No try/catch, no silent swallowing of errors, just a declaration of what the caller should get when the world doesn't cooperate.

### 7. "Know what happened" — `@logged`

Production methods execute silently. When something is slow, you don't know which method. When something fails, you piece together the timeline from scattered logs. Ideal code doesn't need observability. Reality needs to know what ran, how long it took, and whether it succeeded.

```typescript
/** @logged */
async processOrder(params: { orderId: string }) {
  return await this.stripe.charge(params.orderId);
}
// stderr: [info] billing.processOrder 142ms

/** @logged debug */
async syncInventory(params: { sku: string }) {
  return await this.warehouse.check(params.sku);
}
// stderr: [debug] inventory.syncInventory 3402ms
```

The `@logged` tag sits at phase 5 — after `@fallback` but before everything else. This means it observes the full lifecycle including fallback-caught errors, but doesn't log noise from throttled or debounced rejections. Logs go to stderr so they never interfere with MCP protocol output on stdout.

### 8. "Stop hitting a dead service" — `@circuitBreaker`

External services go down for extended periods. Ideal code calls the endpoint and lets retries handle it. Reality wastes time, resources, and retry budgets hammering a service that's been down for five minutes. After enough consecutive failures, the sensible response is to stop trying.

```typescript
/** @circuitBreaker 5 30s */
async fetchPrices(params: { symbol: string }) {
  return await fetch(`https://api.prices.com/${params.symbol}`).then(r => r.json());
}
```

The `@circuitBreaker` tag tracks consecutive failures per method. After 5 failures the circuit "opens" — subsequent calls are immediately rejected without executing. After 30 seconds, one probe call is allowed through. If the probe succeeds, normal operation resumes. If it fails, the circuit re-opens. Combined with `@fallback`, a broken service returns a safe default instantly instead of waiting for timeouts.

## How It Works

### The Pipeline

When a method has middleware tags, the runtime wraps execution in a chain. Each middleware gets a `next()` function and decides whether to proceed, short-circuit, or transform the result:

```
Request arrives
  → @fallback    catch any error below, return default value (outermost safety net)
  → @logged      observe execution timing and success/failure
  → @circuitBreaker  fast-reject if service is known-down
  → @throttled   reject if over rate limit (cheapest check first)
  → @debounced   cancel previous, delay execution
  → @cached      return cached result if valid (skip everything below)
  → @validate    reject if rules fail
  → @queued      wait for concurrency slot
  → @locked      acquire distributed lock
  → @timeout     start race timer
  → @retryable   retry loop on failure (innermost — each retry goes through timeout)
    → actual method execution
```

The ordering is deliberate. Cheap rejections (rate limit, debounce) happen first. Cache checks skip expensive operations. Validation gates before acquiring resources. The timeout wraps each retry attempt, not the entire retry loop.

### Phase Ordering

Each middleware has a **phase number** that determines its position in the pipeline:

| Phase | Middleware | Why this position |
|-------|-----------|-------------------|
| 3 | `@fallback` | Outermost safety net — catches everything, returns default |
| 5 | `@logged` | Observe execution timing and errors |
| 8 | `@circuitBreaker` | Fast-reject if service is known-down |
| 10 | `@throttled` | Reject immediately — don't waste any resources |
| 20 | `@debounced` | Collapse rapid calls before doing real work |
| 30 | `@cached` | Cache hit skips everything — biggest savings |
| 40 | `@validate` | Catch bad input before acquiring locks/queues |
| 45 | custom | User middleware default position |
| 50 | `@queued` | Control concurrency before locking |
| 60 | `@locked` | Exclusive access for the actual operation |
| 70 | `@timeout` | Race timer per attempt |
| 80 | `@retryable` | Innermost — each retry re-enters timeout |

### No Code Changes Required

The method body never changes. Add a tag, remove a tag — the runtime adapts. This separation means:

- **Business logic stays testable** — test the method without middleware
- **Constraints are visible** — scan the JSDoc to understand production behavior
- **Changes are safe** — adjusting a cache TTL from 5m to 15m is a one-character edit, not a refactor
- **Composition is automatic** — the runtime handles interaction between middlewares correctly

## Custom Middleware

The same system that powers built-in tags is available to photon authors via `@use` and `defineMiddleware()`. See [DOCBLOCK-TAGS.md](../reference/DOCBLOCK-TAGS.md#custom-middleware-use-tag) for the API reference.

```typescript
import { defineMiddleware } from '@portel/photon-core';

export const middleware = [
  defineMiddleware({
    name: 'audit',
    phase: 5,
    create(config, state) {
      return async (ctx, next) => {
        const start = Date.now();
        const result = await next();
        const duration = Date.now() - start;
        console.log(`[${config.level}] ${ctx.photon}.${ctx.tool} ${duration}ms`);
        return result;
      };
    }
  })
];

export default class BillingService {
  /**
   * @use audit {@level info}
   * @timeout 30s
   * @retryable 2 1s
   */
  async charge(params: { amount: number }) {
    return await this.stripe.charge(params.amount);
  }
}
```

Custom middleware and built-in tags share the same pipeline — no special treatment, no separate systems. A custom middleware at phase 5 runs before all built-ins. At phase 45 (the default), it slots between validation and queuing.

## Design Principle

> Write the ideal code. Declare what the real world demands. Let the runtime bridge the gap.

The developer's job is to express **intent**. The tag's job is to express **constraints**. The runtime's job is to compose them into production-grade behavior. This is not a framework convention — it's a language-level capability of the Photon runtime.

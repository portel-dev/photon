<script lang="ts">
  import { onMount } from 'svelte';

  // ─── Bridge Declarations ──────────────────────────────────────────────────
  declare global {
    interface Window {
      photon?: {
        toolInput: Record<string, any>;
        widgetState: any;
        setWidgetState: (state: any) => void;
        callTool: (name: string, args: any) => Promise<any>;
        onProgress: (cb: (e: any) => void) => () => void;
        onEmit: (cb: (e: { emit: string; data?: any }) => void) => () => void;
        onResult: (cb: (r: any) => void) => () => void;
        onError: (cb: (err: any) => void) => () => void;
        onThemeChange: (cb: (theme: 'light' | 'dark') => void) => () => void;
        theme: 'light' | 'dark';
      };
    }
  }

  let hasBridge = $state(typeof window.photon !== 'undefined');
  let input = $state(window.photon?.toolInput || {});
  let theme = $state<'light' | 'dark'>(window.photon?.theme || 'light');
  let echoText = $state('Hello Photon!');
  let echoResult = $state('');
  let numA = $state(5);
  let numB = $state(10);
  let addResult = $state<number | null>(null);
  let loading = $state<Record<string, boolean>>({});
  let events = $state<Array<{ time: string; emit: string; data: any }>>([]);

  onMount(() => {
    if (window.photon) {
      const unsubscribeTheme = window.photon.onThemeChange((newTheme) => {
        theme = newTheme;
      });

      const unsubscribeEmit = window.photon.onEmit((event) => {
        events.unshift({
          time: new Date().toLocaleTimeString(),
          emit: event.emit,
          data: event.data,
        });
        if (events.length > 10) {
          events.pop();
        }
      });

      return () => {
        unsubscribeTheme();
        unsubscribeEmit();
      };
    }
  });

  const callTool = async (name: string, args: any = {}) => {
    if (window.photon) {
      return window.photon.callTool(name, args);
    }
    console.warn(`[Photon Mock] calling ${name} with`, args);
    return new Promise((resolve) => setTimeout(() => {
      if (name === 'add') resolve({ a: args.a, b: args.b, sum: args.a + args.b });
      else if (name === 'echo') resolve(`Echo: ${args.message}`);
      else resolve({ mockResult: true });
    }, 500));
  };

  const handleEcho = async () => {
    loading = { ...loading, echo: true };
    try {
      const res = (await callTool('echo', { message: echoText })) as string;
      echoResult = res;
    } catch (err: any) {
      echoResult = `Error: ${err.message || err}`;
    } finally {
      loading = { ...loading, echo: false };
    }
  };

  const handleAdd = async () => {
    loading = { ...loading, add: true };
    try {
      const res = (await callTool('add', { a: numA, b: numB })) as any;
      addResult = res?.sum ?? null;
    } catch (err: any) {
      console.error(err);
    } finally {
      loading = { ...loading, add: false };
    }
  };
</script>

<div class="app-container {theme}">
  <header class="app-header">
    <div class="header-logo">
      <span class="logo-icon">🔥</span>
      <h1>Photon Svelte Dashboard</h1>
    </div>
    <div class="connection-badge">
      <span class="status-dot {hasBridge ? 'connected' : 'mock'}"></span>
      {hasBridge ? 'Photon Connected' : 'Local Mock Mode'}
    </div>
  </header>

  <main class="app-main">
    <div class="grid">
      <!-- Card 1: Parameters Received -->
      <section class="card card-input">
        <h2>📥 Initial Parameters</h2>
        <p class="card-desc">Values passed by the LLM agent or environment triggers:</p>
        <pre class="json-box">{JSON.stringify(input, null, 2)}</pre>
      </section>

      <!-- Card 2: Interactive Tools -->
      <section class="card card-tools">
        <h2>⚙️ Test Backend Tools</h2>
        <p class="card-desc">Call methods exposed on the server-side Photon class:</p>

        <div class="tool-row">
          <h3>Echo Tool</h3>
          <div class="input-group">
            <input
              type="text"
              bind:value={echoText}
              placeholder="Enter message..."
            />
            <button onclick={handleEcho} disabled={loading.echo}>
              {loading.echo ? 'Calling...' : 'Call Echo'}
            </button>
          </div>
          {#if echoResult}
            <div class="result-badge">{echoResult}</div>
          {/if}
        </div>

        <div class="tool-row divider">
          <h3>Add Tool</h3>
          <div class="input-group">
            <input
              type="number"
              bind:value={numA}
              style="width: 80px"
            />
            <span class="math-operator">+</span>
            <input
              type="number"
              bind:value={numB}
              style="width: 80px"
            />
            <button onclick={handleAdd} disabled={loading.add}>
              {loading.add ? 'Calling...' : 'Call Add'}
            </button>
          </div>
          {#if addResult !== null}
            <div class="result-badge success">
              Sum: <strong>{addResult}</strong>
            </div>
          {/if}
        </div>
      </section>

      <!-- Card 3: Real-time Event Feed -->
      <section class="card card-events">
        <h2>⚡ Real-Time Events</h2>
        <p class="card-desc">Live messages pushed from the backend via the event pub/sub pipeline:</p>
        <div class="event-feed">
          {#if events.length === 0}
            <div class="feed-empty">No events received yet. Try running some tools.</div>
          {:else}
            {#each events as e}
              <div class="event-item">
                <span class="event-time">{e.time}</span>
                <span class="event-name">{e.emit}</span>
                <span class="event-data">{JSON.stringify(e.data)}</span>
              </div>
            {/each}
          {/if}
        </div>
      </section>
    </div>
  </main>
</div>

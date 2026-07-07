<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';

// ─── Bridge Declarations & Hooks ──────────────────────────────────────────
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

const hasBridge = ref(typeof window.photon !== 'undefined');
const input = ref(window.photon?.toolInput || {});
const theme = ref<'light' | 'dark'>(window.photon?.theme || 'light');
const echoText = ref('Hello Photon!');
const echoResult = ref('');
const numA = ref(5);
const numB = ref(10);
const addResult = ref<number | null>(null);
const loading = ref<Record<string, boolean>>({});
const events = ref<Array<{ time: string; emit: string; data: any }>>([]);

let unsubscribeTheme: (() => void) | undefined;
let unsubscribeEmit: (() => void) | undefined;

onMounted(() => {
  if (window.photon) {
    unsubscribeTheme = window.photon.onThemeChange((newTheme) => {
      theme.value = newTheme;
    });

    unsubscribeEmit = window.photon.onEmit((event) => {
      events.value.unshift({
        time: new Date().toLocaleTimeString(),
        emit: event.emit,
        data: event.data,
      });
      if (events.value.length > 10) {
        events.value.pop();
      }
    });
  }
});

onUnmounted(() => {
  if (unsubscribeTheme) unsubscribeTheme();
  if (unsubscribeEmit) unsubscribeEmit();
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
  loading.value.echo = true;
  try {
    const res = (await callTool('echo', { message: echoText.value })) as string;
    echoResult.value = res;
  } catch (err: any) {
    echoResult.value = `Error: ${err.message || err}`;
  } finally {
    loading.value.echo = false;
  }
};

const handleAdd = async () => {
  loading.value.add = true;
  try {
    const res = (await callTool('add', { a: numA.value, b: numB.value })) as any;
    addResult.value = res?.sum ?? null;
  } catch (err: any) {
    console.error(err);
  } finally {
    loading.value.add = false;
  }
};
</script>

<template>
  <div :class="['app-container', theme]">
    <header class="app-header">
      <div class="header-logo">
        <span class="logo-icon">💚</span>
        <h1>Photon Vue Dashboard</h1>
      </div>
      <div class="connection-badge">
        <span :class="['status-dot', hasBridge ? 'connected' : 'mock']" />
        {{ hasBridge ? 'Photon Connected' : 'Local Mock Mode' }}
      </div>
    </header>

    <main class="app-main">
      <div class="grid">
        <!-- Card 1: Parameters Received -->
        <section class="card card-input">
          <h2>📥 Initial Parameters</h2>
          <p class="card-desc">Values passed by the LLM agent or environment triggers:</p>
          <pre class="json-box">{{ JSON.stringify(input, null, 2) }}</pre>
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
                v-model="echoText"
                placeholder="Enter message..."
              />
              <button @click="handleEcho" :disabled="loading.echo">
                {{ loading.echo ? 'Calling...' : 'Call Echo' }}
              </button>
            </div>
            <div v-if="echoResult" class="result-badge">{{ echoResult }}</div>
          </div>

          <div class="tool-row divider">
            <h3>Add Tool</h3>
            <div class="input-group">
              <input
                type="number"
                v-model.number="numA"
                style="width: 80px"
              />
              <span class="math-operator">+</span>
              <input
                type="number"
                v-model.number="numB"
                style="width: 80px"
              />
              <button @click="handleAdd" :disabled="loading.add">
                {{ loading.add ? 'Calling...' : 'Call Add' }}
              </button>
            </div>
            <div v-if="addResult !== null" class="result-badge success">
              Sum: <strong>{{ addResult }}</strong>
            </div>
          </div>
        </section>

        <!-- Card 3: Real-time Event Feed -->
        <section class="card card-events">
          <h2>⚡ Real-Time Events</h2>
          <p class="card-desc">Live messages pushed from the backend via the event pub/sub pipeline:</p>
          <div class="event-feed">
            <div v-if="events.length === 0" class="feed-empty">
              No events received yet. Try running some tools.
            </div>
            <div v-else v-for="(e, index) in events" :key="index" class="event-item">
              <span class="event-time">{{ e.time }}</span>
              <span class="event-name">{{ e.emit }}</span>
              <span class="event-data">{{ JSON.stringify(e.data) }}</span>
            </div>
          </div>
        </section>
      </div>
    </main>
  </div>
</template>

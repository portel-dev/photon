import { useEffect, useState } from 'react';

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
    [photonName: string]: any;
  }
}

// ─── React Integration Hooks ──────────────────────────────────────────────
export function usePhoton() {
  const [hasBridge] = useState(() => typeof window.photon !== 'undefined');
  const [input] = useState(() => window.photon?.toolInput || {});
  const [state, setState] = useState(() => window.photon?.widgetState || {});
  const [theme, setTheme] = useState<'light' | 'dark'>(() => window.photon?.theme || 'light');

  useEffect(() => {
    if (!window.photon) return;
    return window.photon.onThemeChange((newTheme) => {
      setTheme(newTheme);
    });
  }, []);

  const updateState = (newState: any) => {
    setState(newState);
    window.photon?.setWidgetState(newState);
  };

  const callTool = async (name: string, args: any = {}) => {
    if (window.photon) {
      return window.photon.callTool(name, args);
    }
    // Mock local fallback for independent browser testing
    console.warn(`[Photon Mock] calling ${name} with`, args);
    return new Promise((resolve) => setTimeout(() => {
      if (name === 'add') resolve({ a: args.a, b: args.b, sum: args.a + args.b });
      else if (name === 'echo') resolve(`Echo: ${args.message}`);
      else resolve({ mockResult: true });
    }, 500));
  };

  return { hasBridge, input, state, updateState, theme, callTool };
}

export function usePhotonEmit(callback: (event: { emit: string; data?: any }) => void) {
  useEffect(() => {
    if (!window.photon) return;
    return window.photon.onEmit(callback);
  }, [callback]);
}

// ─── Main Component ───────────────────────────────────────────────────────
export default function App() {
  const { hasBridge, input, theme, callTool } = usePhoton();
  const [echoText, setEchoText] = useState('Hello Photon!');
  const [echoResult, setEchoResult] = useState('');
  const [numA, setNumA] = useState(5);
  const [numB, setNumB] = useState(10);
  const [addResult, setAddResult] = useState<number | null>(null);
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [events, setEvents] = useState<Array<{ time: string; emit: string; data: any }>>([]);

  // Subscribe to real-time events
  usePhotonEmit((event) => {
    setEvents((prev) => [
      {
        time: new Date().toLocaleTimeString(),
        emit: event.emit,
        data: event.data,
      },
      ...prev.slice(0, 9), // Keep last 10 events
    ]);
  });

  const handleEcho = async () => {
    setLoading((l) => ({ ...l, echo: true }));
    try {
      const res = await callTool('echo', { message: echoText });
      setEchoResult(res);
    } catch (err: any) {
      setEchoResult(`Error: ${err.message || err}`);
    } finally {
      setLoading((l) => ({ ...l, echo: false }));
    }
  };

  const handleAdd = async () => {
    setLoading((l) => ({ ...l, add: true }));
    try {
      const res = await callTool('add', { a: numA, b: numB });
      setAddResult(res?.sum ?? null);
    } catch (err: any) {
      console.error(err);
    } finally {
      setLoading((l) => ({ ...l, add: false }));
    }
  };

  return (
    <div className={`app-container ${theme}`}>
      <header className="app-header">
        <div className="header-logo">
          <span className="logo-icon">⚛️</span>
          <h1>Photon React Dashboard</h1>
        </div>
        <div className="connection-badge">
          <span className={`status-dot ${hasBridge ? 'connected' : 'mock'}`} />
          {hasBridge ? 'Photon Connected' : 'Local Mock Mode'}
        </div>
      </header>

      <main className="app-main">
        <div className="grid">
          {/* Card 1: Parameters Received */}
          <section className="card card-input">
            <h2>📥 Initial Parameters</h2>
            <p className="card-desc">Values passed by the LLM agent or environment triggers:</p>
            <pre className="json-box">
              {JSON.stringify(input, null, 2)}
            </pre>
          </section>

          {/* Card 2: Interactive Tools */}
          <section className="card card-tools">
            <h2>⚙️ Test Backend Tools</h2>
            <p className="card-desc">Call methods exposed on the server-side Photon class:</p>

            <div className="tool-row">
              <h3>Echo Tool</h3>
              <div className="input-group">
                <input
                  type="text"
                  value={echoText}
                  onChange={(e) => setEchoText(e.target.value)}
                  placeholder="Enter message..."
                />
                <button onClick={handleEcho} disabled={loading.echo}>
                  {loading.echo ? 'Calling...' : 'Call Echo'}
                </button>
              </div>
              {echoResult && <div className="result-badge">{echoResult}</div>}
            </div>

            <div className="tool-row divider">
              <h3>Add Tool</h3>
              <div className="input-group">
                <input
                  type="number"
                  value={numA}
                  onChange={(e) => setNumA(Number(e.target.value))}
                  style={{ width: '80px' }}
                />
                <span className="math-operator">+</span>
                <input
                  type="number"
                  value={numB}
                  onChange={(e) => setNumB(Number(e.target.value))}
                  style={{ width: '80px' }}
                />
                <button onClick={handleAdd} disabled={loading.add}>
                  {loading.add ? 'Calling...' : 'Call Add'}
                </button>
              </div>
              {addResult !== null && (
                <div className="result-badge success">
                  Sum: <strong>{addResult}</strong>
                </div>
              )}
            </div>
          </section>

          {/* Card 3: Real-time Event Feed */}
          <section className="card card-events">
            <h2>⚡ Real-Time Events</h2>
            <p className="card-desc">Live messages pushed from the backend via the event pub/sub pipeline:</p>
            <div className="event-feed">
              {events.length === 0 ? (
                <div className="feed-empty">No events received yet. Try running some tools.</div>
              ) : (
                events.map((e, index) => (
                  <div className="event-item" key={index}>
                    <span className="event-time">{e.time}</span>
                    <span className="event-name">{e.emit}</span>
                    <span className="event-data">{JSON.stringify(e.data)}</span>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}

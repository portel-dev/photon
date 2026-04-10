/**
 * Canvas Demo
 *
 * Demonstrates the two-stream canvas system where UI layout
 * and data are streamed independently and merged via named slots.
 */
export default class CanvasDemo {
  /**
   * Dashboard with multiple data visualizations
   *
   * Streams a grid layout first, then fills each slot with data.
   * Slots render independently as their data arrives.
   */
  async *dashboard() {
    // Stream 1: UI layout with named slots
    yield {
      emit: 'canvas:ui',
      html: `
        <style>
          h1 { margin-bottom: 16px; font-size: 20px; }
          .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
          .full { grid-column: 1 / -1; }
          [data-slot] {
            background: var(--color-surface-container);
            border-radius: var(--radius-md, 8px);
            padding: 16px;
          }
          .label { font-size: 12px; color: var(--color-on-surface-muted); margin-bottom: 8px; }
        </style>
        <h1>Sales Dashboard</h1>
        <div class="grid">
          <div>
            <div class="label">Revenue</div>
            <div data-slot="revenue" data-format="metric"></div>
          </div>
          <div>
            <div class="label">Customers</div>
            <div data-slot="customers" data-format="metric"></div>
          </div>
          <div class="full">
            <div class="label">Monthly Revenue</div>
            <div data-slot="chart" data-format="chart:bar"></div>
          </div>
          <div class="full">
            <div class="label">Recent Orders</div>
            <div data-slot="orders" data-format="table"></div>
          </div>
        </div>
      `,
    };

    // Stream 2: Data arrives slot by slot (simulating async data sources)
    yield {
      emit: 'canvas:data',
      slot: 'revenue',
      data: { value: '$142,850', trend: '+12.5%', period: 'this month' },
    };

    // Small delay to show incremental rendering
    await new Promise((r) => setTimeout(r, 300));

    yield {
      emit: 'canvas:data',
      slot: 'customers',
      data: { value: '2,847', trend: '+8.3%', period: 'active users' },
    };

    await new Promise((r) => setTimeout(r, 300));

    yield {
      emit: 'canvas:data',
      slot: 'chart',
      data: [
        { month: 'Jan', revenue: 42000 },
        { month: 'Feb', revenue: 48000 },
        { month: 'Mar', revenue: 51000 },
        { month: 'Apr', revenue: 55000 },
        { month: 'May', revenue: 62000 },
        { month: 'Jun', revenue: 71000 },
      ],
    };

    await new Promise((r) => setTimeout(r, 300));

    yield {
      emit: 'canvas:data',
      slot: 'orders',
      data: [
        { id: '#1042', customer: 'Acme Corp', amount: '$4,200', status: 'shipped' },
        { id: '#1041', customer: 'Globex Inc', amount: '$1,850', status: 'processing' },
        { id: '#1040', customer: 'Initech', amount: '$3,100', status: 'delivered' },
        { id: '#1039', customer: 'Umbrella Ltd', amount: '$7,400', status: 'shipped' },
        { id: '#1038', customer: 'Stark Industries', amount: '$12,000', status: 'delivered' },
      ],
    };

    return { status: 'rendered', slots: 4 };
  }

  /**
   * Data-first demo — data arrives before UI
   *
   * Proves the reconciler buffers data when slots don't exist yet.
   */
  async *reversed() {
    // Send data FIRST (before any UI exists)
    yield {
      emit: 'canvas:data',
      slot: 'status',
      data: { value: 'Online', trend: '99.9% uptime' },
    };

    yield {
      emit: 'canvas:data',
      slot: 'latency',
      data: { value: '23ms', trend: '-5ms' },
    };

    // UI arrives after — reconciler should immediately render buffered data
    await new Promise((r) => setTimeout(r, 500));

    yield {
      emit: 'canvas:ui',
      html: `
        <style>
          .row { display: flex; gap: 16px; }
          .card {
            flex: 1;
            background: var(--color-surface-container);
            border-radius: var(--radius-md, 8px);
            padding: 16px;
          }
          .card-label { font-size: 12px; color: var(--color-on-surface-muted); margin-bottom: 8px; }
        </style>
        <h2>System Status</h2>
        <div class="row">
          <div class="card">
            <div class="card-label">Status</div>
            <div data-slot="status" data-format="metric"></div>
          </div>
          <div class="card">
            <div class="card-label">Latency</div>
            <div data-slot="latency" data-format="metric"></div>
          </div>
        </div>
      `,
    };

    return { status: 'rendered', order: 'data-before-ui' };
  }

  /**
   * Live update demo — same slot updated multiple times
   *
   * Shows incremental slot updates without replacing the full UI.
   */
  async *live() {
    yield {
      emit: 'canvas:ui',
      html: `
        <style>
          .container { max-width: 400px; }
          .counter-card {
            background: var(--color-surface-container);
            border-radius: var(--radius-md, 8px);
            padding: 24px;
            text-align: center;
          }
          .counter-label { font-size: 12px; color: var(--color-on-surface-muted); margin-bottom: 8px; }
        </style>
        <div class="container">
          <h2>Live Counter</h2>
          <div class="counter-card">
            <div class="counter-label">Requests per second</div>
            <div data-slot="rps" data-format="metric"></div>
          </div>
        </div>
      `,
    };

    // Simulate live updates
    const values = [1250, 1340, 1180, 1420, 1560, 1380, 1490, 1620];
    for (const value of values) {
      await new Promise((r) => setTimeout(r, 600));
      const prev = values[values.indexOf(value) - 1] || value;
      const diff = value - prev;
      const trend = diff >= 0 ? `+${diff}` : `${diff}`;
      yield {
        emit: 'canvas:data',
        slot: 'rps',
        data: { value: value.toLocaleString(), trend, period: 'req/s' },
      };
    }

    return { status: 'rendered', updates: values.length };
  }

  /**
   * List all supported canvas formats with their expected data shapes
   * @readOnly
   * @format table
   */
  catalog() {
    return Object.entries((this as any).formats).map(([name, spec]: [string, any]) => ({
      format: name,
      data: spec.data,
    }));
  }
}

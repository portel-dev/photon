/**
 * Render Showcase
 *
 * Demonstrates photon.render() — how custom UIs can use auto UI
 * format renderers (table, gauge, chart, etc.) without building
 * everything from scratch.
 *
 * Each method returns sample data in a shape that a specific
 * format renderer understands. The custom UI dashboard calls
 * photon.render(container, data, format) to visualize them.
 *
 * @version 1.0.0
 * @icon 🎨
 * @runtime ^1.13.0
 * @ui dashboard ./ui/dashboard.html
 */
export default class RenderShowcase {
  /**
   * Open the render showcase dashboard
   * @ui dashboard
   */
  async main() {
    return { status: 'Dashboard loaded' };
  }

  /**
   * Sample user data for table rendering
   * @format table
   * @ui dashboard
   */
  users() {
    return [
      {
        name: 'Alice Chen',
        email: 'alice@example.com',
        role: 'Admin',
        status: 'Active',
        lastLogin: '2026-03-18',
      },
      {
        name: 'Bob Smith',
        email: 'bob@example.com',
        role: 'Editor',
        status: 'Active',
        lastLogin: '2026-03-17',
      },
      {
        name: 'Carol Wu',
        email: 'carol@example.com',
        role: 'Viewer',
        status: 'Pending',
        lastLogin: '2026-03-15',
      },
      {
        name: 'Dan Park',
        email: 'dan@example.com',
        role: 'Editor',
        status: 'Offline',
        lastLogin: '2026-03-10',
      },
      {
        name: 'Eve Jones',
        email: 'eve@example.com',
        role: 'Admin',
        status: 'Active',
        lastLogin: '2026-03-18',
      },
    ];
  }

  /**
   * CPU usage for gauge rendering
   * @format gauge
   * @ui dashboard
   */
  cpu() {
    const usage = Math.round(35 + Math.random() * 50);
    return { value: usage, max: 100, label: 'CPU Usage', unit: '%' };
  }

  /**
   * Memory usage for gauge rendering
   * @format gauge
   * @ui dashboard
   */
  memory() {
    const used = +(4.2 + Math.random() * 8).toFixed(1);
    return { value: used, max: 16, label: 'Memory', unit: 'GB' };
  }

  /**
   * Monthly revenue for chart rendering
   * @format chart:bar
   * @ui dashboard
   */
  revenue() {
    return [
      { month: 'Jan', revenue: 12400, costs: 8200 },
      { month: 'Feb', revenue: 15800, costs: 9100 },
      { month: 'Mar', revenue: 14200, costs: 8800 },
      { month: 'Apr', revenue: 18600, costs: 10200 },
      { month: 'May', revenue: 21000, costs: 11500 },
      { month: 'Jun', revenue: 19400, costs: 10800 },
    ];
  }

  /**
   * Temperature trend for line chart
   * @format chart:line
   * @ui dashboard
   */
  temperature() {
    return [
      { hour: '6am', indoor: 21, outdoor: 14 },
      { hour: '9am', indoor: 22, outdoor: 18 },
      { hour: '12pm', indoor: 23, outdoor: 24 },
      { hour: '3pm', indoor: 24, outdoor: 27 },
      { hour: '6pm', indoor: 23, outdoor: 22 },
      { hour: '9pm', indoor: 22, outdoor: 17 },
    ];
  }

  /**
   * Key business metric
   * @format metric
   * @ui dashboard
   */
  activeUsers() {
    return { value: 14283, label: 'Active Users', delta: 842, trend: 'up' };
  }

  /**
   * Deployment progress
   * @format progress
   * @ui dashboard
   */
  deployment() {
    return { value: 73, max: 100, label: 'Deployment Progress' };
  }

  /**
   * Recent activity timeline
   * @format timeline
   * @ui dashboard
   */
  activity() {
    return [
      { time: '2026-03-18T08:00:00Z', event: 'Deploy started', details: 'v2.4.1 to production' },
      { time: '2026-03-18T08:02:00Z', event: 'Tests passed', details: '142 tests, 0 failures' },
      { time: '2026-03-18T08:05:00Z', event: 'Build complete', details: 'Bundle size: 2.1MB' },
      { time: '2026-03-18T08:06:00Z', event: 'Deploy live', details: 'All regions healthy' },
    ];
  }

  /**
   * Service status badges
   * @format badge
   * @ui dashboard
   */
  services() {
    return [
      { name: 'API', status: 'Healthy' },
      { name: 'Database', status: 'Active' },
      { name: 'Cache', status: 'Degraded' },
      { name: 'Queue', status: 'Offline' },
      { name: 'CDN', status: 'Active' },
    ];
  }

  /**
   * Team members list
   * @format list
   * @ui dashboard
   */
  team() {
    return [
      { name: 'Alice Chen', role: 'Lead Engineer', status: 'Online' },
      { name: 'Bob Smith', role: 'Frontend Dev', status: 'In Meeting' },
      { name: 'Carol Wu', role: 'Designer', status: 'Online' },
      { name: 'Dan Park', role: 'Backend Dev', status: 'Offline' },
    ];
  }

  /**
   * System configuration key-value pairs
   * @format kv
   * @ui dashboard
   */
  config() {
    return {
      environment: 'production',
      region: 'us-east-1',
      nodeVersion: '22.4.0',
      uptime: '14d 6h 32m',
      connections: 847,
      cacheHitRate: '94.2%',
    };
  }

  /**
   * Release notes in markdown
   * @format markdown
   * @ui dashboard
   */
  changelog() {
    return `# v2.4.1 Release Notes

## New Features
- **Custom UI Renderers** — use photon.render() in custom dashboards
- **Gauge visualization** — SVG-based semicircular gauges with color gradients

## Bug Fixes
- Fixed gauge arc alignment in SVG renderer
- Fixed iframe blob URL cache invalidation on photon reload

## Breaking Changes
*None*`;
  }
}

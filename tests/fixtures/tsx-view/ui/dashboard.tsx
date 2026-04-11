// TSX view — uses Photon's built-in JSX runtime (no React/Preact needed)

interface StatCardProps {
  name: string;
  count: number;
}

function StatCard({ name, count }: StatCardProps) {
  return (
    <div className="card" style={{ padding: '16px', borderRadius: '8px', background: 'var(--color-surface, #1e1e2e)' }}>
      <div style={{ fontSize: '13px', color: 'var(--color-muted, #888)', marginBottom: '4px' }}>{name}</div>
      <div style={{ fontSize: '28px', fontWeight: 'bold', color: 'var(--color-text, #e6e6e6)' }}>
        {count.toLocaleString()}
      </div>
    </div>
  );
}

interface DashboardData {
  title: string;
  items: Array<{ name: string; count: number }>;
}

function Dashboard({ data }: { data: DashboardData }) {
  return (
    <div style={{ padding: '24px' }}>
      <h1 style={{ margin: '0 0 20px', fontSize: '20px', color: 'var(--color-text, #e6e6e6)' }}>
        {data.title}
      </h1>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px' }}>
        {data.items.map((item) => (
          <StatCard name={item.name} count={item.count} />
        ))}
      </div>
    </div>
  );
}

// Listen for data from the photon bridge
const root = document.getElementById('root')!;

// Render with sample data immediately (bridge will update with real data)
const sampleData: DashboardData = {
  title: 'Loading...',
  items: [],
};

render(<Dashboard data={sampleData} />, root);

// When real data arrives via the bridge
window.addEventListener('message', (event) => {
  if (event.data?.jsonrpc === '2.0' && event.data?.method === 'ui/notifications/tool-result') {
    const result = event.data.params?.result;
    if (result) {
      render(<Dashboard data={result} />, root);
    }
  }
});

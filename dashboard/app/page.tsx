async function fetchChains(params?: { q?: string }) {
  const res = await fetch('http://pocket_indexer_api:3006/api/v1/metrics/chains', { cache: 'no-store' });
  if (!res.ok) return { data: [] };
  return res.json();
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
      <div style={{ color: '#555' }}>{label}:</div>
      <div style={{ fontWeight: 600 }}>{value}</div>
    </div>
  );
}

export default async function HomePage({ searchParams }: { searchParams: { q?: string } }) {
  const { data } = await fetchChains(searchParams);
  const q = (searchParams?.q || '').toLowerCase();
  const filtered = data.filter((c: any) => !q || String(c.chain).toLowerCase().includes(q));
  return (
    <div>
      <form action="/" method="get" className="mb-4 flex gap-2">
        <input name="q" defaultValue={q} placeholder="Filter chains..." className="px-3 py-2 w-72 border border-gray-200 rounded-md bg-white shadow-sm" />
        <button type="submit" className="px-3 py-2 rounded-md bg-blue-600 text-white">Filter</button>
      </form>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((c: any) => {
          const lag = (c.latest_height ?? 0) - (c.processed_height ?? 0);
          return (
            <a key={c.chain} href={`/chains/${encodeURIComponent(c.chain)}`} className="block p-4 rounded-lg border border-gray-200 bg-white shadow-sm hover:shadow transition">
              <div className="text-lg font-semibold mb-2">{c.chain}</div>
              <div className="grid gap-1 text-sm">
                <div className="flex items-baseline gap-2"><span className="text-gray-500">Processed:</span><span className="font-semibold">{c.processed_height ?? '-'}</span></div>
                <div className="flex items-baseline gap-2"><span className="text-gray-500">Latest:</span><span className="font-semibold">{c.latest_height ?? '-'}</span></div>
                <div className="flex items-baseline gap-2"><span className="text-gray-500">Lag:</span><span className={`font-semibold ${lag > 0 ? 'text-orange-600' : 'text-green-600'}`}>{lag}</span></div>
                <div className="flex items-baseline gap-2"><span className="text-gray-500">TX/sec:</span><span className="font-semibold">{(c.tx_rate ?? 0).toFixed ? (c.tx_rate).toFixed(2) : c.tx_rate}</span></div>
                <div className="flex gap-4 mt-1">
                  <div className="flex items-baseline gap-1 text-gray-600"><span>Apps</span><span className="font-semibold">{c.applications ?? 0}</span></div>
                  <div className="flex items-baseline gap-1 text-gray-600"><span>Sup</span><span className="font-semibold">{c.suppliers ?? 0}</span></div>
                  <div className="flex items-baseline gap-1 text-gray-600"><span>GWs</span><span className="font-semibold">{c.gateways ?? 0}</span></div>
                  <div className="flex items-baseline gap-1 text-gray-600"><span>Svcs</span><span className="font-semibold">{c.services ?? 0}</span></div>
                </div>
                <div className="text-xs text-gray-500 mt-1">Updated: {new Date(c.ts).toLocaleString()}</div>
              </div>
            </a>
          );
        })}
        {filtered.length === 0 && <div>No chain metrics yet.</div>}
      </div>
    </div>
  );
}



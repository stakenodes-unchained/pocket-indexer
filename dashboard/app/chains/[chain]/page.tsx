interface Params { chain: string }

async function fetchChainHistory(chain: string) {
  const res = await fetch(`http://pocket_indexer_api:3006/api/v1/metrics/chains/${encodeURIComponent(chain)}?limit=200`, { cache: 'no-store' });
  if (!res.ok) return { data: [] };
  return res.json();
}

async function fetchApps(chain: string, page = 1, limit = 10, status?: string) {
  const url = new URL(`http://pocket_indexer_api:3006/api/v1/applications`);
  url.searchParams.set('chain', chain);
  url.searchParams.set('page', String(page));
  url.searchParams.set('limit', String(limit));
  if (status) url.searchParams.set('status', status);
  const res = await fetch(url.toString(), { cache: 'no-store' });
  if (!res.ok) return { data: [], meta: {} };
  return res.json();
}

async function fetchSuppliers(chain: string, page = 1, limit = 10, status?: string) {
  const url = new URL(`http://pocket_indexer_api:3006/api/v1/suppliers`);
  url.searchParams.set('chain', chain);
  url.searchParams.set('page', String(page));
  url.searchParams.set('limit', String(limit));
  if (status) url.searchParams.set('status', status);
  const res = await fetch(url.toString(), { cache: 'no-store' });
  if (!res.ok) return { data: [], meta: {} };
  return res.json();
}

async function fetchStaking(chain: string, page = 1, limit = 20, type?: string, event?: string) {
  const url = new URL(`http://pocket_indexer_api:3006/api/v1/staking`);
  url.searchParams.set('chain', chain);
  url.searchParams.set('page', String(page));
  url.searchParams.set('limit', String(limit));
  if (type) url.searchParams.set('type', type);
  if (event) url.searchParams.set('event', event);
  const res = await fetch(url.toString(), { cache: 'no-store' });
  if (!res.ok) return { data: [], meta: {} };
  return res.json();
}

async function fetchGateways(chain: string, page = 1, limit = 10, status?: string) {
  const url = new URL(`http://pocket_indexer_api:3006/api/v1/gateways`);
  url.searchParams.set('chain', chain);
  url.searchParams.set('page', String(page));
  url.searchParams.set('limit', String(limit));
  if (status) url.searchParams.set('status', status);
  const res = await fetch(url.toString(), { cache: 'no-store' });
  if (!res.ok) return { data: [], meta: {} };
  return res.json();
}

export default async function ChainDetail({ params, searchParams }: { params: Params, searchParams: Record<string, string | string[] | undefined> }) {
  const chain = decodeURIComponent(params.chain);
  const ap = parseInt(String(searchParams.ap || '1'), 10) || 1; // apps page
  const sp = parseInt(String(searchParams.sp || '1'), 10) || 1; // suppliers page
  const gp = parseInt(String(searchParams.gp || '1'), 10) || 1; // gateways page
  const ep = parseInt(String(searchParams.ep || '1'), 10) || 1; // events page
  const aStatus = String(searchParams.aStatus || '') || undefined;
  const sStatus = String(searchParams.sStatus || '') || undefined;
  const gStatus = String(searchParams.gStatus || '') || undefined;
  const eType = String(searchParams.eType || '') || undefined;
  const eEvent = String(searchParams.eEvent || '') || undefined;

  const [{ data }, appsRes, supsRes, gwsRes, stkRes] = await Promise.all([
    fetchChainHistory(chain),
    fetchApps(chain, ap, 10, aStatus),
    fetchSuppliers(chain, sp, 10, sStatus),
    fetchGateways(chain, gp, 10, gStatus),
    fetchStaking(chain, ep, 20, eType, eEvent),
  ]);
  const series = [...data].reverse();
  const points = series.map((d: any, i: number) => ({ x: i, y: Number(d.lag ?? ((d.latest_height ?? 0) - (d.processed_height ?? 0))), ts: d.ts }));

  // Simple inline SVG line chart
  const width = 800;
  const height = 240;
  const pad = 32;
  const maxY = Math.max(10, ...points.map(p => p.y));
  const maxX = Math.max(1, points.length - 1);
  const toX = (x: number) => pad + (x / maxX) * (width - 2 * pad);
  const toY = (y: number) => height - pad - (y / maxY) * (height - 2 * pad);
  const path = points.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${toX(p.x)} ${toY(p.y)}`).join(' ');
  const tickCount = Math.min(6, Math.max(2, points.length));
  const xTicks = Array.from({ length: tickCount }, (_, i) => {
    const idx = Math.round((i * (points.length - 1)) / (tickCount - 1));
    return { x: points[idx]?.x ?? 0, ts: points[idx]?.ts };
  });

  return (
    <div>
      <a href="/" className="inline-block mb-3 text-blue-600 hover:underline">&larr; Back</a>
      <h2 className="mt-0 text-xl font-semibold">{chain}</h2>
      <div className="text-gray-600 mb-3">Lag over time (last {points.length} samples)</div>
      <div className="rounded-md border border-gray-200 bg-white p-3 shadow-sm overflow-x-auto">
        <svg width={width} height={height}>
          <rect x={0} y={0} width={width} height={height} fill="#fff" />
          <path d={path} fill="none" stroke="#2563eb" strokeWidth={2} />
          {/* y-axis labels */}
          <text x={8} y={toY(0)} fontSize={10} fill="#666">0</text>
          <text x={8} y={toY(maxY)} fontSize={10} fill="#666">{maxY}</text>
          {/* x-axis line */}
          <line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} stroke="#e5e7eb" />
          {/* x-axis ticks & labels */}
          {xTicks.map((t, i) => (
            <g key={i}>
              <line x1={toX(t.x)} y1={height - pad} x2={toX(t.x)} y2={height - pad + 4} stroke="#9ca3af" />
              <text x={toX(t.x)} y={height - pad + 14} fontSize={10} fill="#666" textAnchor="middle">
                {t.ts ? new Date(t.ts).toLocaleTimeString() : ''}
              </text>
            </g>
          ))}
        </svg>
      </div>
      <div className="h-4" />
      <div className="grid md:grid-cols-2 gap-4">
        <div className="rounded-md border border-gray-200 bg-white p-3 shadow-sm">
          <form method="get" className="mb-2 flex items-center gap-2 text-sm text-gray-600">
            <input type="hidden" name="sp" value={sp} />
            <input type="hidden" name="gp" value={gp} />
            <input type="hidden" name="ep" value={ep} />
            <label>App status</label>
            <select name="aStatus" defaultValue={aStatus || ''} className="border border-gray-200 rounded-md px-2 py-1">
              <option value="">All</option>
              <option value="staked">staked</option>
              <option value="delegated">delegated</option>
              <option value="unstake_requested">unstake_requested</option>
            </select>
            <button type="submit" className="ml-2 px-2 py-1 rounded-md bg-blue-600 text-white">Apply</button>
          </form>
          <h3 className="mt-0 font-semibold">Applications</h3>
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="text-left border-b border-gray-200 p-2">Address</th>
                <th className="text-left border-b border-gray-200 p-2">Stake</th>
                <th className="text-left border-b border-gray-200 p-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {appsRes.data.slice(0, 10).map((a: any) => (
                <tr key={a.address}>
                  <td className="p-2 border-b border-gray-100">{a.address}</td>
                  <td className="p-2 border-b border-gray-100">{a.staked_amount ?? '-'}</td>
                  <td className="p-2 border-b border-gray-100">{a.status ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center gap-3 mt-3 text-sm">
            {ap > 1 ? (
              <a className="px-3 py-1 rounded-md bg-gray-100 hover:bg-gray-200 border border-gray-200" href={`?ap=${Math.max(1, ap - 1)}&sp=${sp}&gp=${gp}&ep=${ep}${aStatus ? `&aStatus=${aStatus}` : ''}${sStatus ? `&sStatus=${sStatus}` : ''}${gStatus ? `&gStatus=${gStatus}` : ''}${eType ? `&eType=${eType}` : ''}${eEvent ? `&eEvent=${eEvent}` : ''}`}>
                Prev
              </a>
            ) : (
              <span className="px-3 py-1 rounded-md bg-gray-50 border border-gray-100 text-gray-400 cursor-not-allowed">Prev</span>
            )}
            <span className="text-gray-600">Page {ap}</span>
            <a className="px-3 py-1 rounded-md bg-blue-600 text-white hover:bg-blue-700" href={`?ap=${ap + 1}&sp=${sp}&gp=${gp}&ep=${ep}${aStatus ? `&aStatus=${aStatus}` : ''}${sStatus ? `&sStatus=${sStatus}` : ''}${gStatus ? `&gStatus=${gStatus}` : ''}${eType ? `&eType=${eType}` : ''}${eEvent ? `&eEvent=${eEvent}` : ''}`}>
              Next
            </a>
          </div>
        </div>
        <div className="rounded-md border border-gray-200 bg-white p-3 shadow-sm">
          <form method="get" className="mb-2 flex items-center gap-2 text-sm text-gray-600">
            <input type="hidden" name="ap" value={ap} />
            <input type="hidden" name="gp" value={gp} />
            <input type="hidden" name="ep" value={ep} />
            <label>Supplier status</label>
            <select name="sStatus" defaultValue={sStatus || ''} className="border border-gray-200 rounded-md px-2 py-1">
              <option value="">All</option>
              <option value="staked">staked</option>
              <option value="unstake_requested">unstake_requested</option>
            </select>
            <button type="submit" className="ml-2 px-2 py-1 rounded-md bg-blue-600 text-white">Apply</button>
          </form>
          <h3 className="mt-0 font-semibold">Suppliers</h3>
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="text-left border-b border-gray-200 p-2">Operator</th>
                <th className="text-left border-b border-gray-200 p-2">Stake</th>
                <th className="text-left border-b border-gray-200 p-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {supsRes.data.slice(0, 10).map((s: any) => (
                <tr key={s.address}>
                  <td className="p-2 border-b border-gray-100">{s.address}</td>
                  <td className="p-2 border-b border-gray-100">{s.staked_amount ?? '-'}</td>
                  <td className="p-2 border-b border-gray-100">{s.status ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center gap-3 mt-3 text-sm">
            {sp > 1 ? (
              <a className="px-3 py-1 rounded-md bg-gray-100 hover:bg-gray-200 border border-gray-200" href={`?sp=${Math.max(1, sp - 1)}&ap=${ap}&gp=${gp}&ep=${ep}${aStatus ? `&aStatus=${aStatus}` : ''}${sStatus ? `&sStatus=${sStatus}` : ''}${gStatus ? `&gStatus=${gStatus}` : ''}${eType ? `&eType=${eType}` : ''}${eEvent ? `&eEvent=${eEvent}` : ''}`}>
                Prev
              </a>
            ) : (
              <span className="px-3 py-1 rounded-md bg-gray-50 border border-gray-100 text-gray-400 cursor-not-allowed">Prev</span>
            )}
            <span className="text-gray-600">Page {sp}</span>
            <a className="px-3 py-1 rounded-md bg-blue-600 text-white hover:bg-blue-700" href={`?sp=${sp + 1}&ap=${ap}&gp=${gp}&ep=${ep}${aStatus ? `&aStatus=${aStatus}` : ''}${sStatus ? `&sStatus=${sStatus}` : ''}${gStatus ? `&gStatus=${gStatus}` : ''}${eType ? `&eType=${eType}` : ''}${eEvent ? `&eEvent=${eEvent}` : ''}`}>
              Next
            </a>
          </div>
        </div>
      </div>
      <div className="h-4" />
      <div className="rounded-md border border-gray-200 bg-white p-3 shadow-sm">
        <form method="get" className="mb-2 flex items-center gap-2 text-sm text-gray-600">
          <input type="hidden" name="ap" value={ap} />
          <input type="hidden" name="sp" value={sp} />
          <input type="hidden" name="gp" value={gp} />
          <label>Event type</label>
          <select name="eType" defaultValue={eType || ''} className="border border-gray-200 rounded-md px-2 py-1">
            <option value="">All</option>
            <option value="application">application</option>
            <option value="supplier">supplier</option>
            <option value="gateway">gateway</option>
          </select>
          <label className="ml-2">Event</label>
          <select name="eEvent" defaultValue={eEvent || ''} className="border border-gray-200 rounded-md px-2 py-1">
            <option value="">All</option>
            <option value="stake">stake</option>
            <option value="unstake">unstake</option>
            <option value="delegate_to_gateway">delegate_to_gateway</option>
            <option value="undelegate_from_gateway">undelegate_from_gateway</option>
          </select>
          <button type="submit" className="ml-2 px-2 py-1 rounded-md bg-blue-600 text-white">Apply</button>
        </form>
        <h3 className="mt-0 font-semibold">Recent Staking Events</h3>
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="text-left border-b border-gray-200 p-2">Time</th>
              <th className="text-left border-b border-gray-200 p-2">Type</th>
              <th className="text-left border-b border-gray-200 p-2">Event</th>
              <th className="text-left border-b border-gray-200 p-2">Address</th>
              <th className="text-left border-b border-gray-200 p-2">Amount</th>
            </tr>
          </thead>
          <tbody>
            {stkRes.data.slice(0, 20).map((e: any, idx: number) => (
              <tr key={idx}>
                <td className="p-2 border-b border-gray-100">{new Date(e.timestamp).toLocaleString()}</td>
                <td className="p-2 border-b border-gray-100">{e.type}</td>
                <td className="p-2 border-b border-gray-100">{e.event}</td>
                <td className="p-2 border-b border-gray-100">{e.address}</td>
                <td className="p-2 border-b border-gray-100">{e.amount ?? '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex items-center gap-3 mt-3 text-sm">
          {ep > 1 ? (
            <a className="px-3 py-1 rounded-md bg-gray-100 hover:bg-gray-200 border border-gray-200" href={`?ep=${Math.max(1, ep - 1)}&ap=${ap}&sp=${sp}&gp=${gp}${aStatus ? `&aStatus=${aStatus}` : ''}${sStatus ? `&sStatus=${sStatus}` : ''}${gStatus ? `&gStatus=${gStatus}` : ''}${eType ? `&eType=${eType}` : ''}${eEvent ? `&eEvent=${eEvent}` : ''}`}>
              Prev
            </a>
          ) : (
            <span className="px-3 py-1 rounded-md bg-gray-50 border border-gray-100 text-gray-400 cursor-not-allowed">Prev</span>
          )}
          <span className="text-gray-600">Page {ep}</span>
          <a className="px-3 py-1 rounded-md bg-blue-600 text-white hover:bg-blue-700" href={`?ep=${ep + 1}&ap=${ap}&sp=${sp}&gp=${gp}${aStatus ? `&aStatus=${aStatus}` : ''}${sStatus ? `&sStatus=${sStatus}` : ''}${gStatus ? `&gStatus=${gStatus}` : ''}${eType ? `&eType=${eType}` : ''}${eEvent ? `&eEvent=${eEvent}` : ''}`}>
            Next
          </a>
        </div>
      </div>
      <div className="h-4" />
      <div className="rounded-md border border-gray-200 bg-white p-3 shadow-sm">
        <form method="get" className="mb-2 flex items-center gap-2 text-sm text-gray-600">
          <input type="hidden" name="ap" value={ap} />
          <input type="hidden" name="sp" value={sp} />
          <input type="hidden" name="ep" value={ep} />
          <label>Gateway status</label>
          <select name="gStatus" defaultValue={gStatus || ''} className="border border-gray-200 rounded-md px-2 py-1">
            <option value="">All</option>
            <option value="staked">staked</option>
            <option value="unstake_requested">unstake_requested</option>
          </select>
          <button type="submit" className="ml-2 px-2 py-1 rounded-md bg-blue-600 text-white">Apply</button>
        </form>
        <h3 className="mt-0 font-semibold">Gateways</h3>
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="text-left border-b border-gray-200 p-2">Address</th>
              <th className="text-left border-b border-gray-200 p-2">Stake</th>
              <th className="text-left border-b border-gray-200 p-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {gwsRes.data.slice(0, 10).map((g: any) => (
              <tr key={g.address}>
                <td className="p-2 border-b border-gray-100">{g.address}</td>
                <td className="p-2 border-b border-gray-100">{g.staked_amount ?? '-'}</td>
                <td className="p-2 border-b border-gray-100">{g.status ?? '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex items-center gap-3 mt-3 text-sm">
          {gp > 1 ? (
            <a className="px-3 py-1 rounded-md bg-gray-100 hover:bg-gray-200 border border-gray-200" href={`?gp=${Math.max(1, gp - 1)}&ap=${ap}&sp=${sp}&ep=${ep}${aStatus ? `&aStatus=${aStatus}` : ''}${sStatus ? `&sStatus=${sStatus}` : ''}${gStatus ? `&gStatus=${gStatus}` : ''}${eType ? `&eType=${eType}` : ''}${eEvent ? `&eEvent=${eEvent}` : ''}`}>
              Prev
            </a>
          ) : (
            <span className="px-3 py-1 rounded-md bg-gray-50 border border-gray-100 text-gray-400 cursor-not-allowed">Prev</span>
          )}
          <span className="text-gray-600">Page {gp}</span>
          <a className="px-3 py-1 rounded-md bg-blue-600 text-white hover:bg-blue-700" href={`?gp=${gp + 1}&ap=${ap}&sp=${sp}&ep=${ep}${aStatus ? `&aStatus=${aStatus}` : ''}${sStatus ? `&sStatus=${sStatus}` : ''}${gStatus ? `&gStatus=${gStatus}` : ''}${eType ? `&eType=${eType}` : ''}${eEvent ? `&eEvent=${eEvent}` : ''}`}>
            Next
          </a>
        </div>
      </div>
    </div>
  );
}



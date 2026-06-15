// /orders/alberts — full Albert's + UNFI buy universe with reorder-point-driven buy decision.
// Built from the alberts_buy_universe SQL view (catalog + live inventory + 30d velocity + proposed reorder points).
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

interface Row {
  thrive_variant_id: string;
  sku: string | null;
  item_name: string | null;
  department: string | null;
  vendor: string | null;
  units_per_case: number | null;
  on_hand: number | null;
  effective_reorder_point: number | null;
  rop_source: string | null;
  proposed_reorder_point: number | null;
  units_30d: number | null;
  velocity_per_day: number | null;
  days_of_supply: number | null;
  buy_decision: string;
  suggested_units: number | null;
}

function num(n: number | null | undefined, d = 0): string {
  if (n == null) return '—';
  return Number(n).toFixed(d);
}

function decisionBadge(d: string): string {
  const map: Record<string, string> = {
    BUY: 'bg-emerald-100 text-emerald-800',
    REVIEW: 'bg-amber-100 text-amber-800',
    SKIP: 'bg-zinc-100 text-zinc-600',
  };
  return map[d] ?? 'bg-zinc-100 text-zinc-600';
}

const decisionOrder: Record<string, number> = { BUY: 0, REVIEW: 1, SKIP: 2 };

export default async function AlbertsBuyUniversePage({
  searchParams,
}: {
  searchParams: Promise<{ v?: string; d?: string }>;
}) {
  const admin = createAdminClient();
  if (!admin) {
    return <div className="p-6">Database not configured. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.</div>;
  }
  const sp = await searchParams;

  const { data, error } = await admin.from('alberts_buy_universe').select('*').limit(2000);
  if (error) {
    return <div className="p-6 text-red-700">DB error: {error.message}</div>;
  }

  const all: Row[] = (data ?? []) as Row[];
  const vFilter = sp?.v;
  const dFilter = sp?.d ? sp.d.toUpperCase() : undefined;
  let rows = all;
  if (vFilter) rows = rows.filter((r) => r.vendor === vFilter);
  if (dFilter) rows = rows.filter((r) => r.buy_decision === dFilter);

  rows = [...rows].sort((a, b) => {
    const da = decisionOrder[a.buy_decision] ?? 9;
    const db = decisionOrder[b.buy_decision] ?? 9;
    if (da !== db) return da - db;
    return (b.units_30d ?? 0) - (a.units_30d ?? 0);
  });

  const counts: Record<string, number> = { BUY: 0, REVIEW: 0, SKIP: 0 };
  for (const r of all) counts[r.buy_decision] = (counts[r.buy_decision] ?? 0) + 1;
  const proposedCount = all.filter((r) => r.rop_source === 'proposed').length;

  return (
    <div className="px-6 py-8 max-w-7xl mx-auto">
      <div className="flex items-baseline justify-between mb-1">
        <h1 className="text-2xl font-semibold tracking-tight">Albert&apos;s Buy Universe</h1>
        <p className="text-sm text-zinc-500">
          {rows.length} of {all.length} SKUs
        </p>
      </div>
      <p className="text-sm text-zinc-500 mb-4">
        All active Albert&apos;s + UNFI Chesterfield SKUs. Buy decision compares on-hand to the reorder point
        (explicit from Thrive, or a 90-day-velocity proposal where none is set). Velocity = 30-day net units.
        {' '}{proposedCount} rows use a proposed reorder point.
      </p>

      <div className="flex flex-wrap gap-2 mb-4 text-xs">
        <span className="px-2 py-1 rounded bg-emerald-100 text-emerald-800">BUY {counts.BUY ?? 0}</span>
        <span className="px-2 py-1 rounded bg-amber-100 text-amber-800">REVIEW {counts.REVIEW ?? 0}</span>
        <span className="px-2 py-1 rounded bg-zinc-100 text-zinc-600">SKIP {counts.SKIP ?? 0}</span>
      </div>

      <div className="border border-zinc-200 bg-white rounded-md overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-3 py-2.5">SKU</th>
              <th className="px-3 py-2.5">Item</th>
              <th className="px-3 py-2.5">Vendor</th>
              <th className="px-3 py-2.5">Dept</th>
              <th className="px-3 py-2.5 text-right">Pack</th>
              <th className="px-3 py-2.5 text-right">On hand</th>
              <th className="px-3 py-2.5 text-right">Reorder pt</th>
              <th className="px-3 py-2.5 text-right">30d</th>
              <th className="px-3 py-2.5 text-right">DoS</th>
              <th className="px-3 py-2.5 text-right">Suggest</th>
              <th className="px-3 py-2.5">Decision</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {rows.map((r) => (
              <tr key={r.thrive_variant_id} className="hover:bg-zinc-50">
                <td className="px-3 py-2 font-mono text-xs">{r.sku ?? '—'}</td>
                <td className="px-3 py-2">{r.item_name ?? '—'}</td>
                <td className="px-3 py-2 text-xs">{r.vendor}</td>
                <td className="px-3 py-2 text-xs text-zinc-500">{r.department ?? '—'}</td>
                <td className="px-3 py-2 text-right text-xs">{num(r.units_per_case)}</td>
                <td className="px-3 py-2 text-right font-mono">{num(r.on_hand, 2)}</td>
                <td className="px-3 py-2 text-right font-mono">
                  {num(r.effective_reorder_point)}
                  {r.rop_source === 'proposed' && (
                    <span className="ml-1 text-[10px] uppercase tracking-wide text-amber-700">prop</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right">{num(r.units_30d, 1)}</td>
                <td className="px-3 py-2 text-right">{r.days_of_supply == null ? '—' : num(r.days_of_supply, 1)}</td>
                <td className="px-3 py-2 text-right font-semibold">
                  {r.buy_decision === 'BUY' ? num(r.suggested_units) : '—'}
                </td>
                <td className="px-3 py-2">
                  <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${decisionBadge(r.buy_decision)}`}>
                    {r.buy_decision}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

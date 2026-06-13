// /orders/next-produce — proposed produce order if Clark hit "go" right now.
//
// Reads from thrive_inventory_latest + thrive_sales_history (30d) +
// thrive_product_catalog. Vendor schedule from produce_vendors (with
// hardcoded fallback). See /vendors/produce for vendor management.
import { evaluateNextProduceOrder, type NextOrderRow } from '@/lib/next-order';
import { createClient } from '@/lib/supabase/server';
import { Card, CardContent } from '@/components/ui/card';

export const dynamic = 'force-dynamic';

function urgencyColor(dos: number | null): { dot: string; label: string } {
  if (dos == null) return { dot: '#6b7280', label: 'no signal' };
  if (dos < 1) return { dot: '#b06060', label: 'critical' };
  if (dos < 3) return { dot: '#c4923a', label: 'soon' };
  if (dos < 7) return { dot: '#7aaa62', label: 'ok' };
  return { dot: '#6b7280', label: 'plenty' };
}

function num(v: number | null | undefined, digits = 1): string {
  if (v == null || !isFinite(v)) return '—';
  return v.toFixed(digits);
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso + 'T12:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function Flag({ flag }: { flag: string }) {
  const colors: Record<string, { bg: string; fg: string; label: string }> = {
    no_inventory:            { bg: 'rgba(176,96,96,0.15)', fg: '#b06060', label: 'no inv' },
    negative_on_hand:        { bg: 'rgba(176,96,96,0.25)', fg: '#b06060', label: 'neg OH' },
    low_velocity_signal:     { bg: 'rgba(196,146,58,0.12)', fg: '#c4923a', label: 'low data' },
    no_vendor_mapping:       { bg: 'rgba(176,96,96,0.12)', fg: '#b06060', label: 'no vendor' },
    vendor_mapping_fallback: { bg: 'rgba(196,146,58,0.12)', fg: '#c4923a', label: 'vendor?' },
  };
  const c = colors[flag] ?? { bg: 'rgba(255,255,255,0.06)', fg: 'var(--text-muted)', label: flag };
  return (
    <span className="inline-block rounded px-1.5 py-0.5 text-[9px] uppercase tracking-widest"
      style={{ background: c.bg, color: c.fg, fontFamily: 'var(--font-josefin)' }}>
      {c.label}
    </span>
  );
}

function Row({ r, idx }: { r: NextOrderRow; idx: number }) {
  const u = urgencyColor(r.days_of_supply);
  return (
    <tr style={{ borderBottom: '1px solid var(--forest-mid)' }}>
      <td className="px-3 py-2 align-top" style={{ color: 'var(--text-muted)' }}>{idx + 1}</td>
      <td className="px-3 py-2 align-top">
        <div className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full flex-shrink-0" style={{ background: u.dot }} />
          <div>
            <div className="font-medium" style={{ color: 'var(--cream)' }}>{r.name}</div>
            {r.sku ? <div className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>{r.sku}</div> : null}
          </div>
        </div>
      </td>
      <td className="px-3 py-2 text-right align-top" style={{ color: 'var(--cream)' }}>{num(r.current_on_hand, 1)}</td>
      <td className="px-3 py-2 text-right align-top" style={{ color: 'var(--sage)' }}>{num(r.velocity_per_week, 1)}</td>
      <td className="px-3 py-2 text-right align-top" style={{ color: u.dot }}>{num(r.days_of_supply, 1)}</td>
      <td className="px-3 py-2 text-right align-top" style={{ color: 'var(--cream)' }}>
        {r.next_truck_date ? formatDate(r.next_truck_date) : '—'}
        {r.vendor_name ? <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{r.vendor_name}</div> : null}
      </td>
      <td className="px-3 py-2 text-right align-top">
        {r.suggested_cases > 0 ? (
          <span className="font-semibold" style={{ color: 'var(--gold)' }}>{r.suggested_cases} cs</span>
        ) : (
          <span style={{ color: 'var(--text-muted)' }}>—</span>
        )}
        {r.suggested_units > 0 ? (
          <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{num(r.suggested_units, 1)} u</div>
        ) : null}
      </td>
      <td className="px-3 py-2 text-right align-top" style={{ color: 'var(--sage)' }}>{r.confidence.toFixed(2)}</td>
      <td className="px-3 py-2 align-top">
        <div className="flex flex-wrap gap-1">{r.flags.map((f) => <Flag key={f} flag={f} />)}</div>
      </td>
    </tr>
  );
}

export default async function NextProduceOrderPage({ searchParams }: { searchParams: Promise<{ filter?: string; sort?: string }> }) {
  const supabase = await createClient();
  const user = supabase ? (await supabase.auth.getUser()).data.user : null;
  if (!user) {
    return <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Sign in to view.</p>;
  }

  const params = await searchParams;
  const filter = params.filter ?? 'all';
  const evaluation = await evaluateNextProduceOrder();

  let rows = evaluation.rows;
  if (filter === 'critical') rows = rows.filter((r) => r.days_of_supply != null && r.days_of_supply < 3);
  if (filter === 'order') rows = rows.filter((r) => r.suggested_cases > 0);
  if (filter === 'flagged') rows = rows.filter((r) => r.flags.length > 0);

  const totals = {
    items: evaluation.rows.length,
    critical: evaluation.rows.filter((r) => r.days_of_supply != null && r.days_of_supply < 1).length,
    soon: evaluation.rows.filter((r) => r.days_of_supply != null && r.days_of_supply >= 1 && r.days_of_supply < 3).length,
    toOrder: evaluation.rows.filter((r) => r.suggested_cases > 0).length,
    suggestedDollars: evaluation.rows.reduce((s, r) => s + (r.suggested_cases > 0 ? (r.suggested_price_dollars ?? 0) * (r.units_per_case ?? 1) * r.suggested_cases : 0), 0),
  };

  return (
    <div className="space-y-6 max-w-7xl">
      <div>
        <h1 className="text-2xl font-bold uppercase tracking-wider" style={{ fontFamily: 'var(--font-josefin)', color: 'var(--gold)' }}>
          Next Produce Order
        </h1>
        <p className="mt-0.5 text-sm" style={{ color: 'var(--sage)' }}>
          What the matcher would order if you hit "go" right now. Inventory snapshot: {evaluation.inventory_snapshot_ts ? new Date(evaluation.inventory_snapshot_ts).toLocaleString('en-US', { timeZone: 'America/New_York' }) : '—'}.
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid gap-3 sm:grid-cols-4">
        {[
          { label: 'Items',    value: totals.items,     color: 'var(--cream)' },
          { label: 'Critical', value: totals.critical,  color: '#b06060' },
          { label: 'Order soon', value: totals.soon,    color: '#c4923a' },
          { label: 'To order', value: totals.toOrder,   color: 'var(--gold)' },
        ].map((c) => (
          <Card key={c.label}>
            <CardContent className="p-4">
              <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-josefin)' }}>{c.label}</p>
              <p className="mt-1 text-2xl font-bold" style={{ color: c.color, fontFamily: 'var(--font-josefin)' }}>{c.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filter chips */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-josefin)' }}>Show</span>
        {[
          { value: 'all',      label: 'All' },
          { value: 'critical', label: 'Critical' },
          { value: 'order',    label: 'To Order' },
          { value: 'flagged',  label: 'Flagged' },
        ].map((f) => (
          <a
            key={f.value}
            href={`?filter=${f.value}`}
            className="rounded px-3 py-1 text-[10px] font-bold uppercase tracking-widest transition-all"
            style={{
              background: filter === f.value ? 'var(--gold)' : 'var(--forest-mid)',
              color: filter === f.value ? 'var(--forest-darkest)' : 'var(--sage)',
              fontFamily: 'var(--font-josefin)',
            }}
          >
            {f.label}
          </a>
        ))}
        <span className="ml-auto text-xs" style={{ color: 'var(--text-muted)' }}>
          {rows.length} of {evaluation.rows.length}
        </span>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto" style={{ maxHeight: '70vh' }}>
            <table className="w-full text-xs">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--forest-mid)' }}>
                  {['#','Item','On Hand','Wkly Vel','Days','Truck','Suggest','Conf','Flags'].map((h) => (
                    <th key={h} className="sticky top-0 px-3 py-3 text-left font-bold uppercase tracking-widest"
                      style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-josefin)', fontSize: '10px', background: 'var(--forest)' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={9} className="px-3 py-8 text-center" style={{ color: 'var(--text-muted)' }}>No items match this filter.</td></tr>
                ) : rows.map((r, i) => <Row key={r.thrive_item_id} r={r} idx={i} />)}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <p className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-josefin)' }}>
        Evaluated at {new Date(evaluation.evaluated_at).toLocaleString('en-US', { timeZone: 'America/New_York' })}.
        Vendor schedule: <a href="/vendors/produce" style={{ color: 'var(--gold)' }}>manage</a>.
      </p>
    </div>
  );
}

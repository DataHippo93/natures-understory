// /inventory/stock-take/print — print-first stocktake sheet, scoped by
// vendor and activity window. Designed for the pre-order walk (e.g.
// Sunday-morning Albert's stocktake before the Monday cron).
//
// URL params:
//   category=Produce       (default)
//   vendor=alberts         (optional: 'alberts' -> Albert's + UNFI;
//                           any other -> ilike match on produce_vendors)
//   active_days=60         (optional: hide dead stock; only show items
//                           that moved in the last N days)
//   limit=200              (default 200, max 500)

import { generateStockTake, type StockTakeRow } from '@/lib/stock-take';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const VENDOR_SLUG_MAP: Record<string, { ids: string[]; label: string }> = {
  alberts: {
    ids: ['2257570029409417467', '2233107668598536406'],
    label: "Albert's (incl. UNFI Chesterfield)",
  },
};

async function resolveVendor(slug: string | null): Promise<{ ids: string[] | undefined; label: string }> {
  if (!slug) return { ids: undefined, label: 'All vendors' };
  if (VENDOR_SLUG_MAP[slug]) return VENDOR_SLUG_MAP[slug];
  const admin = createAdminClient();
  if (!admin) return { ids: undefined, label: slug };
  const { data } = await admin
    .from('produce_vendors')
    .select('thrive_vendor_id, display_name')
    .ilike('display_name', `%${slug}%`)
    .limit(5);
  const rows = (data ?? []) as Array<{ thrive_vendor_id?: string | null; display_name: string }>;
  const ids = rows.map((r) => r.thrive_vendor_id).filter((v): v is string => Boolean(v));
  const label = rows.map((r) => r.display_name).join(' / ') || slug;
  return { ids: ids.length > 0 ? ids : undefined, label };
}

function fmt(v: number | null | undefined, digits = 1): string {
  if (v == null || !isFinite(v)) return '—';
  return v.toFixed(digits);
}

function fmtDate(iso: string | null): string {
  if (!iso) return 'never';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
}

function mustCount(r: StockTakeRow, recentSold30d: number | null): boolean {
  if (r.reported_on_hand != null && r.reported_on_hand < 0) return true;
  if (recentSold30d != null && recentSold30d > 0 && r.reported_on_hand != null) {
    const velPerDay = recentSold30d / 30;
    if (velPerDay > 0 && r.reported_on_hand / velPerDay < 2) return true;
  }
  return false;
}

export default async function PrintPage({ searchParams }: { searchParams: Promise<{ category?: string; vendor?: string; active_days?: string; limit?: string }> }) {
  const supabase = await createClient();
  const user = supabase ? (await supabase.auth.getUser()).data.user : null;
  if (!user) {
    return <p style={{ padding: '2rem', color: '#1c1d17' }}>Sign in to view.</p>;
  }
  const params = await searchParams;
  const category = params.category ?? 'Produce';
  const vendorSlug = params.vendor ?? null;
  const activeDays = Math.min(180, Math.max(0, parseInt(params.active_days ?? '60', 10) || 0));
  const limit = Math.min(500, Math.max(10, parseInt(params.limit ?? '200', 10) || 200));

  const vendor = await resolveVendor(vendorSlug);

  const result = await generateStockTake({
    category,
    limit,
    vendorIds: vendor.ids,
    activeWindowDays: activeDays || undefined,
  });

  // For each row, compute "30d sold" — we already have drift_units; but
  // to surface velocity for the operator, do one extra rpcQuery here.
  const itemIds = result.rows.map((r) => r.thrive_item_id);
  const sold30d = new Map<string, number>();
  if (itemIds.length > 0) {
    const admin = createAdminClient();
    if (admin) {
      const inList = itemIds.map((id) => `'${id.replace(/'/g, "''")}'`).join(',');
      const sql = `SELECT item_id, SUM(units)::numeric AS u
                   FROM thrive_sales_history
                   WHERE item_id IN (${inList})
                     AND sale_date >= CURRENT_DATE - INTERVAL '30 days'
                   GROUP BY item_id`;
      const { data } = await admin.rpc('run_report_query', { query: sql });
      for (const r of ((data ?? []) as Array<{ item_id: string; u: number | string }>)) {
        sold30d.set(r.item_id, Number(r.u ?? 0));
      }
    }
  }

  // Resort: must-count first, then alphabetical
  type Aug = StockTakeRow & { _u30: number; _must: boolean };
  const augmented: Aug[] = result.rows.map((r) => {
    const u30 = sold30d.get(r.thrive_item_id) ?? 0;
    return { ...r, _u30: u30, _must: mustCount(r, u30) };
  });
  augmented.sort((a, b) => {
    if (a._must !== b._must) return a._must ? -1 : 1;
    return (a.name || '').localeCompare(b.name || '');
  });

  const printDate = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' });

  return (
    <>
      <style>{`
        @page { size: letter landscape; margin: 0.35in; }
        @media print {
          body { background: white !important; color: black !important; }
          .no-print { display: none !important; }
        }
        body, .print-paper { background: white; color: black; }
        .print-paper *, .print-paper { color: black !important; }
        table { width: 100%; border-collapse: collapse; font-size: 11px; }
        th { background: #1c1d17; color: white !important; text-align: left; padding: 4px 6px;
             font-size: 9px; text-transform: uppercase; letter-spacing: 0.08em; }
        td { padding: 6px 6px; border-bottom: 1px solid #c8c4b8; vertical-align: middle; }
        tr.must td { background: #fce7c4; }
        tr.must td:first-child::before { content: "★ "; color: #c4923a; }
        .handwrite { border-bottom: 1px solid #555; min-height: 16px; display: block; min-width: 80px; }
      `}</style>

      <div className="print-paper" style={{ padding: '0.25in', maxWidth: '11in', margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', borderBottom: '2px solid #1c1d17', paddingBottom: '6px', marginBottom: '10px' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: '16px', textTransform: 'uppercase', letterSpacing: '0.12em', fontWeight: 800 }}>
              Stock-Take — {category} ({vendor.label})
            </h1>
            <p style={{ margin: '2px 0 0', fontSize: '10px', color: '#3a3729' }}>
              {printDate} · {result.rows.length} items{activeDays ? ` · ${activeDays}d-active filter` : ''} · Counted by: __________________
            </p>
          </div>
          <p className="no-print" style={{ fontSize: '10px', color: '#7a7563' }}>
            <a href="?vendor=alberts&active_days=60">Albert's 60d</a> · <a href="?active_days=60">All vendors 60d</a> · <a href="?active_days=0">All including dead stock</a> · Print: Ctrl/⌘+P
          </p>
        </div>

        <table>
          <thead>
            <tr>
              <th style={{ width: '32px' }}>#</th>
              <th style={{ width: '70px' }}>SKU</th>
              <th>Item</th>
              <th style={{ width: '80px' }}>Pack</th>
              <th style={{ width: '50px', textAlign: 'right' }}>Rep.</th>
              <th style={{ width: '60px' }}>Last Cnt</th>
              <th style={{ width: '50px', textAlign: 'right' }}>30d</th>
              <th style={{ width: '50px', textAlign: 'right' }}>60d</th>
              <th style={{ width: '90px' }}>Counted</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {augmented.length === 0 ? (
              <tr><td colSpan={10} style={{ padding: '20px', textAlign: 'center', color: '#7a7563' }}>No items match — try ?vendor=alberts or change active_days.</td></tr>
            ) : augmented.map((r, i) => (
              <tr key={r.thrive_item_id} className={r._must ? 'must' : ''}>
                <td>{i + 1}</td>
                <td style={{ fontFamily: 'monospace', fontSize: '10px' }}>{r.sku ?? ''}</td>
                <td><strong>{r.name}</strong></td>
                <td>{r.units_per_case ? `${r.units_per_case} ${r.units_per_case === 1 ? 'each' : 'pack'}` : '—'}</td>
                <td style={{ textAlign: 'right' }}>{fmt(r.reported_on_hand)}</td>
                <td>{fmtDate(r.last_counted_at)}</td>
                <td style={{ textAlign: 'right' }}>{r._u30.toFixed(1)}</td>
                <td style={{ textAlign: 'right' }}>{r.drift_units != null ? '—' : '—'}</td>
                <td><span className="handwrite" /></td>
                <td><span className="handwrite" /></td>
              </tr>
            ))}
          </tbody>
        </table>

        <p style={{ marginTop: '10px', fontSize: '9px', color: '#7a7563' }}>
          ★ must-count first (negative reported on-hand OR days-of-supply &lt; 2). Use the Counted column for actual count. Flag discrepancies in Notes. Enter counts back into Thrive after the walk.
        </p>
      </div>
    </>
  );
}

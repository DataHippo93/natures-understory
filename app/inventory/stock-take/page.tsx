// /inventory/stock-take — printable per-category count sheet.
//
// Walk the store with this on a clipboard, write counts in the blank
// boxes, hand back to enter in Thrive. Items prioritized by drift
// (reported_on_hand vs expected_on_hand from sales since last count).
import { generateStockTake, type StockTakeRow } from '@/lib/stock-take';
import { createClient } from '@/lib/supabase/server';
import { Card, CardContent } from '@/components/ui/card';

export const dynamic = 'force-dynamic';

const DEPARTMENTS = ['Produce','Local','Grocery','Bulk','Body Care','Supplements','Cafe','Uncategorized'];

function fmtDate(iso: string | null): string {
  if (!iso) return 'never';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtNum(v: number | null | undefined, digits = 1): string {
  if (v == null || !isFinite(v)) return '—';
  return v.toFixed(digits);
}

function StockTakeRowEl({ r, i }: { r: StockTakeRow; i: number }) {
  const isNegative = r.reported_on_hand != null && r.reported_on_hand < 0;
  const highDrift = r.drift_pct != null && r.drift_pct >= 0.25;
  return (
    <tr style={{ borderBottom: '1px solid #d4cfc1', breakInside: 'avoid' }}>
      <td className="px-2 py-2 align-top text-right" style={{ width: '32px', color: '#7a7563' }}>{i + 1}</td>
      <td className="px-2 py-2 align-top">
        <div style={{ fontWeight: 600, color: '#1c1d17' }}>{r.name}</div>
        <div style={{ fontSize: '10px', color: '#7a7563' }}>
          {r.sku ? <span className="font-mono">{r.sku}</span> : ''}
          {r.units_per_case ? ` · ${r.units_per_case}/cs` : ''}
          {r.department && r.department !== 'Produce' ? ` · ${r.department}` : ''}
        </div>
      </td>
      <td className="px-2 py-2 text-right align-top" style={{ width: '64px', color: isNegative ? '#b06060' : '#1c1d17' }}>
        {fmtNum(r.reported_on_hand)}{isNegative ? ' !!' : ''}
      </td>
      <td className="px-2 py-2 text-right align-top" style={{ width: '72px', color: highDrift ? '#c4923a' : '#1c1d17' }}>
        {fmtNum(r.expected_on_hand)}{highDrift ? ' !' : ''}
      </td>
      <td className="px-2 py-2 text-right align-top" style={{ width: '64px', color: '#7a7563', fontSize: '10px' }}>
        {fmtDate(r.last_counted_at)}{r.days_since_count != null && r.days_since_count > 30 ? ' ⏰' : ''}
      </td>
      <td className="px-2 py-2 align-top" style={{ width: '96px' }}>
        {/* Hand-write column */}
        <div style={{ height: '28px', borderBottom: '1px solid #999' }} />
      </td>
      <td className="px-2 py-2 align-top" style={{ width: '40px' }}>
        <input type="checkbox" disabled style={{ pointerEvents: 'none' }} />
      </td>
    </tr>
  );
}

export default async function StockTakePage({ searchParams }: { searchParams: Promise<{ category?: string; limit?: string }> }) {
  const supabase = await createClient();
  const user = supabase ? (await supabase.auth.getUser()).data.user : null;
  if (!user) {
    return <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Sign in to view.</p>;
  }

  const params = await searchParams;
  const category = params.category ?? 'Produce';
  const limit = Math.min(200, Math.max(10, parseInt(params.limit ?? '50', 10) || 50));

  const result = await generateStockTake({ category, limit });
  const printDate = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' });

  return (
    <>
      {/* Print stylesheet */}
      <style>{`
        @media print {
          @page { margin: 0.5in; }
          body { background: white !important; color: black !important; }
          .no-print { display: none !important; }
          .print-only { display: block !important; }
          .print-paper {
            background: white !important;
            color: black !important;
            margin: 0 !important;
            padding: 0 !important;
            max-width: none !important;
          }
          .print-paper * { color: black !important; }
        }
        .print-only { display: none; }
      `}</style>

      <div className="space-y-4 max-w-4xl">
        {/* Screen-only header */}
        <div className="no-print">
          <h1 className="text-2xl font-bold uppercase tracking-wider" style={{ fontFamily: 'var(--font-josefin)', color: 'var(--gold)' }}>
            Stock Take
          </h1>
          <p className="mt-0.5 text-sm" style={{ color: 'var(--sage)' }}>
            Printable count list for the store walkthrough. {result.total_candidates} items in {category}, showing top {result.rows.length} by drift priority.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-josefin)' }}>Department</span>
            {DEPARTMENTS.map((d) => (
              <a key={d} href={`?category=${encodeURIComponent(d)}&limit=${limit}`}
                className="rounded px-3 py-1 text-[10px] font-bold uppercase tracking-widest transition-all"
                style={{
                  background: category === d ? 'var(--gold)' : 'var(--forest-mid)',
                  color: category === d ? 'var(--forest-darkest)' : 'var(--sage)',
                  fontFamily: 'var(--font-josefin)',
                }}>
                {d}
              </a>
            ))}
            <span className="ml-auto rounded px-3 py-1 text-[10px] font-bold uppercase tracking-widest" style={{ background: 'var(--forest-mid)', color: 'var(--sage)', fontFamily: 'var(--font-josefin)' }}>
              Print: Ctrl/Cmd + P
            </span>
          </div>
        </div>

        {/* The printable sheet */}
        <Card className="print-paper">
          <CardContent className="p-4" style={{ background: 'white', color: 'black' }}>
            <div className="flex items-center justify-between border-b pb-2 mb-3" style={{ borderColor: '#1c1d17' }}>
              <div>
                <h2 style={{ fontSize: '14px', fontWeight: 800, letterSpacing: '0.15em', textTransform: 'uppercase', color: 'black' }}>
                  Stock Take — {category}
                </h2>
                <p style={{ fontSize: '10px', color: '#3a3729' }}>
                  {printDate} · Counted by: _______________
                </p>
              </div>
              <p style={{ fontSize: '10px', color: '#7a7563', textAlign: 'right' }}>
                {result.rows.length} items, sorted by drift priority
              </p>
            </div>

            <table className="w-full" style={{ fontSize: '11px', color: 'black' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #1c1d17', textAlign: 'left' }}>
                  <th className="px-2 py-1" style={{ color: 'black', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.1em' }}>#</th>
                  <th className="px-2 py-1" style={{ color: 'black', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Item</th>
                  <th className="px-2 py-1 text-right" style={{ color: 'black', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Reported</th>
                  <th className="px-2 py-1 text-right" style={{ color: 'black', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Expected</th>
                  <th className="px-2 py-1 text-right" style={{ color: 'black', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Last Cnt</th>
                  <th className="px-2 py-1" style={{ color: 'black', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Counted</th>
                  <th className="px-2 py-1" style={{ color: 'black', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.1em' }}>✓</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.length === 0
                  ? <tr><td colSpan={7} className="px-2 py-4 text-center" style={{ color: '#7a7563' }}>No items match — check the department filter.</td></tr>
                  : result.rows.map((r, i) => <StockTakeRowEl key={r.thrive_item_id} r={r} i={i} />)
                }
              </tbody>
            </table>

            <div className="mt-4 pt-2 border-t" style={{ borderColor: '#7a7563', fontSize: '10px', color: '#3a3729' }}>
              <p><strong>Legend:</strong>  <code>!</code> drift &gt; 25%  ·  <code>!!</code> reported negative  ·  <code>⏰</code> last counted &gt; 30 days ago</p>
              <p style={{ marginTop: '4px' }}>For each row that doesn't match, write the actual count + your initials. Hand sheet to Clark or enter directly in Thrive.</p>
            </div>
          </CardContent>
        </Card>

        <p className="no-print text-[10px] uppercase tracking-widest" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-josefin)' }}>
          Generated {new Date(result.generated_at).toLocaleString('en-US', { timeZone: 'America/New_York' })}.
        </p>
      </div>
    </>
  );
}

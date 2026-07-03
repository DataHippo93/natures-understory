import type React from 'react';
import { Page } from '@/components/ui/page';
import { createClient } from '@/lib/supabase/server';
import { getProducePricing, type ProducePrice } from '@/lib/thrive';
import type { CostSource } from '@/lib/inventory-cost';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

export const dynamic = 'force-dynamic';

const recColor: Record<string, string> = { raise: '#7aaa62', lower: '#c4923a', hold: 'var(--text-muted)' };
const confBadge: Record<string, { bg: string; fg: string }> = {
  high: { bg: 'rgba(122,170,98,0.15)', fg: '#7aaa62' },
  medium: { bg: 'rgba(196,146,58,0.15)', fg: '#c4923a' },
  low: { bg: 'rgba(107,107,107,0.15)', fg: 'var(--text-muted)' },
};

function money(n: number) { return `$${n.toFixed(2)}`; }

function costShort(s: CostSource): string {
  switch (s) { case 'last_receipt': return 'fresh'; case 'default': return 'stale'; case 'missing': return 'n/a'; }
}
function costTitle(s: CostSource): string {
  switch (s) {
    case 'last_receipt': return 'Cost from most recent inventory lot (Thrive)';
    case 'default':      return 'Cost from catalog default — may be out of date';
    case 'missing':      return 'No cost on file in Thrive';
  }
}
function costChipStyle(s: CostSource): React.CSSProperties {
  switch (s) {
    case 'last_receipt': return { background: 'rgba(122,170,98,0.18)', color: '#7aaa62', fontFamily: 'var(--font-josefin)' };
    case 'default':      return { background: 'rgba(196,146,58,0.20)', color: '#c4923a', fontFamily: 'var(--font-josefin)' };
    case 'missing':      return { background: 'rgba(176,96,96,0.20)', color: '#d96b6b', fontFamily: 'var(--font-josefin)' };
  }
}

export default async function ProducePricingPage({
  searchParams,
}: { searchParams: Promise<{ rec?: string; conf?: string }> }) {
  const params = await searchParams;
  const supabase = await createClient();
  const user = supabase ? (await supabase.auth.getUser()).data.user : null;

  let rows: ProducePrice[] = [];
  let error: string | null = null;
  if (user) {
    try { rows = await getProducePricing(); }
    catch (e) { error = e instanceof Error ? e.message : String(e); }
  }

  const recFilter = params.rec ?? null;
  const confFilter = params.conf ?? null;
  const shown = rows.filter((r) =>
    (!recFilter || r.recommendation === recFilter) &&
    (!confFilter || r.confidence === confFilter));

  const moves = rows.filter((r) => r.recommendation !== 'hold');
  const highConf = rows.filter((r) => r.confidence === 'high');
  const underwater = rows.filter((r) => r.currentMargin < 0).length;
  const projGain = rows.reduce((s, r) =>
    s + (r.recommendation !== 'hold' ? (r.optimalPrice - r.nowPrice) * r.totalUnits90d / 3 : 0), 0);

  return (
    <Page>
      <div>
        <h1 className="text-2xl font-bold uppercase tracking-wider" style={{ fontFamily: 'var(--font-josefin)', color: 'var(--gold)' }}>
          Produce Price Analysis
        </h1>
        <p className="mt-0.5 text-sm" style={{ color: 'var(--sage)' }}>
          Price-elasticity model over historical sales. Each item&apos;s own-price elasticity is fit from daily
          price/volume when there&apos;s enough variation, else a produce benchmark (−1.0). Optimal price maximizes
          margin under constant-elasticity demand, capped at ±15% per step. Treat as a starting point — verify in store.
        </p>
      </div>

      {error && (
        <div className="rounded-lg px-4 py-3" style={{ background: 'rgba(176,96,96,0.10)', border: '1px solid rgba(176,96,96,0.35)' }}>
          <p className="text-sm font-bold" style={{ color: '#d96b6b', fontFamily: 'var(--font-josefin)' }}>Analysis couldn&apos;t load</p>
          <p className="mt-0.5 text-xs font-mono break-words" style={{ color: 'var(--text-muted)' }}>{error}</p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-4">
        {[
          { label: 'Items Modeled', val: String(rows.length), color: 'var(--cream)' },
          { label: 'Suggested Moves', val: String(moves.length), color: '#c4923a' },
          { label: 'High Confidence', val: String(highConf.length), color: '#7aaa62' },
          { label: 'Selling Below Cost', val: String(underwater), color: '#d96b6b' },
        ].map((c) => (
          <div key={c.label} className="rounded-lg p-4" style={{ background: 'var(--forest)', border: '1px solid var(--forest-mid)' }}>
            <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-josefin)' }}>{c.label}</p>
            <p className="mt-1 text-2xl font-bold" style={{ color: c.color, fontFamily: 'var(--font-josefin)' }}>{c.val}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-josefin)' }}>Filter</span>
        {[
          { label: 'All', q: '' },
          { label: 'Raise', q: '?rec=raise' },
          { label: 'Lower', q: '?rec=lower' },
          { label: 'High conf', q: '?conf=high' },
          { label: 'Below cost', q: '?rec=raise&conf=low' },
        ].map((f) => (
          <a key={f.label} href={`/reports/pricing${f.q}`} className="rounded px-2.5 py-1 text-xs font-semibold"
             style={{ background: 'var(--forest-mid)', color: 'var(--sage)', fontFamily: 'var(--font-josefin)' }}>
            {f.label}
          </a>
        ))}
      </div>

      <div className="rounded-lg px-3 py-2 text-[11px]"
           style={{ background: 'var(--forest)', border: '1px solid var(--forest-mid)', color: 'var(--text-muted)' }}>
        <span style={{ color: 'var(--sage)', fontWeight: 600 }}>Cost source</span>
        : <span style={{ color: '#7aaa62' }}>fresh</span> = last receipt (Thrive inventory),
        <span style={{ color: '#c4923a' }}> stale</span> = catalog default (may be out of date — Albert&apos;s pricelist pipeline pending),
        <span style={{ color: '#d96b6b' }}> n/a</span> = no cost in Thrive. Now price is live Thrive catalog retail; suggested prices snap to $0.05.
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recommendations ({shown.length})</CardTitle>
          <CardDescription>Sorted by suggested move size. &quot;Reg&quot; = elasticity fit from this item&apos;s data; &quot;Bm&quot; = produce benchmark.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto" style={{ maxHeight: 640, overflowY: 'auto' }}>
            <table className="w-full text-xs">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--forest-mid)' }}>
                  {['Item', 'Now', 'Cost', 'Src', 'Margin', 'Elast.', 'Suggested', 'New Margin', 'Δ Units', 'Δ Profit', 'Move', 'Conf'].map((h) => (
                    <th key={h} className="px-3 py-3 text-left font-bold uppercase tracking-widest sticky top-0"
                        style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-josefin)', fontSize: '10px', background: 'var(--forest)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((r, i) => (
                  <tr key={r.variantId} style={{ borderBottom: i < shown.length - 1 ? '1px solid var(--forest-mid)' : undefined }}>
                    <td className="px-3 py-2.5 font-medium" style={{ color: 'var(--cream)' }}>
                      {r.itemName} <span style={{ color: 'var(--text-muted)' }}>/{r.unit}</span>
                      <span className="block text-[10px]" style={{ color: 'var(--text-muted)' }} title={r.rationale}>{r.rationale.slice(0, 70)}</span>
                    </td>
                    <td className="px-3 py-2.5" style={{ color: 'var(--sage)' }} title="Live Thrive catalog retail">{money(r.nowPrice)}</td>
                    <td className="px-3 py-2.5" style={{ color: 'var(--text-muted)' }} title={costTitle(r.costSource)}>{r.cost > 0 ? money(r.cost) : '—'}</td>
                    <td className="px-3 py-2.5">
                      <span
                        className="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest"
                        title={costTitle(r.costSource)}
                        style={costChipStyle(r.costSource)}
                      >
                        {costShort(r.costSource)}
                      </span>
                    </td>
                    <td className="px-3 py-2.5" style={{ color: r.currentMargin < 15 ? '#b06060' : 'var(--sage)' }}>{r.currentMargin.toFixed(0)}%</td>
                    <td className="px-3 py-2.5" style={{ color: 'var(--sage)' }}>{r.elasticity.toFixed(2)}<span className="text-[10px]" style={{ color: 'var(--text-muted)' }}> {r.elasticitySource === 'regression' ? 'Reg' : 'Bm'}</span></td>
                    <td className="px-3 py-2.5 font-semibold" style={{ color: '#c4923a' }}>{money(r.optimalPrice)}</td>
                    <td className="px-3 py-2.5" style={{ color: 'var(--sage)' }}>{r.optimalMargin.toFixed(0)}%</td>
                    <td className="px-3 py-2.5" style={{ color: 'var(--text-muted)' }}>{r.estUnitChangePct > 0 ? '+' : ''}{r.estUnitChangePct.toFixed(0)}%</td>
                    <td className="px-3 py-2.5" style={{ color: r.estProfitChangePct >= 0 ? '#7aaa62' : '#b06060' }}>{r.estProfitChangePct > 0 ? '+' : ''}{r.estProfitChangePct.toFixed(0)}%</td>
                    <td className="px-3 py-2.5 font-bold uppercase" style={{ color: recColor[r.recommendation] }}>{r.recommendation}</td>
                    <td className="px-3 py-2.5">
                      <span className="rounded px-2 py-0.5 text-[10px] font-bold uppercase" style={{ background: confBadge[r.confidence].bg, color: confBadge[r.confidence].fg }}>{r.confidence}</span>
                    </td>
                  </tr>
                ))}
                {shown.length === 0 && (
                  <tr><td colSpan={12} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
                    {rows.length === 0 ? 'No model output yet — the weekly pricing job hasn’t run.' : 'No items match this filter.'}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </Page>
  );
}

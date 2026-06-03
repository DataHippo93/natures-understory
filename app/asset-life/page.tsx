// app/asset-life/page.tsx
// Asset-Life analytics: compare SKU launches at equal lifecycle stage (first 30 days)
// and report on Klaviyo flow head-to-heads (Welcome A/B, 4 concurrent AC flows).
// Added 2026-06-03 as part of the asset-life analytics workstream.

import { KPICard } from '@/components/kpi-card';
import { createClient } from '@/lib/supabase/server';

export const revalidate = 3600; // refresh hourly

type SkuLaunch = {
  variant_id: string;
  name: string | null;
  department: string | null;
  first_sale_date: string;
  rev_d1_30: number;
  rev_d31_60: number;
  rev_d61_90: number;
  prof_d1_30: number;
};

// --- static Klaviyo asset-life snapshot (2026-06-03 run) ---
// These flows pre-date a Klaviyo sync; values come from the Klaviyo private API
// pull dated 2026-06-03. Refresh by re-running scripts/pull_klaviyo_assetlife.ps1
// from the asset-life-analytics workstream and re-deploying.
const WELCOME_FLOWS = [
  {
    flow_id: 'S564sR',
    name: 'Welcome Series - Customer v. Non-Customer (Email)',
    recipients: 15938, revenue: 26950.6, rpr: 1.6910,
    open_rate: 0.479, click_rate: 0.050, conv_rate: 0.029,
    verdict: 'keep' as const, verdictLabel: 'Keep - primary',
  },
  {
    flow_id: 'Wi2S9b',
    name: 'Welcome Series - Customer v. Non-Customer (Email2)',
    recipients: 0, revenue: 0, rpr: 0,
    open_rate: 0, click_rate: 0, conv_rate: 0,
    verdict: 'kill' as const, verdictLabel: 'KILL - 0 traffic in 12mo',
  },
];

const AC_FLOWS = [
  {
    flow_id: 'R86d3J', name: 'K - Abandoned Cart (Buyers) - Shopify',
    recipients: 1995, revenue: 6175.02, rpr: 3.0952,
    open_rate: 0.434, click_rate: 0.097, conv_rate: 0.041,
    verdict: 'keep' as const, verdictLabel: 'Best of 4',
  },
  {
    flow_id: 'XgJy9d', name: 'K - Abandoned Checkout (Buyers) - Shopify',
    recipients: 1596, revenue: 4392.01, rpr: 2.7519,
    open_rate: 0.473, click_rate: 0.088, conv_rate: 0.046,
    verdict: 'keep' as const, verdictLabel: 'Strong #2',
  },
  {
    flow_id: 'RhVXLS', name: 'K - Abandoned Cart (Non Buyers) - Shopify',
    recipients: 1925, revenue: 2620.15, rpr: 1.3611,
    open_rate: 0.412, click_rate: 0.055, conv_rate: 0.019,
    verdict: 'trim' as const, verdictLabel: 'Trim or merge',
  },
  {
    flow_id: 'RFA8J7', name: 'K - Abandoned Checkout (Non Buyers) Shopify',
    recipients: 8693, revenue: 7880.72, rpr: 0.9066,
    open_rate: 0.311, click_rate: 0.042, conv_rate: 0.017,
    verdict: 'kill' as const, verdictLabel: 'Cut Email #3; consider merge',
  },
];

const fmtMoney = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n);
const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`;
const fmtInt = (n: number) => n.toLocaleString('en-US');

function trendArrow(d30: number, d60: number) {
  if (d30 === 0) return <span style={{ color: 'var(--text-muted)' }}>-</span>;
  const pct = (100 * (d60 - d30)) / d30;
  const delta = d60 - d30;
  if (pct >= 10) {
    return (
      <span style={{ color: 'var(--good)', fontWeight: 600 }}>
        &uarr; +{pct.toFixed(0)}% ({fmtMoney(delta)})
      </span>
    );
  }
  if (pct <= -10) {
    return (
      <span style={{ color: 'var(--bad)', fontWeight: 600 }}>
        &darr; {pct.toFixed(0)}% ({fmtMoney(delta)})
      </span>
    );
  }
  return (
    <span style={{ color: 'var(--text-muted)' }}>
      &rarr; {pct >= 0 ? '+' : ''}{pct.toFixed(0)}%
    </span>
  );
}

function verdictPill(v: 'keep' | 'trim' | 'kill', label: string) {
  const bg = v === 'keep' ? 'rgba(122,170,98,0.18)' :
             v === 'trim' ? 'rgba(196,146,58,0.22)' :
             'rgba(176, 96, 96, 0.22)';
  const color = v === 'keep' ? '#7aaa62' : v === 'trim' ? '#c4923a' : '#b06060';
  return (
    <span
      className="inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
      style={{ background: bg, color }}
    >
      {label}
    </span>
  );
}

async function getTopSkuLaunches(): Promise<SkuLaunch[]> {
  const supabase = await createClient();
  if (!supabase) return [];

  // Preferred path: a Postgres function we ship in supabase/migrations/003_asset_life.sql
  const { data, error } = await supabase.rpc('asset_life_top_launches', { p_limit: 10 });
  if (!error && data) return data as SkuLaunch[];

  // If the RPC isn't deployed yet, the table renders an "unavailable" notice
  // rather than running an unbounded scan from the client.
  return [];
}

export default async function AssetLifePage() {
  const skuLaunches = await getTopSkuLaunches();

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h1
          className="text-2xl font-bold uppercase tracking-wider"
          style={{ fontFamily: 'var(--font-josefin)', color: 'var(--gold)' }}
        >
          Asset Life
        </h1>
        <p className="mt-0.5 text-sm" style={{ color: 'var(--sage)' }}>
          Compare flows, campaigns, and SKUs at <em>equal lifecycle stage</em> - first 30 days, not the same calendar month.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KPICard title="Best AC flow" value="$3.10" subtitle="Cart Buyers - RPR vs $0.91 worst" status="good" />
        <KPICard title="Welcome A/B winner" value="S564sR" subtitle="$26,951 / 12mo - 47.9% open" status="good" />
        <KPICard title="Dead duplicate flow" value="Wi2S9b" subtitle="0 recipients in 12mo - kill it" status="bad" />
        <KPICard title="Slow-burn launch" value="9.0x" subtitle="Winterberry 4.5oz - d61-90 vs d1-30" status="good" />
      </div>

      <div className="rounded-lg" style={{ background: 'var(--forest)', border: '1px solid var(--forest-mid)' }}>
        <div className="px-5 py-4" style={{ borderBottom: '1px solid var(--forest-mid)' }}>
          <h2 className="text-lg font-bold uppercase tracking-wider" style={{ fontFamily: 'var(--font-josefin)', color: 'var(--cream)' }}>
            Top 10 SKU launches - first 30 days
          </h2>
          <p className="mt-0.5 text-xs" style={{ color: 'var(--sage)' }}>
            Ranked by d1-30 revenue. Trend = d31-60 vs d1-30. Live data, hourly refresh.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: 'var(--forest-darkest)' }}>
                <th className="px-4 py-2 text-left text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--sage)' }}>Product</th>
                <th className="px-4 py-2 text-left text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--sage)' }}>Dept</th>
                <th className="px-4 py-2 text-left text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--sage)' }}>Launched</th>
                <th className="px-4 py-2 text-right text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--sage)' }}>D1-30 rev</th>
                <th className="px-4 py-2 text-right text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--sage)' }}>D31-60</th>
                <th className="px-4 py-2 text-right text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--sage)' }}>D61-90</th>
                <th className="px-4 py-2 text-right text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--sage)' }}>Margin d1-30</th>
                <th className="px-4 py-2 text-left text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--sage)' }}>Trend 30-&gt;60</th>
              </tr>
            </thead>
            <tbody>
              {skuLaunches.length === 0 ? (
                <tr>
                  <td className="px-4 py-6 text-center text-xs italic" style={{ color: 'var(--text-muted)' }} colSpan={8}>
                    Live data unavailable - deploy the <code>asset_life_top_launches</code> Supabase RPC (see{' '}
                    <code>supabase/migrations/003_asset_life.sql</code>) and the next hourly refresh will populate this table.
                  </td>
                </tr>
              ) : (
                skuLaunches.map((s) => (
                  <tr key={s.variant_id} style={{ borderTop: '1px solid var(--forest-mid)' }}>
                    <td className="px-4 py-2" style={{ color: 'var(--cream)' }}>{s.name ?? '(unnamed)'}</td>
                    <td className="px-4 py-2 text-xs" style={{ color: 'var(--sage)' }}>{s.department ?? '-'}</td>
                    <td className="px-4 py-2 text-xs" style={{ color: 'var(--text-muted)' }}>{s.first_sale_date}</td>
                    <td className="px-4 py-2 text-right tabular-nums" style={{ color: 'var(--cream)' }}>{fmtMoney(s.rev_d1_30)}</td>
                    <td className="px-4 py-2 text-right tabular-nums" style={{ color: 'var(--sage)' }}>{fmtMoney(s.rev_d31_60)}</td>
                    <td className="px-4 py-2 text-right tabular-nums" style={{ color: 'var(--sage)' }}>{fmtMoney(s.rev_d61_90)}</td>
                    <td className="px-4 py-2 text-right tabular-nums" style={{ color: 'var(--sage)' }}>{fmtMoney(s.prof_d1_30)}</td>
                    <td className="px-4 py-2 text-xs">{trendArrow(s.rev_d1_30, s.rev_d31_60)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-lg" style={{ background: 'var(--forest)', border: '1px solid var(--forest-mid)' }}>
        <div className="px-5 py-4" style={{ borderBottom: '1px solid var(--forest-mid)' }}>
          <h2 className="text-lg font-bold uppercase tracking-wider" style={{ fontFamily: 'var(--font-josefin)', color: 'var(--cream)' }}>
            Welcome flow - duplicate head-to-head
          </h2>
          <p className="mt-0.5 text-xs" style={{ color: 'var(--sage)' }}>
            Both flows went live <b>Feb 25, 2025</b>. Same lifecycle window. Snapshot from Klaviyo private API 2026-06-03.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: 'var(--forest-darkest)' }}>
                <th className="px-4 py-2 text-left text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--sage)' }}>Flow</th>
                <th className="px-4 py-2 text-right text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--sage)' }}>Recip</th>
                <th className="px-4 py-2 text-right text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--sage)' }}>Rev (12mo)</th>
                <th className="px-4 py-2 text-right text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--sage)' }}>RPR</th>
                <th className="px-4 py-2 text-right text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--sage)' }}>Open</th>
                <th className="px-4 py-2 text-right text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--sage)' }}>Click</th>
                <th className="px-4 py-2 text-right text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--sage)' }}>Conv</th>
                <th className="px-4 py-2 text-left text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--sage)' }}>Verdict</th>
              </tr>
            </thead>
            <tbody>
              {WELCOME_FLOWS.map((f) => (
                <tr key={f.flow_id} style={{ borderTop: '1px solid var(--forest-mid)' }}>
                  <td className="px-4 py-2" style={{ color: 'var(--cream)' }}>
                    <code style={{ color: 'var(--gold)' }}>{f.flow_id}</code> <span style={{ color: 'var(--sage)' }}>- {f.name}</span>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums" style={{ color: 'var(--cream)' }}>{fmtInt(f.recipients)}</td>
                  <td className="px-4 py-2 text-right tabular-nums" style={{ color: 'var(--cream)' }}>{fmtMoney(f.revenue)}</td>
                  <td className="px-4 py-2 text-right tabular-nums" style={{ color: 'var(--cream)', fontWeight: 600 }}>${f.rpr.toFixed(4)}</td>
                  <td className="px-4 py-2 text-right tabular-nums" style={{ color: 'var(--sage)' }}>{fmtPct(f.open_rate)}</td>
                  <td className="px-4 py-2 text-right tabular-nums" style={{ color: 'var(--sage)' }}>{fmtPct(f.click_rate)}</td>
                  <td className="px-4 py-2 text-right tabular-nums" style={{ color: 'var(--sage)' }}>{fmtPct(f.conv_rate)}</td>
                  <td className="px-4 py-2">{verdictPill(f.verdict, f.verdictLabel)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-lg" style={{ background: 'var(--forest)', border: '1px solid var(--forest-mid)' }}>
        <div className="px-5 py-4" style={{ borderBottom: '1px solid var(--forest-mid)' }}>
          <h2 className="text-lg font-bold uppercase tracking-wider" style={{ fontFamily: 'var(--font-josefin)', color: 'var(--cream)' }}>
            Abandoned Cart - 4 concurrent flows
          </h2>
          <p className="mt-0.5 text-xs" style={{ color: 'var(--sage)' }}>
            All four flows live since March 2025. Same lifecycle exposure. RPR is the asset-life-equivalent ranking metric.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: 'var(--forest-darkest)' }}>
                <th className="px-4 py-2 text-left text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--sage)' }}>Flow</th>
                <th className="px-4 py-2 text-right text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--sage)' }}>Recip</th>
                <th className="px-4 py-2 text-right text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--sage)' }}>Rev (12mo)</th>
                <th className="px-4 py-2 text-right text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--sage)' }}>RPR</th>
                <th className="px-4 py-2 text-right text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--sage)' }}>Open</th>
                <th className="px-4 py-2 text-right text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--sage)' }}>Click</th>
                <th className="px-4 py-2 text-right text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--sage)' }}>Conv</th>
                <th className="px-4 py-2 text-left text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--sage)' }}>Verdict</th>
              </tr>
            </thead>
            <tbody>
              {AC_FLOWS.map((f) => (
                <tr key={f.flow_id} style={{ borderTop: '1px solid var(--forest-mid)' }}>
                  <td className="px-4 py-2" style={{ color: 'var(--cream)' }}>
                    <code style={{ color: 'var(--gold)' }}>{f.flow_id}</code> <span style={{ color: 'var(--sage)' }}>- {f.name}</span>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums" style={{ color: 'var(--cream)' }}>{fmtInt(f.recipients)}</td>
                  <td className="px-4 py-2 text-right tabular-nums" style={{ color: 'var(--cream)' }}>{fmtMoney(f.revenue)}</td>
                  <td className="px-4 py-2 text-right tabular-nums" style={{ color: 'var(--cream)', fontWeight: 600 }}>${f.rpr.toFixed(4)}</td>
                  <td className="px-4 py-2 text-right tabular-nums" style={{ color: 'var(--sage)' }}>{fmtPct(f.open_rate)}</td>
                  <td className="px-4 py-2 text-right tabular-nums" style={{ color: 'var(--sage)' }}>{fmtPct(f.click_rate)}</td>
                  <td className="px-4 py-2 text-right tabular-nums" style={{ color: 'var(--sage)' }}>{fmtPct(f.conv_rate)}</td>
                  <td className="px-4 py-2">{verdictPill(f.verdict, f.verdictLabel)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <details className="rounded-lg px-4 py-3 text-xs" style={{ background: 'var(--forest-darkest)', border: '1px solid var(--forest-mid)', color: 'var(--sage)' }}>
        <summary className="cursor-pointer font-semibold" style={{ color: 'var(--cream)' }}>Methodology</summary>
        <p className="mt-2">
          Asset-life compares performance at equal time-since-launch, not at the same calendar month. For SKUs:
          first sale = day 0; d1-30 / d31-60 / d61-90 are cumulative buckets. For Klaviyo flows live &ge; 12 months,
          aggregate stats are equivalent to lifecycle-stage stats since every recipient has progressed through the
          same elapsed flow time. Conversion metric: <code>Placed Order (Shopify)</code> - id <code>SWTRjc</code>.
        </p>
      </details>
    </div>
  );
}

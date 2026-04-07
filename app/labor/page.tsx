import { Suspense } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { getLaborRatioData } from '@/lib/data';
import { LaborRatioChart } from '@/components/charts/labor-ratio-chart';
import { LaborActualsTable } from '@/components/tables/labor-actuals-table';
import { LaborProjectionsTable } from '@/components/tables/labor-projections-table';
import { LookbackFilter } from '@/components/lookback-filter';
import { formatCurrency } from '@/lib/utils';

const TARGET = 25;
const ratioColor = (r: number) =>
  r <= TARGET ? '#7aaa62' : r <= TARGET + 3 ? '#c4923a' : '#b06060';

export default async function LaborRatioPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const params = await searchParams;
  const lookbackDays = Math.min(365, Math.max(7, parseInt(params.days ?? '30') || 30));

  const data = await getLaborRatioData(lookbackDays);

  const totalActualSales = data.actuals.reduce((s, a) => s + a.netSales, 0);
  const totalActualLabor = data.actuals.reduce((s, a) => s + a.fullyLoadedCost, 0);
  const totalProjSales   = data.projections.reduce((s, p) => s + p.projectedSales, 0);
  const totalProjLabor   = data.projections.reduce((s, p) => s + p.projectedLoadedCost, 0);

  const hasLaborData = data.actuals.some((a) => a.hasLaborData);

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Header + filter */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold uppercase tracking-wider" style={{ fontFamily: 'var(--font-josefin)', color: 'var(--gold)' }}>
            Labor Ratio
          </h1>
          <p className="mt-0.5 text-sm" style={{ color: 'var(--sage)' }}>
            Labor costs vs. sales — past {lookbackDays} days + next 14 days scheduled
          </p>
        </div>
        <Suspense>
          <LookbackFilter current={lookbackDays} />
        </Suspense>
      </div>

      {/* No labor data notice */}
      {!hasLaborData && (
        <div className="rounded-lg px-4 py-3 text-sm" style={{ background: 'rgba(196,146,58,0.12)', border: '1px solid rgba(196,146,58,0.3)', color: '#c4923a' }}>
          ⚠ Homebase labor data unavailable — showing sales data only. Check that the Homebase API key and location ID are correct.
        </div>
      )}

      {/* KPI row */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Actual Labor Ratio', value: data.laborRatioPercent > 0 ? `${data.laborRatioPercent}%` : 'N/A', sub: `${lookbackDays}-day average`, color: data.laborRatioPercent > 0 ? ratioColor(data.laborRatioPercent) : 'var(--text-muted)' },
          { label: 'Projected Labor Ratio', value: data.projectedRatioPercent > 0 ? `${data.projectedRatioPercent}%` : 'N/A', sub: 'next 14 days', color: data.projectedRatioPercent > 0 ? ratioColor(data.projectedRatioPercent) : 'var(--text-muted)' },
          { label: 'Target Ratio', value: `${TARGET}%`, sub: 'store benchmark', color: 'var(--cream)' },
          { label: 'Loaded Cost Factor', value: `${data.loadedCostFactor.toFixed(2)}×`, sub: 'wages → fully loaded', color: 'var(--cream)' },
        ].map((kpi) => (
          <div key={kpi.label} className="rounded-lg p-4" style={{ background: 'var(--forest)', border: '1px solid var(--forest-mid)' }}>
            <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--sage)', fontFamily: 'var(--font-josefin)' }}>{kpi.label}</p>
            <p className="mt-1 text-3xl font-bold" style={{ color: kpi.color, fontFamily: 'var(--font-josefin)' }}>{kpi.value}</p>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{kpi.sub}</p>
          </div>
        ))}
      </div>

      {/* Trend chart */}
      <Card>
        <CardHeader>
          <CardTitle>Labor Ratio Trend</CardTitle>
          <CardDescription>
            Actual ({lookbackDays} days) vs Projected (14 days) · Target: {TARGET}%
            {!hasLaborData && ' · Labor data pending Homebase sync'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LaborRatioChart actuals={data.actuals} projections={data.projections} targetRatio={TARGET} />
        </CardContent>
      </Card>

      {/* Summary boxes */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardContent className="p-4">
            <p className="mb-3 text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--gold)', fontFamily: 'var(--font-josefin)' }}>
              Sales Summary — {lookbackDays} Days
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Total Net Sales</p>
                <p className="text-lg font-bold" style={{ color: 'var(--cream)', fontFamily: 'var(--font-josefin)' }}>{formatCurrency(totalActualSales)}</p>
              </div>
              <div>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Total Labor Cost</p>
                <p className="text-lg font-bold" style={{ color: hasLaborData ? 'var(--cream)' : 'var(--text-muted)', fontFamily: 'var(--font-josefin)' }}>
                  {hasLaborData ? formatCurrency(totalActualLabor) : 'N/A'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="mb-3 text-[10px] font-bold uppercase tracking-widest" style={{ color: '#7aaa62', fontFamily: 'var(--font-josefin)' }}>
              Projections Summary — 14 Days
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Projected Sales</p>
                <p className="text-lg font-bold" style={{ color: '#7aaa62', fontFamily: 'var(--font-josefin)' }}>{formatCurrency(totalProjSales)}</p>
              </div>
              <div>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Projected Labor</p>
                <p className="text-lg font-bold" style={{ color: '#7aaa62', fontFamily: 'var(--font-josefin)' }}>{formatCurrency(totalProjLabor)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Actuals table */}
      <Card>
        <CardHeader>
          <CardTitle>Historical Actuals — {data.actuals.length} days with sales</CardTitle>
          <CardDescription>
            {hasLaborData
              ? 'Actual timesheet data from Homebase + net sales from Clover'
              : 'Net sales from Clover · Labor data unavailable'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data.actuals.length > 0 ? (
            <LaborActualsTable data={data.actuals} />
          ) : (
            <p className="py-4 text-center text-sm" style={{ color: 'var(--text-muted)' }}>No sales data found for this period.</p>
          )}
        </CardContent>
      </Card>

      {/* Projections table */}
      <Card>
        <CardHeader>
          <CardTitle>Upcoming Schedule — {data.projections.length} days</CardTitle>
          <CardDescription>Published shifts from Homebase with projected sales (DOW average)</CardDescription>
        </CardHeader>
        <CardContent>
          {data.projections.length > 0 ? (
            <LaborProjectionsTable data={data.projections} />
          ) : (
            <p className="py-4 text-center text-sm" style={{ color: 'var(--text-muted)' }}>No published shifts found for the next 14 days.</p>
          )}
        </CardContent>
      </Card>

      {/* Tips */}
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { label: 'Under Target (<25%)', color: '#7aaa62', text: 'Great job! Consider if service quality can be maintained, or if additional coverage during peak hours would improve customer experience.' },
          { label: 'Near Target (25–28%)', color: '#c4923a', text: 'Monitor closely. Look for small optimizations: reduce overlap during slow periods, adjust break timing, review start/end times.' },
          { label: 'Over Target (>28%)',   color: '#b06060', text: 'Action needed. Cross-reference with Shift Analysis quiet scores. Consider schedule adjustments or sales initiatives.' },
        ].map((tip) => (
          <Card key={tip.label}>
            <CardContent className="p-4">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-widest" style={{ color: tip.color, fontFamily: 'var(--font-josefin)' }}>{tip.label}</p>
              <p className="text-xs leading-relaxed" style={{ color: 'var(--sage)' }}>{tip.text}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

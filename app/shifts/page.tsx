import { Suspense } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { getShiftAnalysisData } from '@/lib/data';
import { QuietScoreChart } from '@/components/charts/quiet-score-chart';
import { DOWBreakdownTable } from '@/components/tables/dow-breakdown-table';
import { LookbackFilter } from '@/components/lookback-filter';

export default async function ShiftAnalysisPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const params = await searchParams;
  const lookbackDays = Math.min(365, Math.max(7, parseInt(params.days ?? '30') || 30));

  const data = await getShiftAnalysisData(lookbackDays);

  const avgScore =
    data.hourlyScores.reduce((s, h) => s + h.score, 0) / (data.hourlyScores.length || 1);
  const quietHours = data.hourlyScores.filter((h) => h.score >= 7).length;
  const peakHours  = data.hourlyScores.filter((h) => h.score < 4).length;

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Header + filter */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold uppercase tracking-wider" style={{ fontFamily: 'var(--font-josefin)', color: 'var(--gold)' }}>
            Shift Analysis
          </h1>
          <p className="mt-0.5 text-sm" style={{ color: 'var(--sage)' }}>
            Hourly traffic patterns and optimal scheduling windows
          </p>
        </div>
        <Suspense>
          <LookbackFilter current={lookbackDays} />
        </Suspense>
      </div>

      {/* Summary stats */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg p-4" style={{ background: 'var(--forest)', border: '1px solid var(--forest-mid)' }}>
          <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--sage)', fontFamily: 'var(--font-josefin)' }}>Avg. Quiet Score</p>
          <p className="mt-1 text-3xl font-bold" style={{ color: 'var(--cream)', fontFamily: 'var(--font-josefin)' }}>{avgScore.toFixed(1)}</p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>based on {lookbackDays}-day lookback</p>
        </div>
        <div className="rounded-lg p-4" style={{ background: 'var(--forest)', border: '1px solid var(--forest-mid)' }}>
          <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--sage)', fontFamily: 'var(--font-josefin)' }}>Quiet Hours Today</p>
          <p className="mt-1 text-3xl font-bold" style={{ color: '#7aaa62', fontFamily: 'var(--font-josefin)' }}>{quietHours}</p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>good for scheduling chores</p>
        </div>
        <div className="rounded-lg p-4" style={{ background: 'var(--forest)', border: '1px solid var(--forest-mid)' }}>
          <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--sage)', fontFamily: 'var(--font-josefin)' }}>Peak Hours Today</p>
          <p className="mt-1 text-3xl font-bold" style={{ color: '#b06060', fontFamily: 'var(--font-josefin)' }}>{peakHours}</p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>all hands on deck</p>
        </div>
      </div>

      {/* Hourly chart */}
      <Card>
        <CardHeader>
          <CardTitle>Today&apos;s Hourly Quiet Score</CardTitle>
          <CardDescription>Higher = quieter. Green bars (7+) are ideal for stocking, cleaning, or inventory tasks.</CardDescription>
        </CardHeader>
        <CardContent>
          {data.hourlyScores.length === 0 ? (
            <div className="flex h-72 items-center justify-center">
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No transaction data yet for today — check back once the store opens.</p>
            </div>
          ) : (
            <>
              <QuietScoreChart data={data.hourlyScores} />
              <div className="mt-3 flex items-center justify-center gap-6 text-xs" style={{ color: 'var(--sage)' }}>
                <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full inline-block" style={{ background: '#7aaa62' }} />Quiet (7-10) — Schedule chores</span>
                <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full inline-block" style={{ background: '#c4923a' }} />Light (4-6) — Normal ops</span>
                <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full inline-block" style={{ background: '#b06060' }} />Peak (0-3) — All hands</span>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* DOW breakdown */}
      <Card>
        <CardHeader>
          <CardTitle>Day of Week Breakdown</CardTitle>
          <CardDescription>Based on {lookbackDays}-day lookback. Use to plan weekly schedules and recurring tasks.</CardDescription>
        </CardHeader>
        <CardContent>
          <DOWBreakdownTable data={data.dayOfWeekBreakdown} />
        </CardContent>
      </Card>

      {/* Guide */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardContent className="p-4">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-widest" style={{ color: '#7aaa62', fontFamily: 'var(--font-josefin)' }}>During Quiet Hours</p>
            <ul className="space-y-1 text-xs" style={{ color: 'var(--sage)' }}>
              {['Stock shelves and face products', 'Deep cleaning tasks', 'Inventory counts', 'Training new staff', 'Administrative tasks'].map((t) => (
                <li key={t} className="flex items-start gap-2"><span style={{ color: '#7aaa62' }}>›</span>{t}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-widest" style={{ color: '#b06060', fontFamily: 'var(--font-josefin)' }}>During Peak Hours</p>
            <ul className="space-y-1 text-xs" style={{ color: 'var(--sage)' }}>
              {['All registers open', 'Floor staff for customer assistance', 'Avoid restocking main aisles', 'Quick spot cleaning only', 'No scheduled breaks'].map((t) => (
                <li key={t} className="flex items-start gap-2"><span style={{ color: '#b06060' }}>›</span>{t}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

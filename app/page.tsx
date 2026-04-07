import { KPICard } from '@/components/kpi-card';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getKPIData, getShiftAnalysisData } from '@/lib/data';
import { formatCurrency, formatHour } from '@/lib/utils';
import { QuietScoreChart } from '@/components/charts/quiet-score-chart';

export default async function DashboardPage() {
  const kpiData = await getKPIData();
  const shiftData = await getShiftAnalysisData(7);

  const getLaborStatus = (ratio: number, target: number) =>
    ratio <= target ? 'good' : ratio <= target + 3 ? 'warning' : 'bad';

  const getQuietStatus = (score: number) =>
    score >= 7 ? 'good' : score >= 4 ? 'warning' : 'bad';

  const bestHoursToday = shiftData.hourlyScores
    .filter((h) => h.score >= 7)
    .map((h) => formatHour(h.hour))
    .slice(0, 5);

  const peakHoursToday = shiftData.hourlyScores
    .filter((h) => h.score < 4)
    .map((h) => formatHour(h.hour));

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Page title */}
      <div>
        <h1 className="text-2xl font-bold uppercase tracking-wider" style={{ fontFamily: 'var(--font-josefin)', color: 'var(--gold)' }}>
          Dashboard
        </h1>
        <p className="mt-0.5 text-sm" style={{ color: 'var(--sage)' }}>
          {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/New_York' })}
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <KPICard
          title="Today's Sales"
          value={formatCurrency(kpiData.todaySales)}
          change={kpiData.todaySalesChange}
          status={kpiData.todaySalesChange >= 0 ? 'good' : 'warning'}
          icon={
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5" style={{ color: 'var(--gold)' }}>
              <path d="M10.75 10.818v2.614A3.13 3.13 0 0 0 11.888 13c.482-.315.612-.648.612-.875 0-.227-.13-.56-.612-.875a3.13 3.13 0 0 0-1.138-.432ZM8.33 8.62c.053.055.115.11.184.164.208.16.46.284.736.363V6.603a2.45 2.45 0 0 0-.35.13c-.14.065-.27.143-.386.233-.377.292-.514.627-.514.909 0 .184.058.39.33.615Z" />
              <path fillRule="evenodd" d="M9.99 1.75C5.44 1.75 1.75 5.44 1.75 9.99 1.75 14.54 5.44 18.25 9.99 18.25c4.55 0 8.26-3.71 8.26-8.26 0-4.55-3.71-8.24-8.26-8.24Zm.74 5.5a.74.74 0 0 0-1.48 0v.42a3.67 3.67 0 0 0-1.52.81c-.56.49-.84 1.14-.84 1.83 0 .7.3 1.35.89 1.83.48.4 1.06.65 1.47.76v2.8a3.32 3.32 0 0 1-1.12-.55l-.75-.57a.75.75 0 0 0-.91 1.2l.75.56c.55.42 1.21.69 1.91.79v.38a.75.75 0 0 0 1.5 0v-.4a3.88 3.88 0 0 0 1.7-.79c.64-.53 1-.27 1-2.12 0-.82-.33-1.55-1-2.09a4.08 4.08 0 0 0-1.7-.76V8.17c.27.06.52.17.74.33l.53.38a.75.75 0 0 0 .87-1.22l-.53-.37a3.68 3.68 0 0 0-1.61-.53v-.36Z" clipRule="evenodd" />
            </svg>
          }
        />
        <KPICard
          title="Labor Ratio"
          value={`${kpiData.laborRatio}%`}
          subtitle={`Target: ${kpiData.laborRatioTarget}%`}
          status={getLaborStatus(kpiData.laborRatio, kpiData.laborRatioTarget)}
          icon={
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5" style={{ color: 'var(--sage)' }}>
              <path d="M10 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6 8a2 2 0 1 1-4 0 2 2 0 0 1 4 0ZM1.49 15.326a.78.78 0 0 1-.358-.442 3 3 0 0 1 4.308-3.516 6.484 6.484 0 0 0-1.905 3.959c-.023.222-.014.442.025.654a4.97 4.97 0 0 1-2.07-.655ZM16.44 15.98a4.97 4.97 0 0 0 2.07-.654.78.78 0 0 0 .357-.442 3 3 0 0 0-4.308-3.517 6.484 6.484 0 0 1 1.907 3.96 2.32 2.32 0 0 1-.026.654ZM18 8a2 2 0 1 1-4 0 2 2 0 0 1 4 0ZM5.304 16.19a.844.844 0 0 1-.277-.71 5 5 0 0 1 9.947 0 .843.843 0 0 1-.277.71A6.975 6.975 0 0 1 10 18a6.974 6.974 0 0 1-4.696-1.81Z" />
            </svg>
          }
        />
        <KPICard
          title="Current Quiet Score"
          value={kpiData.currentQuietScore.toFixed(1)}
          subtitle={kpiData.quietScoreLabel.charAt(0).toUpperCase() + kpiData.quietScoreLabel.slice(1) + ' period'}
          status={getQuietStatus(kpiData.currentQuietScore)}
          icon={
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5" style={{ color: 'var(--warn)' }}>
              <path fillRule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm.75-13a.75.75 0 0 0-1.5 0v5c0 .414.336.75.75.75h4a.75.75 0 0 0 0-1.5h-3.25V5Z" clipRule="evenodd" />
            </svg>
          }
        />
      </div>

      {/* Charts + Quick insights */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Today&apos;s Traffic Pattern</CardTitle>
            </CardHeader>
            <CardContent>
              <QuietScoreChart data={shiftData.hourlyScores} />
              <div className="mt-3 flex items-center justify-center gap-6 text-xs" style={{ color: 'var(--sage)' }}>
                <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full inline-block" style={{ background: '#7aaa62' }} />Quiet (7-10)</span>
                <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full inline-block" style={{ background: '#c4923a' }} />Light (4-6)</span>
                <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full inline-block" style={{ background: '#b06060' }} />Peak (0-3)</span>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-3">
          {/* Best hours */}
          <Card>
            <CardContent className="p-4">
              <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--gold)', fontFamily: 'var(--font-josefin)' }}>
                Best for Chores
              </p>
              {bestHoursToday.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {bestHoursToday.map((h) => (
                    <span key={h} className="rounded px-2 py-0.5 text-xs font-semibold" style={{ background: 'rgba(122,170,98,0.15)', color: '#7aaa62', border: '1px solid rgba(122,170,98,0.3)' }}>
                      {h}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>No quiet hours yet today</p>
              )}
            </CardContent>
          </Card>

          {/* Peak hours */}
          <Card>
            <CardContent className="p-4">
              <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--gold)', fontFamily: 'var(--font-josefin)' }}>
                Peak — All Hands
              </p>
              {peakHoursToday.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {peakHoursToday.map((h) => (
                    <span key={h} className="rounded px-2 py-0.5 text-xs font-semibold" style={{ background: 'rgba(176,96,96,0.15)', color: '#b06060', border: '1px solid rgba(176,96,96,0.3)' }}>
                      {h}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>No peak hours yet today</p>
              )}
            </CardContent>
          </Card>

          {/* Labor status */}
          <Card>
            <CardContent className="p-4">
              <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--gold)', fontFamily: 'var(--font-josefin)' }}>
                Labor Status
              </p>
              <p className="text-xs" style={{ color: 'var(--sage)' }}>
                {kpiData.laborRatio <= kpiData.laborRatioTarget
                  ? '✓ On target. Current scheduling is efficient.'
                  : kpiData.laborRatio <= kpiData.laborRatioTarget + 3
                    ? '⚠ Slightly over target. Review upcoming shifts.'
                    : '⚠ Over target. Schedule adjustment needed.'}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

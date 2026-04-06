import { KPICard } from '@/components/kpi-card';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getKPIData, getShiftAnalysisData } from '@/lib/data';
import { formatCurrency, formatHour } from '@/lib/utils';
import { QuietScoreChart } from '@/components/charts/quiet-score-chart';

export default async function DashboardPage() {
  const kpiData = await getKPIData();
  const shiftData = await getShiftAnalysisData(7);

  const getQuietScoreStatus = (score: number) => {
    if (score >= 7) return 'good';
    if (score >= 4) return 'warning';
    return 'bad';
  };

  const getLaborRatioStatus = (ratio: number, target: number) => {
    if (ratio <= target) return 'good';
    if (ratio <= target + 3) return 'warning';
    return 'bad';
  };

  // Find best hours for chores today
  const bestHoursToday = shiftData.hourlyScores
    .filter((h) => h.score >= 7)
    .map((h) => formatHour(h.hour))
    .slice(0, 4);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-stone-900 dark:text-white">Dashboard</h1>
        <p className="text-stone-500 dark:text-stone-400">
          Today&apos;s operations overview for Nature&apos;s Storehouse
        </p>
      </div>

      {/* KPI Cards */}
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <KPICard
          title="Today's Sales"
          value={formatCurrency(kpiData.todaySales)}
          change={kpiData.todaySalesChange}
          status={kpiData.todaySalesChange >= 0 ? 'good' : 'warning'}
          icon={
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="currentColor"
              className="h-6 w-6 text-emerald-600"
            >
              <path d="M10.464 8.746c.227-.18.497-.311.786-.394v2.795a2.252 2.252 0 0 1-.786-.393c-.394-.313-.546-.681-.546-1.004 0-.323.152-.691.546-1.004ZM12.75 15.662v-2.824c.347.085.664.228.921.421.427.32.579.686.579.991 0 .305-.152.671-.579.991a2.534 2.534 0 0 1-.921.42Z" />
              <path
                fillRule="evenodd"
                d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25ZM12.75 6a.75.75 0 0 0-1.5 0v.816a3.836 3.836 0 0 0-1.72.756c-.712.566-1.112 1.35-1.112 2.178 0 .829.4 1.612 1.113 2.178.502.4 1.102.647 1.719.756v2.978a2.536 2.536 0 0 1-.921-.421l-.879-.66a.75.75 0 0 0-.9 1.2l.879.66c.533.4 1.169.645 1.821.75V18a.75.75 0 0 0 1.5 0v-.81a4.124 4.124 0 0 0 1.821-.749c.745-.559 1.179-1.344 1.179-2.191 0-.847-.434-1.632-1.179-2.191a4.122 4.122 0 0 0-1.821-.75V8.354c.29.082.559.213.786.393l.415.33a.75.75 0 0 0 .933-1.175l-.415-.33a3.836 3.836 0 0 0-1.719-.755V6Z"
                clipRule="evenodd"
              />
            </svg>
          }
        />

        <KPICard
          title="Labor Ratio"
          value={`${kpiData.laborRatio}%`}
          subtitle={`Target: ${kpiData.laborRatioTarget}%`}
          status={getLaborRatioStatus(kpiData.laborRatio, kpiData.laborRatioTarget)}
          icon={
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="currentColor"
              className="h-6 w-6 text-blue-600"
            >
              <path
                fillRule="evenodd"
                d="M8.25 6.75a3.75 3.75 0 1 1 7.5 0 3.75 3.75 0 0 1-7.5 0ZM15.75 9.75a3 3 0 1 1 6 0 3 3 0 0 1-6 0ZM2.25 9.75a3 3 0 1 1 6 0 3 3 0 0 1-6 0ZM6.31 15.117A6.745 6.745 0 0 1 12 12a6.745 6.745 0 0 1 6.709 7.498.75.75 0 0 1-.372.568A12.696 12.696 0 0 1 12 21.75c-2.305 0-4.47-.612-6.337-1.684a.75.75 0 0 1-.372-.568 6.787 6.787 0 0 1 1.019-4.38Z"
                clipRule="evenodd"
              />
              <path d="M5.082 14.254a8.287 8.287 0 0 0-1.308 5.135 9.687 9.687 0 0 1-1.764-.44l-.115-.04a.563.563 0 0 1-.373-.487l-.01-.121ZM19.573 21.1a8.287 8.287 0 0 0 1.308-5.135 9.687 9.687 0 0 1 1.764.44l.115.04a.563.563 0 0 1 .373.487l.01.121Z" />
            </svg>
          }
        />

        <KPICard
          title="Current Quiet Score"
          value={kpiData.currentQuietScore.toFixed(1)}
          subtitle={`Status: ${kpiData.quietScoreLabel}`}
          status={getQuietScoreStatus(kpiData.currentQuietScore)}
          icon={
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="currentColor"
              className="h-6 w-6 text-amber-600"
            >
              <path
                fillRule="evenodd"
                d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25ZM12.75 6a.75.75 0 0 0-1.5 0v6c0 .414.336.75.75.75h4.5a.75.75 0 0 0 0-1.5h-3.75V6Z"
                clipRule="evenodd"
              />
            </svg>
          }
        />
      </div>

      {/* Quick Insights */}
      <div className="mb-8 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Today&apos;s Hourly Traffic</CardTitle>
          </CardHeader>
          <CardContent>
            <QuietScoreChart data={shiftData.hourlyScores} />
            <div className="mt-4 flex items-center justify-center gap-6 text-sm">
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded-full bg-emerald-500" />
                <span className="text-stone-600 dark:text-stone-400">Quiet (7-10)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded-full bg-amber-500" />
                <span className="text-stone-600 dark:text-stone-400">Light (4-6)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded-full bg-red-500" />
                <span className="text-stone-600 dark:text-stone-400">Peak (0-3)</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="rounded-lg bg-emerald-50 p-4 dark:bg-emerald-950/30">
                <h4 className="font-medium text-emerald-800 dark:text-emerald-300">
                  Best Hours for Chores Today
                </h4>
                <p className="mt-1 text-sm text-emerald-700 dark:text-emerald-400">
                  {bestHoursToday.length > 0
                    ? bestHoursToday.join(', ')
                    : 'No quiet hours detected yet'}
                </p>
              </div>

              <div className="rounded-lg bg-blue-50 p-4 dark:bg-blue-950/30">
                <h4 className="font-medium text-blue-800 dark:text-blue-300">
                  Labor Ratio Status
                </h4>
                <p className="mt-1 text-sm text-blue-700 dark:text-blue-400">
                  {kpiData.laborRatio <= kpiData.laborRatioTarget
                    ? 'On target! Keep current scheduling.'
                    : kpiData.laborRatio <= kpiData.laborRatioTarget + 3
                      ? 'Slightly over target. Review upcoming shifts.'
                      : 'Attention needed. Consider schedule adjustments.'}
                </p>
              </div>

              <div className="rounded-lg bg-stone-100 p-4 dark:bg-stone-800">
                <h4 className="font-medium text-stone-800 dark:text-stone-200">
                  Today&apos;s Focus
                </h4>
                <p className="mt-1 text-sm text-stone-600 dark:text-stone-400">
                  {new Date().getDay() === 0 || new Date().getDay() === 6
                    ? 'Weekend day - expect higher traffic midday. All hands during peak hours.'
                    : 'Weekday - peak traffic at lunch (11am-1pm) and after work (5-6pm).'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

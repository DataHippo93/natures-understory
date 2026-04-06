import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { getShiftAnalysisData } from '@/lib/data';
import { QuietScoreChart } from '@/components/charts/quiet-score-chart';
import { DOWBreakdownTable } from '@/components/tables/dow-breakdown-table';

export default async function ShiftAnalysisPage() {
  const data = await getShiftAnalysisData(30);

  // Calculate summary stats
  const avgScore =
    data.hourlyScores.reduce((sum, h) => sum + h.score, 0) / data.hourlyScores.length;
  const quietHours = data.hourlyScores.filter((h) => h.score >= 7).length;
  const peakHours = data.hourlyScores.filter((h) => h.score < 4).length;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-stone-900 dark:text-white">Shift Analysis</h1>
        <p className="text-stone-500 dark:text-stone-400">
          Hourly traffic patterns and optimal scheduling windows
        </p>
      </div>

      {/* Summary Cards */}
      <div className="mb-8 grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="p-6">
            <div className="text-sm font-medium text-stone-500">Avg. Quiet Score</div>
            <div className="mt-1 text-3xl font-bold text-stone-900 dark:text-white">
              {avgScore.toFixed(1)}
            </div>
            <div className="text-sm text-stone-500">across all hours</div>
          </CardContent>
        </Card>
        <Card className="bg-emerald-50 dark:bg-emerald-950/30">
          <CardContent className="p-6">
            <div className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
              Quiet Hours Today
            </div>
            <div className="mt-1 text-3xl font-bold text-emerald-700 dark:text-emerald-400">
              {quietHours}
            </div>
            <div className="text-sm text-emerald-600 dark:text-emerald-500">
              good for scheduling chores
            </div>
          </CardContent>
        </Card>
        <Card className="bg-red-50 dark:bg-red-950/30">
          <CardContent className="p-6">
            <div className="text-sm font-medium text-red-700 dark:text-red-400">
              Peak Hours Today
            </div>
            <div className="mt-1 text-3xl font-bold text-red-700 dark:text-red-400">
              {peakHours}
            </div>
            <div className="text-sm text-red-600 dark:text-red-500">all hands on deck</div>
          </CardContent>
        </Card>
      </div>

      {/* Hourly Chart */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle>Today&apos;s Hourly Quiet Score</CardTitle>
          <CardDescription>
            Higher scores indicate quieter periods. Green bars (7+) are ideal for scheduling tasks
            like stocking, cleaning, or inventory.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <QuietScoreChart data={data.hourlyScores} />
          <div className="mt-4 flex items-center justify-center gap-6 text-sm">
            <div className="flex items-center gap-2">
              <div className="h-3 w-3 rounded-full bg-emerald-500" />
              <span className="text-stone-600 dark:text-stone-400">
                Quiet (7-10) - Schedule chores
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-3 w-3 rounded-full bg-amber-500" />
              <span className="text-stone-600 dark:text-stone-400">Light (4-6) - Normal ops</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-3 w-3 rounded-full bg-red-500" />
              <span className="text-stone-600 dark:text-stone-400">Peak (0-3) - All hands</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Day of Week Breakdown */}
      <Card>
        <CardHeader>
          <CardTitle>Day of Week Breakdown</CardTitle>
          <CardDescription>
            Based on {data.lookbackDays}-day lookback. Use this to plan weekly schedules and
            recurring tasks.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DOWBreakdownTable data={data.dayOfWeekBreakdown} />
        </CardContent>
      </Card>

      {/* Usage Guide */}
      <Card className="mt-8">
        <CardHeader>
          <CardTitle>How to Use This Data</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg bg-emerald-50 p-4 dark:bg-emerald-950/30">
              <h4 className="font-semibold text-emerald-800 dark:text-emerald-300">
                During Quiet Hours (Green)
              </h4>
              <ul className="mt-2 list-inside list-disc text-sm text-emerald-700 dark:text-emerald-400">
                <li>Stock shelves and face products</li>
                <li>Deep cleaning tasks</li>
                <li>Inventory counts</li>
                <li>Training new staff</li>
                <li>Administrative tasks</li>
              </ul>
            </div>
            <div className="rounded-lg bg-red-50 p-4 dark:bg-red-950/30">
              <h4 className="font-semibold text-red-800 dark:text-red-300">
                During Peak Hours (Red)
              </h4>
              <ul className="mt-2 list-inside list-disc text-sm text-red-700 dark:text-red-400">
                <li>All registers open</li>
                <li>Floor staff available for customer assistance</li>
                <li>Avoid restocking main aisles</li>
                <li>Quick spot cleaning only</li>
                <li>No scheduled breaks</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

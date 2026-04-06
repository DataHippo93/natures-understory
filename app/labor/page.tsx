import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { getLaborRatioData } from '@/lib/data';
import { LaborRatioChart } from '@/components/charts/labor-ratio-chart';
import { LaborActualsTable } from '@/components/tables/labor-actuals-table';
import { LaborProjectionsTable } from '@/components/tables/labor-projections-table';
import { formatCurrency } from '@/lib/utils';
import { cn } from '@/lib/utils';

export default async function LaborRatioPage() {
  const data = await getLaborRatioData();
  const targetRatio = 25;

  // Calculate totals
  const totalActualSales = data.actuals.reduce((sum, a) => sum + a.netSales, 0);
  const totalActualLabor = data.actuals.reduce((sum, a) => sum + a.fullyLoadedCost, 0);
  const totalProjectedSales = data.projections.reduce((sum, p) => sum + p.projectedSales, 0);
  const totalProjectedLabor = data.projections.reduce(
    (sum, p) => sum + p.projectedLoadedCost,
    0
  );

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-stone-900 dark:text-white">Labor Ratio</h1>
        <p className="text-stone-500 dark:text-stone-400">
          Track labor costs against sales and optimize scheduling
        </p>
      </div>

      {/* KPI Cards */}
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-6">
            <div className="text-sm font-medium text-stone-500">Actual Labor Ratio</div>
            <div
              className={cn(
                'mt-1 text-3xl font-bold',
                data.laborRatioPercent <= targetRatio
                  ? 'text-emerald-600'
                  : data.laborRatioPercent <= targetRatio + 3
                    ? 'text-amber-600'
                    : 'text-red-600'
              )}
            >
              {data.laborRatioPercent}%
            </div>
            <div className="text-sm text-stone-500">14-day average</div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="text-sm font-medium text-stone-500">Projected Labor Ratio</div>
            <div
              className={cn(
                'mt-1 text-3xl font-bold',
                data.projectedRatioPercent <= targetRatio
                  ? 'text-emerald-600'
                  : data.projectedRatioPercent <= targetRatio + 3
                    ? 'text-amber-600'
                    : 'text-red-600'
              )}
            >
              {data.projectedRatioPercent}%
            </div>
            <div className="text-sm text-stone-500">next 7 days</div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="text-sm font-medium text-stone-500">Target Ratio</div>
            <div className="mt-1 text-3xl font-bold text-stone-900 dark:text-white">
              {targetRatio}%
            </div>
            <div className="text-sm text-stone-500">store benchmark</div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="text-sm font-medium text-stone-500">Loaded Cost Factor</div>
            <div className="mt-1 text-3xl font-bold text-stone-900 dark:text-white">
              {data.loadedCostFactor.toFixed(2)}x
            </div>
            <div className="text-sm text-stone-500">wages to fully loaded</div>
          </CardContent>
        </Card>
      </div>

      {/* Trend Chart */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle>Labor Ratio Trend</CardTitle>
          <CardDescription>
            Actual (past 14 days) vs Projected (next 7 days). Target: {targetRatio}%
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LaborRatioChart
            actuals={data.actuals}
            projections={data.projections}
            targetRatio={targetRatio}
          />
        </CardContent>
      </Card>

      {/* Summary Boxes */}
      <div className="mb-8 grid gap-4 lg:grid-cols-2">
        <Card className="bg-stone-50 dark:bg-stone-900/50">
          <CardHeader>
            <CardTitle className="text-lg">Actuals Summary (14 days)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-stone-500">Total Net Sales</p>
                <p className="text-xl font-semibold">{formatCurrency(totalActualSales)}</p>
              </div>
              <div>
                <p className="text-sm text-stone-500">Total Labor Cost</p>
                <p className="text-xl font-semibold">{formatCurrency(totalActualLabor)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-blue-50 dark:bg-blue-950/30">
          <CardHeader>
            <CardTitle className="text-lg">Projections Summary (7 days)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-blue-600 dark:text-blue-400">Projected Sales</p>
                <p className="text-xl font-semibold text-blue-800 dark:text-blue-300">
                  {formatCurrency(totalProjectedSales)}
                </p>
              </div>
              <div>
                <p className="text-sm text-blue-600 dark:text-blue-400">Projected Labor</p>
                <p className="text-xl font-semibold text-blue-800 dark:text-blue-300">
                  {formatCurrency(totalProjectedLabor)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Actuals Table */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle>Historical Actuals</CardTitle>
          <CardDescription>Past 14 days of actual timesheet and sales data</CardDescription>
        </CardHeader>
        <CardContent>
          <LaborActualsTable data={data.actuals} />
        </CardContent>
      </Card>

      {/* Projections Table */}
      <Card>
        <CardHeader>
          <CardTitle>Upcoming Schedule</CardTitle>
          <CardDescription>
            Next 7 days based on current schedule and projected sales
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LaborProjectionsTable data={data.projections} />
        </CardContent>
      </Card>

      {/* Tips */}
      <Card className="mt-8">
        <CardHeader>
          <CardTitle>Labor Optimization Tips</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-lg bg-emerald-50 p-4 dark:bg-emerald-950/30">
              <h4 className="font-semibold text-emerald-800 dark:text-emerald-300">
                Under Target (&lt;25%)
              </h4>
              <p className="mt-2 text-sm text-emerald-700 dark:text-emerald-400">
                Great job! Consider if service quality can be maintained or if additional staff
                could improve customer experience during peak times.
              </p>
            </div>
            <div className="rounded-lg bg-amber-50 p-4 dark:bg-amber-950/30">
              <h4 className="font-semibold text-amber-800 dark:text-amber-300">
                Near Target (25-28%)
              </h4>
              <p className="mt-2 text-sm text-amber-700 dark:text-amber-400">
                Monitor closely. Look for small optimizations: reduce overlap during slow periods,
                adjust break timing, review start/end times.
              </p>
            </div>
            <div className="rounded-lg bg-red-50 p-4 dark:bg-red-950/30">
              <h4 className="font-semibold text-red-800 dark:text-red-300">
                Over Target (&gt;28%)
              </h4>
              <p className="mt-2 text-sm text-red-700 dark:text-red-400">
                Action needed. Review scheduled hours vs quiet score data. Consider shift
                adjustments, cross-training to reduce coverage gaps, or sales initiatives.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

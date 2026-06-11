import { Suspense } from 'react';
import { createClient } from '@/lib/supabase/server';
import { getDepartmentSales, getLatestSaleDate, type DepartmentSales } from '@/lib/thrive';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { CategorySalesChart } from '@/components/charts/category-sales-chart';
import { LookbackFilter } from '@/components/lookback-filter';

export default async function CategorySalesPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string; sort?: string }>;
}) {
  const params = await searchParams;
  const days = Math.min(365, Math.max(7, parseInt(params.days ?? '30') || 30));
  const sort = params.sort ?? 'revenue';

  const supabase = await createClient();
  const user = supabase ? (await supabase.auth.getUser()).data.user : null;

  let rows: DepartmentSales[] = [];
  let latestSaleDate: string | null = null;
  if (user) {
    [rows, latestSaleDate] = await Promise.all([getDepartmentSales(days), getLatestSaleDate()]);
  }

  const sortedRows = [...rows].sort((a, b) => {
    if (sort === 'items') return b.unitsSold - a.unitsSold;
    if (sort === 'margin') return b.marginPct - a.marginPct;
    if (sort === 'name') return a.department.localeCompare(b.department);
    return b.revenue - a.revenue;
  });

  const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);
  const totalItems = rows.reduce((s, r) => s + r.unitsSold, 0);
  const totalProfit = rows.reduce((s, r) => s + r.profit, 0);

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold uppercase tracking-wider" style={{ fontFamily: 'var(--font-josefin)', color: 'var(--gold)' }}>
            Department Sales
          </h1>
          <p className="mt-0.5 text-sm" style={{ color: 'var(--sage)' }}>
            Revenue, units, and margin by department — from the Thrive warehouse
            {latestSaleDate && <span style={{ color: 'var(--text-muted)' }}> · data through {latestSaleDate}</span>}
          </p>
        </div>
        <Suspense>
          <LookbackFilter current={days} />
        </Suspense>
      </div>

      {/* Summary stats */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg p-4" style={{ background: 'var(--forest)', border: '1px solid var(--forest-mid)' }}>
          <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-josefin)' }}>Total Revenue</p>
          <p className="mt-1 text-2xl font-bold" style={{ color: 'var(--cream)', fontFamily: 'var(--font-josefin)' }}>
            ${totalRevenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>last {days} days</p>
        </div>
        <div className="rounded-lg p-4" style={{ background: 'var(--forest)', border: '1px solid var(--forest-mid)' }}>
          <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-josefin)' }}>Units Sold</p>
          <p className="mt-1 text-2xl font-bold" style={{ color: 'var(--cream)', fontFamily: 'var(--font-josefin)' }}>
            {totalItems.toLocaleString()}
          </p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>last {days} days</p>
        </div>
        <div className="rounded-lg p-4" style={{ background: 'var(--forest)', border: '1px solid var(--forest-mid)' }}>
          <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-josefin)' }}>Gross Profit</p>
          <p className="mt-1 text-2xl font-bold" style={{ color: 'var(--cream)', fontFamily: 'var(--font-josefin)' }}>
            ${totalProfit.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
          </p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {totalRevenue > 0 ? `${((totalProfit / totalRevenue) * 100).toFixed(1)}% blended margin` : 'no sales in period'}
          </p>
        </div>
      </div>

      {/* Chart */}
      <Card>
        <CardHeader>
          <CardTitle>Revenue by Department</CardTitle>
          <CardDescription>Top 12 departments by net revenue</CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <div className="flex h-64 items-center justify-center flex-col gap-3">
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No sales data in the warehouse for this period.</p>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Thrive syncs nightly. If this persists, check the sync status on the{' '}
                <a href="/reports" style={{ color: 'var(--gold)' }}>Reports</a> page.
              </p>
            </div>
          ) : (
            <CategorySalesChart
              data={sortedRows.map((r) => ({
                category_name: r.department,
                revenue: r.revenue,
                items_sold: r.unitsSold,
              }))}
            />
          )}
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Breakdown Table</CardTitle>
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-josefin)' }}>Sort</span>
              <Suspense>
                <SortLinks current={sort} days={days} />
              </Suspense>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <p className="px-5 py-8 text-sm text-center" style={{ color: 'var(--text-muted)' }}>No data available</p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--forest-mid)' }}>
                  {['#', 'Department', 'Revenue', 'Units Sold', 'Margin', '% of Total'].map((h) => (
                    <th key={h} className="px-4 py-3 text-left font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-josefin)', fontSize: '10px' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((row, i) => (
                  <tr
                    key={row.department}
                    style={{ borderBottom: i < sortedRows.length - 1 ? '1px solid var(--forest-mid)' : undefined }}
                  >
                    <td className="px-4 py-3" style={{ color: 'var(--text-muted)' }}>{i + 1}</td>
                    <td className="px-4 py-3 font-medium" style={{ color: 'var(--cream)' }}>{row.department}</td>
                    <td className="px-4 py-3 font-semibold" style={{ color: '#c4923a' }}>
                      ${row.revenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td className="px-4 py-3" style={{ color: 'var(--sage)' }}>{row.unitsSold.toLocaleString()}</td>
                    <td className="px-4 py-3" style={{ color: row.marginPct >= 30 ? 'var(--sage)' : '#b06060' }}>
                      {row.marginPct.toFixed(1)}%
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-20 rounded-full overflow-hidden" style={{ background: 'var(--forest-mid)' }}>
                          <div
                            className="h-full rounded-full"
                            style={{ width: `${Math.min(100, row.pct)}%`, background: 'var(--gold)' }}
                          />
                        </div>
                        <span style={{ color: 'var(--sage)' }}>{row.pct.toFixed(1)}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SortLinks({ current, days }: { current: string; days: number }) {
  const options = [
    { value: 'revenue', label: 'Revenue' },
    { value: 'items', label: 'Units' },
    { value: 'margin', label: 'Margin' },
    { value: 'name', label: 'Name' },
  ];
  return (
    <div className="flex gap-1">
      {options.map((o) => (
        <a
          key={o.value}
          href={`?days=${days}&sort=${o.value}`}
          className="rounded px-2 py-1 text-[10px] font-bold uppercase tracking-widest transition-all"
          style={{
            background: current === o.value ? 'var(--gold)' : 'var(--forest-mid)',
            color: current === o.value ? 'var(--forest-darkest)' : 'var(--sage)',
            fontFamily: 'var(--font-josefin)',
          }}
        >
          {o.label}
        </a>
      ))}
    </div>
  );
}

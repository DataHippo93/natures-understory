import { Suspense } from 'react';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { CategorySalesChart } from '@/components/charts/category-sales-chart';
import { LookbackFilter } from '@/components/lookback-filter';
import { SyncButton } from '@/components/sync-button';

interface CategoryRow {
  category_name: string | null;
  revenue: number;
  items_sold: number;
  pct: number;
}

async function getCategoryData(days: number): Promise<CategoryRow[]> {
  const admin = createAdminClient();
  if (!admin) return [];

  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - days);

  const startStr = start.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const endStr = end.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

  const { data, error } = await admin
    .from('sales_line_items')
    .select('category_name, net_price_cents, quantity')
    .gte('sale_date', startStr)
    .lte('sale_date', endStr);

  if (error || !data) return [];

  // Aggregate in-memory
  const map = new Map<string, { revenue: number; items_sold: number }>();
  for (const row of data) {
    const key = row.category_name ?? 'Uncategorized';
    const existing = map.get(key) ?? { revenue: 0, items_sold: 0 };
    existing.revenue += (row.net_price_cents ?? 0) / 100;
    existing.items_sold += row.quantity ?? 1;
    map.set(key, existing);
  }

  const total = Array.from(map.values()).reduce((s, v) => s + v.revenue, 0);
  const rows: CategoryRow[] = Array.from(map.entries())
    .map(([category_name, v]) => ({
      category_name,
      revenue: v.revenue,
      items_sold: v.items_sold,
      pct: total > 0 ? (v.revenue / total) * 100 : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue);

  return rows;
}

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

  const rows = user ? await getCategoryData(days) : [];

  const sortedRows = [...rows].sort((a, b) => {
    if (sort === 'items') return b.items_sold - a.items_sold;
    if (sort === 'name') return (a.category_name ?? '').localeCompare(b.category_name ?? '');
    return b.revenue - a.revenue;
  });

  const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);
  const totalItems = rows.reduce((s, r) => s + r.items_sold, 0);

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold uppercase tracking-wider" style={{ fontFamily: 'var(--font-josefin)', color: 'var(--gold)' }}>
            Category Sales
          </h1>
          <p className="mt-0.5 text-sm" style={{ color: 'var(--sage)' }}>
            Revenue and item counts broken down by product category
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Suspense>
            <LookbackFilter current={days} />
          </Suspense>
          <Suspense>
            <SyncButton />
          </Suspense>
        </div>
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
          <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-josefin)' }}>Items Sold</p>
          <p className="mt-1 text-2xl font-bold" style={{ color: 'var(--cream)', fontFamily: 'var(--font-josefin)' }}>
            {totalItems.toLocaleString()}
          </p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>last {days} days</p>
        </div>
        <div className="rounded-lg p-4" style={{ background: 'var(--forest)', border: '1px solid var(--forest-mid)' }}>
          <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-josefin)' }}>Categories</p>
          <p className="mt-1 text-2xl font-bold" style={{ color: 'var(--cream)', fontFamily: 'var(--font-josefin)' }}>
            {rows.length}
          </p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>with sales in period</p>
        </div>
      </div>

      {/* Chart */}
      <Card>
        <CardHeader>
          <CardTitle>Revenue by Category</CardTitle>
          <CardDescription>Top 12 categories by net revenue</CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <div className="flex h-64 items-center justify-center flex-col gap-3">
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No sales data synced yet.</p>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Use the Sync button above to pull data from Clover, or visit{' '}
                <a href="/reports/query" style={{ color: 'var(--gold)' }}>Custom Query</a> to trigger a sync.
              </p>
            </div>
          ) : (
            <CategorySalesChart data={sortedRows} />
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
                  {['#', 'Category', 'Revenue', 'Items Sold', '% of Total'].map((h) => (
                    <th key={h} className="px-4 py-3 text-left font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-josefin)', fontSize: '10px' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((row, i) => (
                  <tr
                    key={row.category_name ?? i}
                    style={{ borderBottom: i < sortedRows.length - 1 ? '1px solid var(--forest-mid)' : undefined }}
                  >
                    <td className="px-4 py-3" style={{ color: 'var(--text-muted)' }}>{i + 1}</td>
                    <td className="px-4 py-3 font-medium" style={{ color: 'var(--cream)' }}>
                      {row.category_name ?? <em style={{ color: 'var(--text-muted)' }}>Uncategorized</em>}
                    </td>
                    <td className="px-4 py-3 font-semibold" style={{ color: '#c4923a' }}>
                      ${row.revenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td className="px-4 py-3" style={{ color: 'var(--sage)' }}>{row.items_sold.toLocaleString()}</td>
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
    { value: 'items', label: 'Items' },
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

import { Suspense } from 'react';
import { Page } from '@/components/ui/page';
import { createClient } from '@/lib/supabase/server';
import { getItemSales, getDepartmentSales, getLatestSaleDate, resolveSalesWindow, type DepartmentSales, type ItemSales } from '@/lib/thrive';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { LookbackFilter } from '@/components/lookback-filter';
import { ItemsTable } from '@/components/tables/items-table';

export const dynamic = 'force-dynamic';

export default async function ItemSalesPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string; category?: string; search?: string; month?: string }>;
}) {
  const params = await searchParams;
  const win = resolveSalesWindow(params);
  const days = win.days;
  const departmentFilter = params.category ?? null;
  const searchFilter = (params.search ?? '').toLowerCase();

  const supabase = await createClient();
  const user = supabase ? (await supabase.auth.getUser()).data.user : null;

  let items: ItemSales[] = [];
  let departments: string[] = [];
  let deptSales: DepartmentSales[] = [];
  let latestSaleDate: string | null = null;
  if (user) {
    const [itemRows, deptRows, latest] = await Promise.all([
      getItemSales(days, 500, departmentFilter, win),
      getDepartmentSales(days, win),
      getLatestSaleDate(),
    ]);
    items = itemRows;
    deptSales = deptRows;
    departments = deptRows.map((d) => d.department);
    latestSaleDate = latest;
  }

  const filtered = searchFilter
    ? items.filter((r) => r.itemName.toLowerCase().includes(searchFilter))
    : items;

  // Summary cards must reflect ALL sales in the window, not just the top-500
  // rows the table shows — sum the (complete) department aggregates instead.
  // With a search filter the cards describe the matched subset.
  const deptRowsAll = departments.length > 0;
  const fullStats = (() => {
    if (searchFilter || !deptRowsAll) {
      return {
        revenue: filtered.reduce((s, r) => s + r.revenue, 0),
        units: filtered.reduce((s, r) => s + r.unitsSold, 0),
        scope: searchFilter ? 'matching search' : 'top items shown',
      };
    }
    const src = departmentFilter
      ? deptSales.filter((d) => d.department === departmentFilter)
      : deptSales;
    return {
      revenue: src.reduce((s, d) => s + d.revenue, 0),
      units: src.reduce((s, d) => s + d.unitsSold, 0),
      scope: 'all sales in period',
    };
  })();
  const totalRevenue = fullStats.revenue;
  const totalItems = fullStats.units;

  return (
    <Page>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold uppercase tracking-wider" style={{ fontFamily: 'var(--font-josefin)', color: 'var(--gold)' }}>
            Item Sales
          </h1>
          <p className="mt-0.5 text-sm" style={{ color: 'var(--sage)' }}>
            Top-selling items with revenue, units, and margin — from the Thrive warehouse
            {latestSaleDate && <span style={{ color: 'var(--text-muted)' }}> · data through {latestSaleDate}</span>}
          </p>
        </div>
        <Suspense>
          <LookbackFilter current={days} currentMonth={win.month} monthLabel={win.month ? win.label : null} />
        </Suspense>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <DepartmentFilter departments={departments} current={departmentFilter} days={days} search={params.search} />
        <SearchInput current={params.search ?? ''} days={days} category={departmentFilter} />
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg p-4" style={{ background: 'var(--forest)', border: '1px solid var(--forest-mid)' }}>
          <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-josefin)' }}>Revenue</p>
          <p className="mt-1 text-2xl font-bold" style={{ color: 'var(--cream)', fontFamily: 'var(--font-josefin)' }}>
            ${totalRevenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{win.label}{departmentFilter ? ` · ${departmentFilter}` : ''} · {fullStats.scope}</p>
        </div>
        <div className="rounded-lg p-4" style={{ background: 'var(--forest)', border: '1px solid var(--forest-mid)' }}>
          <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-josefin)' }}>Units Sold</p>
          <p className="mt-1 text-2xl font-bold" style={{ color: 'var(--cream)', fontFamily: 'var(--font-josefin)' }}>
            {Math.round(totalItems).toLocaleString()}
          </p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>units (lbs for weighed items)</p>
        </div>
        <div className="rounded-lg p-4" style={{ background: 'var(--forest)', border: '1px solid var(--forest-mid)' }}>
          <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-josefin)' }}>Unique Items</p>
          <p className="mt-1 text-2xl font-bold" style={{ color: 'var(--cream)', fontFamily: 'var(--font-josefin)' }}>
            {filtered.length.toLocaleString()}
          </p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{searchFilter ? 'matching search' : filtered.length >= 500 ? 'top 500 shown' : 'with sales'}</p>
        </div>
      </div>

      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle>Item Performance</CardTitle>
          <CardDescription>
            Sorted by revenue — top {Math.min(filtered.length, 500)} of {filtered.length} items
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <p className="px-5 py-8 text-sm text-center" style={{ color: 'var(--text-muted)' }}>
              {items.length === 0
                ? 'No sales in the warehouse for this period. Thrive syncs nightly — check sync status on the Reports page.'
                : 'No items match your filters.'}
            </p>
          ) : (
            <Suspense>
              <ItemsTable
                rows={filtered.slice(0, 500).map((r) => ({
                  item_name: r.variantName && r.variantName !== r.itemName
                    ? `${r.itemName} — ${r.variantName}`
                    : r.itemName,
                  category_name: r.department,
                  revenue: r.revenue,
                  items_sold: r.unitsSold,
                  brand: r.brand,
                  margin_pct: r.marginPct,
                }))}
              />
            </Suspense>
          )}
        </CardContent>
      </Card>
    </Page>
  );
}

function DepartmentFilter({ departments, current, days, search }: { departments: string[]; current: string | null; days: number; search?: string }) {
  const buildUrl = (cat: string | null) => {
    const p = new URLSearchParams();
    p.set('days', String(days));
    if (cat) p.set('category', cat);
    if (search) p.set('search', search);
    return `?${p.toString()}`;
  };

  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="text-[10px] font-bold uppercase tracking-widest mr-1" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-josefin)' }}>
        Department
      </span>
      <a
        href={buildUrl(null)}
        className="rounded px-2.5 py-1 text-xs font-semibold transition-all"
        style={{
          background: !current ? 'var(--gold)' : 'var(--forest)',
          color: !current ? 'var(--forest-darkest)' : 'var(--sage)',
          border: `1px solid ${!current ? 'var(--gold)' : 'var(--forest-mid)'}`,
          fontFamily: 'var(--font-josefin)',
        }}
      >
        All
      </a>
      {departments.slice(0, 12).map((cat) => (
        <a
          key={cat}
          href={buildUrl(cat)}
          className="rounded px-2.5 py-1 text-xs font-semibold transition-all"
          style={{
            background: current === cat ? 'var(--gold)' : 'var(--forest)',
            color: current === cat ? 'var(--forest-darkest)' : 'var(--sage)',
            border: `1px solid ${current === cat ? 'var(--gold)' : 'var(--forest-mid)'}`,
            fontFamily: 'var(--font-josefin)',
          }}
        >
          {cat}
        </a>
      ))}
    </div>
  );
}

function SearchInput({ current, days, category }: { current: string; days: number; category: string | null }) {
  return (
    <form method="GET" className="flex items-center gap-2">
      <input type="hidden" name="days" value={days} />
      {category && <input type="hidden" name="category" value={category} />}
      <input
        type="text"
        name="search"
        defaultValue={current}
        placeholder="Search items..."
        className="rounded px-3 py-1.5 text-xs outline-none w-48"
        style={{
          background: 'var(--forest)',
          border: '1px solid var(--forest-mid)',
          color: 'var(--cream)',
        }}
      />
      <button
        type="submit"
        className="rounded px-2.5 py-1.5 text-xs font-bold"
        style={{ background: 'var(--forest-mid)', color: 'var(--sage)', fontFamily: 'var(--font-josefin)' }}
      >
        Search
      </button>
      {current && (
        <a
          href={`?days=${days}${category ? `&category=${category}` : ''}`}
          className="text-xs"
          style={{ color: 'var(--text-muted)' }}
        >
          Clear
        </a>
      )}
    </form>
  );
}

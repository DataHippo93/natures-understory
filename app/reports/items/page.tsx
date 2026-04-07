import { Suspense } from 'react';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { LookbackFilter } from '@/components/lookback-filter';
import { SyncButton } from '@/components/sync-button';
import { ItemsTable } from '@/components/tables/items-table';

interface ItemRow {
  item_name: string;
  category_name: string | null;
  revenue: number;
  items_sold: number;
}

async function getItemData(days: number, categoryFilter: string | null): Promise<{ items: ItemRow[]; categories: string[] }> {
  const admin = createAdminClient();
  if (!admin) return { items: [], categories: [] };

  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - days);

  const startStr = start.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const endStr = end.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

  // Aggregate in SQL to avoid the 1000-row Supabase REST cap
  const categoryClause = categoryFilter
    ? `AND category_name = '${categoryFilter.replace(/'/g, "''")}'`
    : '';

  const sql = `
    SELECT
      COALESCE(item_name, 'Unknown') AS item_name,
      MAX(category_name) AS category_name,
      SUM(net_price_cents)::bigint AS total_cents,
      SUM(quantity) AS total_qty
    FROM sales_line_items
    WHERE sale_date >= '${startStr}' AND sale_date <= '${endStr}'
    ${categoryClause}
    GROUP BY COALESCE(item_name, 'Unknown')
    ORDER BY total_cents DESC
    LIMIT 500
  `;

  const catSql = `
    SELECT DISTINCT category_name
    FROM sales_line_items
    WHERE sale_date >= '${startStr}' AND sale_date <= '${endStr}'
      AND category_name IS NOT NULL
    ORDER BY category_name
  `;

  const [itemRes, catRes] = await Promise.all([
    admin.rpc('run_report_query', { query: sql }),
    admin.rpc('run_report_query', { query: catSql }),
  ]);

  if (itemRes.error || !itemRes.data) return { items: [], categories: [] };

  const agg = itemRes.data as Array<{ item_name: string; category_name: string | null; total_cents: number; total_qty: number }>;
  const items: ItemRow[] = agg.map((r) => ({
    item_name: r.item_name,
    category_name: r.category_name,
    revenue: (r.total_cents ?? 0) / 100,
    items_sold: Number(r.total_qty ?? 0),
  }));

  const categories = catRes.error || !catRes.data
    ? []
    : (catRes.data as Array<{ category_name: string }>).map((r) => r.category_name).sort();

  return { items, categories };
}

export default async function ItemSalesPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string; category?: string; search?: string }>;
}) {
  const params = await searchParams;
  const days = Math.min(365, Math.max(7, parseInt(params.days ?? '30') || 30));
  const categoryFilter = params.category ?? null;
  const searchFilter = (params.search ?? '').toLowerCase();

  const supabase = await createClient();
  const user = supabase ? (await supabase.auth.getUser()).data.user : null;

  const { items, categories } = user
    ? await getItemData(days, categoryFilter)
    : { items: [], categories: [] };

  const filtered = searchFilter
    ? items.filter((r) => r.item_name.toLowerCase().includes(searchFilter))
    : items;

  const totalRevenue = filtered.reduce((s, r) => s + r.revenue, 0);
  const totalItems = filtered.reduce((s, r) => s + r.items_sold, 0);

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold uppercase tracking-wider" style={{ fontFamily: 'var(--font-josefin)', color: 'var(--gold)' }}>
            Item Sales
          </h1>
          <p className="mt-0.5 text-sm" style={{ color: 'var(--sage)' }}>
            Top-selling individual items with revenue and quantity breakdown
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

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <CategoryFilter categories={categories} current={categoryFilter} days={days} search={params.search} />
        <SearchInput current={params.search ?? ''} days={days} category={categoryFilter} />
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg p-4" style={{ background: 'var(--forest)', border: '1px solid var(--forest-mid)' }}>
          <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-josefin)' }}>Revenue</p>
          <p className="mt-1 text-2xl font-bold" style={{ color: 'var(--cream)', fontFamily: 'var(--font-josefin)' }}>
            ${totalRevenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>last {days} days{categoryFilter ? ` · ${categoryFilter}` : ''}</p>
        </div>
        <div className="rounded-lg p-4" style={{ background: 'var(--forest)', border: '1px solid var(--forest-mid)' }}>
          <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-josefin)' }}>Items Sold</p>
          <p className="mt-1 text-2xl font-bold" style={{ color: 'var(--cream)', fontFamily: 'var(--font-josefin)' }}>
            {totalItems.toLocaleString()}
          </p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>units</p>
        </div>
        <div className="rounded-lg p-4" style={{ background: 'var(--forest)', border: '1px solid var(--forest-mid)' }}>
          <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-josefin)' }}>Unique Items</p>
          <p className="mt-1 text-2xl font-bold" style={{ color: 'var(--cream)', fontFamily: 'var(--font-josefin)' }}>
            {filtered.length.toLocaleString()}
          </p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{searchFilter ? 'matching search' : 'with sales'}</p>
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
              {items.length === 0 ? 'No data synced yet. Use Sync Clover to pull data.' : 'No items match your filters.'}
            </p>
          ) : (
            <Suspense>
              <ItemsTable rows={filtered.slice(0, 500)} />
            </Suspense>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function CategoryFilter({ categories, current, days, search }: { categories: string[]; current: string | null; days: number; search?: string }) {
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
        Category
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
      {categories.slice(0, 10).map((cat) => (
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

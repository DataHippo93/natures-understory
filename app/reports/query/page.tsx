import { Suspense } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { QueryInterface } from '@/components/query-interface';
import { SyncPanel } from '@/components/sync-panel';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

async function getSavedViews(userId: string) {
  const admin = createAdminClient();
  if (!admin) return [];
  const { data } = await admin
    .from('saved_views')
    .select('id, name, description, query_sql, is_shared, created_at')
    .or(`user_id.eq.${userId},is_shared.eq.true`)
    .order('created_at', { ascending: false })
    .limit(20);
  return data ?? [];
}

async function getDateRange() {
  const admin = createAdminClient();
  if (!admin) return { min: null, max: null };
  const { data } = await admin
    .from('sales_line_items')
    .select('sale_date')
    .order('sale_date', { ascending: true })
    .limit(1);
  const { data: maxData } = await admin
    .from('sales_line_items')
    .select('sale_date')
    .order('sale_date', { ascending: false })
    .limit(1);
  return {
    min: data?.[0]?.sale_date ?? null,
    max: maxData?.[0]?.sale_date ?? null,
  };
}

export default async function QueryPage() {
  const supabase = await createClient();
  const user = supabase ? (await supabase.auth.getUser()).data.user : null;

  const [savedViews, dateRange] = user
    ? await Promise.all([getSavedViews(user.id), getDateRange()])
    : [[], { min: null, max: null }];

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

  const defaultSql = `SELECT
  category_name,
  ROUND(SUM(net_price_cents) / 100.0, 2) AS revenue,
  SUM(quantity) AS units_sold,
  COUNT(*) AS line_items
FROM sales_line_items
WHERE sale_date BETWEEN '${thirtyDaysAgo}' AND '${today}'
GROUP BY category_name
ORDER BY revenue DESC`;

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold uppercase tracking-wider" style={{ fontFamily: 'var(--font-josefin)', color: 'var(--gold)' }}>
          Custom Query
        </h1>
        <p className="mt-0.5 text-sm" style={{ color: 'var(--sage)' }}>
          Build and run SQL queries against your sales data. Only SELECT queries are permitted.
        </p>
      </div>

      {/* Data info banner */}
      <div className="rounded-lg px-4 py-3 flex flex-wrap items-center gap-4" style={{ background: 'var(--forest)', border: '1px solid var(--forest-mid)' }}>
        <div>
          <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-josefin)' }}>
            Data Range:{' '}
          </span>
          <span className="text-xs" style={{ color: 'var(--cream)' }}>
            {dateRange.min && dateRange.max
              ? `${dateRange.min} → ${dateRange.max}`
              : 'No data synced yet'}
          </span>
        </div>
        <div>
          <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-josefin)' }}>
            Available Tables:{' '}
          </span>
          <span className="text-xs font-mono" style={{ color: 'var(--sage)' }}>
            sales_line_items, sales_categories, sales_items
          </span>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-4">
        {/* Saved views sidebar */}
        <div className="lg:col-span-1">
          <Card className="h-full">
            <CardHeader>
              <CardTitle>Saved Views</CardTitle>
              <CardDescription>{savedViews.length} view{savedViews.length !== 1 ? 's' : ''}</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {savedViews.length === 0 ? (
                <p className="px-5 pb-5 text-xs" style={{ color: 'var(--text-muted)' }}>
                  No saved views yet. Run a query and save it.
                </p>
              ) : (
                <ul className="divide-y" style={{ borderColor: 'var(--forest-mid)' }}>
                  {savedViews.map((v) => (
                    <li key={v.id} className="px-4 py-3">
                      <p className="text-xs font-semibold" style={{ color: 'var(--cream)' }}>{v.name}</p>
                      {v.description && (
                        <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{v.description}</p>
                      )}
                      {v.is_shared && (
                        <span className="mt-1 inline-block text-[10px] rounded px-1.5 py-0.5" style={{ background: 'rgba(196,146,58,0.15)', color: 'var(--gold)', fontFamily: 'var(--font-josefin)' }}>
                          Shared
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Query interface */}
        <div className="lg:col-span-3 space-y-4">
          <Suspense>
            <QueryInterface defaultSql={defaultSql} savedViews={savedViews} />
          </Suspense>

          {/* Sync panel */}
          <Card>
            <CardHeader>
              <CardTitle>Sync Data from Clover</CardTitle>
              <CardDescription>Pull fresh POS data into the database before running queries</CardDescription>
            </CardHeader>
            <CardContent>
              <Suspense>
                <SyncPanel />
              </Suspense>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Schema reference */}
      <Card>
        <CardHeader>
          <CardTitle>Schema Reference</CardTitle>
          <CardDescription>Available columns for queries</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-3 text-xs">
            {[
              {
                table: 'sales_line_items',
                columns: [
                  'id TEXT', 'order_id TEXT', 'item_id TEXT', 'item_name TEXT',
                  'category_id TEXT', 'category_name TEXT', 'quantity INTEGER',
                  'unit_price_cents INTEGER', 'discount_cents INTEGER',
                  'net_price_cents INTEGER', 'sale_date DATE', 'sale_hour SMALLINT',
                  'sale_ts TIMESTAMPTZ', 'pos_source TEXT',
                ],
              },
              {
                table: 'sales_categories',
                columns: ['id TEXT', 'name TEXT', 'pos_source TEXT', 'sort_order INTEGER'],
              },
              {
                table: 'sales_items',
                columns: [
                  'id TEXT', 'name TEXT', 'category_id TEXT', 'category_name TEXT',
                  'price_cents INTEGER', 'pos_source TEXT', 'active BOOLEAN',
                ],
              },
            ].map((t) => (
              <div key={t.table}>
                <p className="font-bold mb-2 font-mono" style={{ color: 'var(--gold)' }}>{t.table}</p>
                <ul className="space-y-0.5">
                  {t.columns.map((c) => (
                    <li key={c} className="font-mono" style={{ color: 'var(--sage)' }}>{c}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

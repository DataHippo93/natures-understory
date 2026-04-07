import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

async function getReportStats() {
  const admin = createAdminClient();
  if (!admin) return { totalRecords: 0, lastSync: null, recentSyncs: [] };

  const [countRes, syncRes] = await Promise.all([
    admin.from('sales_line_items').select('id', { count: 'exact', head: true }),
    admin.from('sync_log').select('*').order('started_at', { ascending: false }).limit(5),
  ]);

  return {
    totalRecords: countRes.count ?? 0,
    lastSync: syncRes.data?.[0] ?? null,
    recentSyncs: syncRes.data ?? [],
  };
}

export default async function ReportsPage() {
  const supabase = await createClient();
  const user = supabase ? (await supabase.auth.getUser()).data.user : null;

  const stats = user ? await getReportStats() : { totalRecords: 0, lastSync: null, recentSyncs: [] };

  const reportCards = [
    {
      href: '/reports/categories',
      title: 'Category Sales',
      description: 'Revenue and item count broken down by product category. Compare category performance over any date range.',
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-8 w-8">
          <path d="M18.375 2.25c-1.035 0-1.875.84-1.875 1.875v15.75c0 1.035.84 1.875 1.875 1.875h.75c1.035 0 1.875-.84 1.875-1.875V4.125c0-1.036-.84-1.875-1.875-1.875h-.75ZM9.75 8.625c0-1.036.84-1.875 1.875-1.875h.75c1.036 0 1.875.84 1.875 1.875v11.25c0 1.035-.84 1.875-1.875 1.875h-.75a1.875 1.875 0 0 1-1.875-1.875V8.625ZM3 13.125c0-1.036.84-1.875 1.875-1.875h.75c1.036 0 1.875.84 1.875 1.875v6.75c0 1.035-.84 1.875-1.875 1.875h-.75A1.875 1.875 0 0 1 3 19.875v-6.75Z" />
        </svg>
      ),
    },
    {
      href: '/reports/items',
      title: 'Item Sales',
      description: 'Top-selling individual items with revenue, quantity, and category breakdown. Filter by category.',
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-8 w-8">
          <path fillRule="evenodd" d="M5.25 2.25a3 3 0 0 0-3 3v4.318a3 3 0 0 0 .879 2.121l9.58 9.581c.92.92 2.39 1.186 3.548.428a18.849 18.849 0 0 0 5.441-5.44c.758-1.16.492-2.629-.428-3.548l-9.58-9.581a3 3 0 0 0-2.122-.879H5.25ZM6.375 7.5a1.125 1.125 0 1 0 0-2.25 1.125 1.125 0 0 0 0 2.25Z" clipRule="evenodd" />
        </svg>
      ),
    },
    {
      href: '/reports/query',
      title: 'Custom Query',
      description: 'Write SQL or use the visual builder to query sales data. Save and share custom views.',
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-8 w-8">
          <path fillRule="evenodd" d="M14.447 3.026a.75.75 0 0 1 .527.921l-4.5 16.5a.75.75 0 0 1-1.448-.394l4.5-16.5a.75.75 0 0 1 .921-.527ZM6.28 7.22a.75.75 0 0 1 0 1.06l-3.22 3.22 3.22 3.22a.75.75 0 0 1-1.06 1.06l-3.75-3.75a.75.75 0 0 1 0-1.06l3.75-3.75a.75.75 0 0 1 1.06 0Zm11.44 0a.75.75 0 0 1 1.06 0l3.75 3.75a.75.75 0 0 1 0 1.06l-3.75 3.75a.75.75 0 1 1-1.06-1.06l3.22-3.22-3.22-3.22a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
        </svg>
      ),
    },
  ];

  const lastSyncDate = stats.lastSync?.completed_at
    ? new Date(stats.lastSync.completed_at).toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' })
    : 'Never';

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold uppercase tracking-wider" style={{ fontFamily: 'var(--font-josefin)', color: 'var(--gold)' }}>
          Sales Reports
        </h1>
        <p className="mt-0.5 text-sm" style={{ color: 'var(--sage)' }}>
          Analyze revenue, categories, and item performance from Clover POS data
        </p>
      </div>

      {/* Quick stats */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg p-4" style={{ background: 'var(--forest)', border: '1px solid var(--forest-mid)' }}>
          <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-josefin)' }}>Total Line Items</p>
          <p className="mt-1 text-3xl font-bold" style={{ color: 'var(--cream)', fontFamily: 'var(--font-josefin)' }}>
            {stats.totalRecords.toLocaleString()}
          </p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>synced from Clover</p>
        </div>
        <div className="rounded-lg p-4" style={{ background: 'var(--forest)', border: '1px solid var(--forest-mid)' }}>
          <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-josefin)' }}>Last Sync</p>
          <p className="mt-1 text-sm font-semibold" style={{ color: 'var(--cream)', fontFamily: 'var(--font-josefin)' }}>
            {lastSyncDate}
          </p>
          <p className="text-xs" style={{ color: stats.lastSync?.error ? '#b06060' : 'var(--text-muted)' }}>
            {stats.lastSync?.error ? 'Sync error' : stats.lastSync ? `${stats.lastSync.records_synced} records` : 'No syncs yet'}
          </p>
        </div>
        <div className="rounded-lg p-4" style={{ background: 'var(--forest)', border: '1px solid var(--forest-mid)' }}>
          <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-josefin)' }}>Sync Data</p>
          <p className="text-xs mb-3" style={{ color: 'var(--sage)' }}>Pull fresh data from Clover POS into the database.</p>
          <Link
            href="/reports/query"
            className="inline-block rounded px-3 py-1.5 text-xs font-bold transition-colors"
            style={{ background: 'var(--gold)', color: 'var(--forest-darkest)', fontFamily: 'var(--font-josefin)' }}
          >
            Go to Sync &rarr;
          </Link>
        </div>
      </div>

      {/* Report type cards */}
      <div>
        <h2 className="mb-3 text-[11px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-josefin)' }}>
          Report Types
        </h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {reportCards.map((card) => (
            <Link key={card.href} href={card.href} className="block group">
              <Card
                className="h-full transition-all"
                style={{ borderColor: 'var(--forest-mid)' }}
              >
                <CardContent className="p-5">
                  <div className="mb-3" style={{ color: 'var(--gold)' }}>
                    {card.icon}
                  </div>
                  <CardTitle className="mb-1 text-sm">{card.title}</CardTitle>
                  <CardDescription className="text-xs leading-relaxed">
                    {card.description}
                  </CardDescription>
                  <div className="mt-4 text-xs font-semibold" style={{ color: 'var(--gold)', fontFamily: 'var(--font-josefin)' }}>
                    Open &rarr;
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>

      {/* Recent syncs */}
      {stats.recentSyncs.length > 0 && (
        <div>
          <h2 className="mb-3 text-[11px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-josefin)' }}>
            Recent Syncs
          </h2>
          <Card>
            <CardContent className="p-0">
              <table className="w-full text-xs">
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--forest-mid)' }}>
                    {['Type', 'Date Range', 'Records', 'Status', 'When'].map((h) => (
                      <th key={h} className="px-4 py-3 text-left font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-josefin)', fontSize: '10px' }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {stats.recentSyncs.map((s, i) => (
                    <tr key={s.id} style={{ borderBottom: i < stats.recentSyncs.length - 1 ? '1px solid var(--forest-mid)' : undefined }}>
                      <td className="px-4 py-3 font-medium" style={{ color: 'var(--cream)' }}>{s.sync_type}</td>
                      <td className="px-4 py-3" style={{ color: 'var(--sage)' }}>
                        {s.date_range_start && s.date_range_end ? `${s.date_range_start} → ${s.date_range_end}` : '—'}
                      </td>
                      <td className="px-4 py-3" style={{ color: 'var(--sage)' }}>{(s.records_synced ?? 0).toLocaleString()}</td>
                      <td className="px-4 py-3">
                        <span
                          className="rounded px-1.5 py-0.5 font-semibold"
                          style={{
                            background: s.error ? 'rgba(176,96,96,0.15)' : s.completed_at ? 'rgba(122,170,98,0.15)' : 'rgba(196,146,58,0.15)',
                            color: s.error ? '#b06060' : s.completed_at ? '#7aaa62' : '#c4923a',
                            fontSize: '10px',
                          }}
                        >
                          {s.error ? 'Error' : s.completed_at ? 'Done' : 'Running'}
                        </span>
                      </td>
                      <td className="px-4 py-3" style={{ color: 'var(--text-muted)' }}>
                        {new Date(s.started_at).toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'short', timeStyle: 'short' })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

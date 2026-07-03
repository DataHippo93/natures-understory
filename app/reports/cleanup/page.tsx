import { createClient } from '@/lib/supabase/server';
import { Page } from '@/components/ui/page';
import { getCleanupReport, type CleanupItem, type CleanupSection } from '@/lib/thrive';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

export const dynamic = 'force-dynamic';

function IssueTable({ items, detailLabel }: { items: CleanupItem[]; detailLabel: string | null }) {
  if (items.length === 0) {
    return (
      <p className="px-5 py-6 text-sm" style={{ color: '#7aaa62' }}>
        ✓ Nothing to fix — this list is clean.
      </p>
    );
  }
  const showCategories = items.some((it) => it.categories);
  const showDetail = items.some((it) => it.detail);
  return (
    <div className="overflow-x-auto" style={{ maxHeight: '480px', overflowY: 'auto' }}>
      <table className="w-full text-xs">
        <thead>
          <tr style={{ borderBottom: '1px solid var(--forest-mid)' }}>
            {['#', 'Item', 'SKU', 'Barcode',
              ...(showDetail ? [detailLabel ?? 'Detail'] : []),
              ...(showCategories ? ['Categories / Vendor'] : [])].map((h) => (
              <th key={h} className="px-4 py-3 text-left font-bold uppercase tracking-widest sticky top-0" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-josefin)', fontSize: '10px', background: 'var(--forest)' }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => (
            <tr key={`${it.name}-${it.sku ?? i}`} style={{ borderBottom: i < items.length - 1 ? '1px solid var(--forest-mid)' : undefined }}>
              <td className="px-4 py-2.5" style={{ color: 'var(--text-muted)' }}>{i + 1}</td>
              <td className="px-4 py-2.5 font-medium" style={{ color: 'var(--cream)' }}>{it.name}</td>
              <td className="px-4 py-2.5 font-mono" style={{ color: 'var(--sage)' }}>{it.sku ?? '—'}</td>
              <td className="px-4 py-2.5 font-mono" style={{ color: 'var(--sage)' }}>{it.barcode ?? '—'}</td>
              {showDetail && (
                <td className="px-4 py-2.5" style={{ color: '#c4923a' }}>{it.detail ?? '—'}</td>
              )}
              {showCategories && (
                <td className="px-4 py-2.5" style={{ color: 'var(--sage)' }}>{it.categories ?? '—'}</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function InventoryCleanupPage() {
  const supabase = await createClient();
  const user = supabase ? (await supabase.auth.getUser()).data.user : null;

  let sections: CleanupSection[] = [];
  let error: string | null = null;
  if (user) {
    try {
      sections = await getCleanupReport();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  const totalIssues = sections.reduce((s, x) => s + x.items.length, 0);

  return (
    <Page>
      <div>
        <h1 className="text-2xl font-bold uppercase tracking-wider" style={{ fontFamily: 'var(--font-josefin)', color: 'var(--gold)' }}>
          Inventory Cleanup
        </h1>
        <p className="mt-0.5 text-sm" style={{ color: 'var(--sage)' }}>
          Data problems in the Thrive catalog, ready to work through as lists ({totalIssues} total). Fix items at the source in Thrive — this report refreshes from the nightly catalog sync.
        </p>
      </div>

      {error && (
        <div className="rounded-lg px-4 py-3" style={{ background: 'rgba(176,96,96,0.10)', border: '1px solid rgba(176,96,96,0.35)' }}>
          <p className="text-sm font-bold" style={{ color: '#d96b6b', fontFamily: 'var(--font-josefin)' }}>Report couldn&apos;t load</p>
          <p className="mt-0.5 text-xs font-mono break-words" style={{ color: 'var(--text-muted)' }}>{error}</p>
        </div>
      )}

      {/* Summary cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {sections.map((s) => (
          <a key={s.key} href={`#${s.key}`} className="rounded-lg p-3 block" style={{ background: 'var(--forest)', border: '1px solid var(--forest-mid)' }}>
            <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-josefin)' }}>
              {s.title}
            </p>
            <p className="mt-1 text-xl font-bold" style={{ color: s.items.length === 0 ? '#7aaa62' : '#c4923a', fontFamily: 'var(--font-josefin)' }}>
              {s.items.length}
            </p>
          </a>
        ))}
      </div>

      {sections.map((s) => (
        <Card key={s.key} id={s.key}>
          <CardHeader>
            <CardTitle>{s.title} ({s.items.length})</CardTitle>
            <CardDescription>{s.description}</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <IssueTable items={s.items} detailLabel={s.detailLabel} />
          </CardContent>
        </Card>
      ))}
    </Page>
  );
}

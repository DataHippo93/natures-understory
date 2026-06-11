import { createClient } from '@/lib/supabase/server';
import { getCleanupReport, type CleanupItem, type CleanupReport } from '@/lib/thrive';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

export const dynamic = 'force-dynamic';

function IssueTable({ items, showCategories }: { items: CleanupItem[]; showCategories?: boolean }) {
  if (items.length === 0) {
    return (
      <p className="px-5 py-6 text-sm" style={{ color: '#7aaa62' }}>
        ✓ Nothing to fix — this list is clean.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr style={{ borderBottom: '1px solid var(--forest-mid)' }}>
            {['#', 'Item', 'SKU', 'Barcode', ...(showCategories ? ['Categories'] : [])].map((h) => (
              <th key={h} className="px-4 py-3 text-left font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-josefin)', fontSize: '10px' }}>
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
              {showCategories && (
                <td className="px-4 py-2.5" style={{ color: '#c4923a' }}>{it.categories ?? '—'}</td>
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

  let report: CleanupReport = { noVendor: [], conflictingCategories: [], noBarcode: [] };
  let error: string | null = null;
  if (user) {
    try {
      report = await getCleanupReport();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  const sections = [
    {
      key: 'vendors',
      title: 'No Vendor Configured',
      description:
        'Active items with no vendor in Thrive. These can’t be reordered through the PO flow and show a blank Brand on the Loss Tally sheet. Fix: open the item in Thrive → Vendors → add the supplier.',
      items: report.noVendor,
      showCategories: false,
    },
    {
      key: 'conflicts',
      title: 'Conflicting Categories',
      description:
        'Items in Produce AND Grocery/Supplements at the same time — these category pairs shouldn’t coexist and make department reporting ambiguous. (Grocery + Locally Made is fine and not flagged.) Fix: remove the wrong category in Thrive.',
      items: report.conflictingCategories,
      showCategories: true,
    },
    {
      key: 'barcodes',
      title: 'No Barcode',
      description:
        'Active items with no barcode. These can’t be scanned at the register and can’t be matched by the Clover loss-tally sync.',
      items: report.noBarcode,
      showCategories: false,
    },
  ];

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold uppercase tracking-wider" style={{ fontFamily: 'var(--font-josefin)', color: 'var(--gold)' }}>
          Inventory Cleanup
        </h1>
        <p className="mt-0.5 text-sm" style={{ color: 'var(--sage)' }}>
          Data problems in the Thrive catalog, ready to work through as lists. Fix items at the source in Thrive — this report refreshes from the nightly catalog sync.
        </p>
      </div>

      {error && (
        <div className="rounded-lg px-4 py-3" style={{ background: 'rgba(176,96,96,0.10)', border: '1px solid rgba(176,96,96,0.35)' }}>
          <p className="text-sm font-bold" style={{ color: '#d96b6b', fontFamily: 'var(--font-josefin)' }}>Report couldn&apos;t load</p>
          <p className="mt-0.5 text-xs font-mono break-words" style={{ color: 'var(--text-muted)' }}>{error}</p>
        </div>
      )}

      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        {sections.map((s) => (
          <a key={s.key} href={`#${s.key}`} className="rounded-lg p-4 block" style={{ background: 'var(--forest)', border: '1px solid var(--forest-mid)' }}>
            <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-josefin)' }}>
              {s.title}
            </p>
            <p className="mt-1 text-2xl font-bold" style={{ color: s.items.length === 0 ? '#7aaa62' : '#c4923a', fontFamily: 'var(--font-josefin)' }}>
              {s.items.length}
            </p>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{s.items.length === 0 ? 'clean' : 'items to fix'}</p>
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
            <IssueTable items={s.items} showCategories={s.showCategories} />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

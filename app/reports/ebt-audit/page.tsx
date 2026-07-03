import { createClient } from '@/lib/supabase/server';
import { Page } from '@/components/ui/page';
import { createAdminClient } from '@/lib/supabase/admin';
import { getEbtFlags, type EbtFlag } from '@/lib/thrive';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

export const dynamic = 'force-dynamic';

function money(n: number) { return `$${n.toFixed(2)}`; }
function fmtDate(d: string | null) {
  if (!d) return '—';
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default async function EbtAuditPage({
  searchParams,
}: { searchParams: Promise<{ days?: string }> }) {
  const params = await searchParams;
  const days = Math.min(120, Math.max(7, parseInt(params.days ?? '30') || 30));

  const supabase = await createClient();
  const user = supabase ? (await supabase.auth.getUser()).data.user : null;

  // Admin/GM only — this names individual employees.
  let authorized = false;
  if (user) {
    const admin = createAdminClient();
    if (admin) {
      const { data: p } = await admin.from('user_profiles').select('role').eq('id', user.id).single();
      authorized = !!p && ['admin', 'gm'].includes(p.role);
    }
  }

  if (!user) {
    return <div className="p-6 text-sm" style={{ color: 'var(--sage)' }}>Please sign in.</div>;
  }
  if (!authorized) {
    return (
      <div className="max-w-lg space-y-3">
        <h1 className="text-2xl font-bold uppercase tracking-wider" style={{ fontFamily: 'var(--font-josefin)', color: 'var(--gold)' }}>EBT Sale Audit</h1>
        <div className="rounded-lg px-4 py-3" style={{ background: 'rgba(176,96,96,0.10)', border: '1px solid rgba(176,96,96,0.35)' }}>
          <p className="text-sm" style={{ color: '#d96b6b' }}>This report is restricted to managers (Admin / GM).</p>
        </div>
      </div>
    );
  }

  let flags: EbtFlag[] = [];
  let error: string | null = null;
  try { flags = await getEbtFlags(days); }
  catch (e) { error = e instanceof Error ? e.message : String(e); }

  // By-cashier summary
  const byCashier = new Map<string, { count: number; amount: number }>();
  for (const f of flags) {
    const k = f.cashierName ?? 'Unknown';
    const cur = byCashier.get(k) ?? { count: 0, amount: 0 };
    cur.count += 1; cur.amount += f.amount;
    byCashier.set(k, cur);
  }
  const cashiers = [...byCashier.entries()].sort((a, b) => b[1].count - a[1].count);

  return (
    <Page>
      <div>
        <h1 className="text-2xl font-bold uppercase tracking-wider" style={{ fontFamily: 'var(--font-josefin)', color: 'var(--gold)' }}>
          EBT Sale Audit
        </h1>
        <p className="mt-0.5 text-sm" style={{ color: 'var(--sage)' }}>
          Items on EBT-tender orders that don&apos;t look SNAP-eligible (supplements, prepared hot foods,
          non-food merchandise). Use to coach the team member who rang it. <span style={{ color: 'var(--text-muted)' }}>
          Soda &amp; candy are SNAP-eligible and excluded. These are review candidates from an AI read of
          federal SNAP rules — confirm before acting; some &quot;prepared&quot; cold deli items are actually eligible.</span>
        </p>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-josefin)' }}>Window</span>
        {[7, 14, 30, 60, 90].map((d) => (
          <a key={d} href={`?days=${d}`} className="rounded px-2.5 py-1 text-xs font-semibold"
             style={{ background: d === days ? 'var(--gold)' : 'var(--forest-mid)', color: d === days ? 'var(--forest-darkest)' : 'var(--sage)', fontFamily: 'var(--font-josefin)' }}>
            {d}d
          </a>
        ))}
      </div>

      {error && (
        <div className="rounded-lg px-4 py-3" style={{ background: 'rgba(176,96,96,0.10)', border: '1px solid rgba(176,96,96,0.35)' }}>
          <p className="text-sm font-bold" style={{ color: '#d96b6b' }}>Report couldn&apos;t load</p>
          <p className="mt-0.5 text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{error}</p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg p-4" style={{ background: 'var(--forest)', border: '1px solid var(--forest-mid)' }}>
          <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-josefin)' }}>Flagged Lines</p>
          <p className="mt-1 text-2xl font-bold" style={{ color: '#c4923a', fontFamily: 'var(--font-josefin)' }}>{flags.length}</p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>last {days} days</p>
        </div>
        <div className="rounded-lg p-4" style={{ background: 'var(--forest)', border: '1px solid var(--forest-mid)' }}>
          <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-josefin)' }}>Cashiers Involved</p>
          <p className="mt-1 text-2xl font-bold" style={{ color: 'var(--cream)', fontFamily: 'var(--font-josefin)' }}>{cashiers.length}</p>
        </div>
        <div className="rounded-lg p-4" style={{ background: 'var(--forest)', border: '1px solid var(--forest-mid)' }}>
          <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-josefin)' }}>$ Flagged</p>
          <p className="mt-1 text-2xl font-bold" style={{ color: 'var(--cream)', fontFamily: 'var(--font-josefin)' }}>{money(flags.reduce((s, f) => s + f.amount, 0))}</p>
        </div>
      </div>

      {cashiers.length > 0 && (
        <Card>
          <CardHeader><CardTitle>By Cashier</CardTitle></CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-xs">
              <thead><tr style={{ borderBottom: '1px solid var(--forest-mid)' }}>
                {['Cashier', 'Flagged Lines', '$'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-josefin)', fontSize: '10px' }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {cashiers.map(([name, s]) => (
                  <tr key={name} style={{ borderBottom: '1px solid var(--forest-mid)' }}>
                    <td className="px-4 py-2.5 font-medium" style={{ color: 'var(--cream)' }}>{name}</td>
                    <td className="px-4 py-2.5" style={{ color: '#c4923a' }}>{s.count}</td>
                    <td className="px-4 py-2.5" style={{ color: 'var(--sage)' }}>{money(s.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Flagged Lines ({flags.length})</CardTitle>
          <CardDescription>Most recent first.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto" style={{ maxHeight: 560, overflowY: 'auto' }}>
            <table className="w-full text-xs">
              <thead><tr style={{ borderBottom: '1px solid var(--forest-mid)' }}>
                {['Date', 'Cashier', 'Item', 'Why', 'Conf', 'Amount'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left font-bold uppercase tracking-widest sticky top-0" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-josefin)', fontSize: '10px', background: 'var(--forest)' }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {flags.map((f, i) => (
                  <tr key={f.orderId + i} style={{ borderBottom: i < flags.length - 1 ? '1px solid var(--forest-mid)' : undefined }}>
                    <td className="px-4 py-2.5" style={{ color: 'var(--sage)' }}>{fmtDate(f.orderDate)}</td>
                    <td className="px-4 py-2.5 font-medium" style={{ color: 'var(--cream)' }}>{f.cashierName ?? '—'}</td>
                    <td className="px-4 py-2.5" style={{ color: 'var(--cream)' }}>{f.itemName ?? '—'}<span className="block text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>{f.upc ?? ''}</span></td>
                    <td className="px-4 py-2.5" style={{ color: '#c4923a' }}>{(f.aiClass ?? '').replace(/_/g, ' ')}</td>
                    <td className="px-4 py-2.5" style={{ color: 'var(--text-muted)' }}>{Math.round(f.aiConfidence * 100)}%</td>
                    <td className="px-4 py-2.5" style={{ color: 'var(--sage)' }}>{money(f.amount)}</td>
                  </tr>
                ))}
                {flags.length === 0 && !error && (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-sm" style={{ color: '#7aaa62' }}>✓ No flagged EBT sales in this window.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </Page>
  );
}

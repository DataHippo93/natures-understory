// /vendors/produce — Local produce vendor schedule + contact directory.
//
// Source of truth for "when do we order from whom". Reads from
// public.produce_vendors (migration 009). The Mon/Thu produce cron
// will eventually pull its schedule from this same table.
import { listProduceVendors, bucketVendors, type ProduceVendor } from '@/lib/produce-vendors';
import { createClient } from '@/lib/supabase/server';
import { Card, CardContent } from '@/components/ui/card';

export const dynamic = 'force-dynamic';

const WEEKDAY_SHORT: Record<string, string> = {
  monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed', thursday: 'Thu',
  friday: 'Fri', saturday: 'Sat', sunday: 'Sun',
};

function formatDays(days: string[]): string {
  if (!days || days.length === 0) return '—';
  return days.map((d) => WEEKDAY_SHORT[d.toLowerCase()] ?? d).join(' · ');
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function VendorCard({ v }: { v: ProduceVendor }) {
  const accent = v.next_order_date && v.order_days.length > 0
    ? (() => {
        const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
        return today === v.next_order_date ? 'var(--gold)' : 'var(--sage)';
      })()
    : 'var(--text-muted)';

  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h3 className="text-base font-bold uppercase tracking-wider" style={{ color: 'var(--cream)', fontFamily: 'var(--font-josefin)' }}>
              {v.display_name}
            </h3>
            {v.in_season ? null : (
              <span className="ml-2 inline-block rounded px-2 py-0.5 text-[10px] uppercase tracking-widest" style={{ background: 'rgba(176,96,96,0.15)', color: '#b06060' }}>
                out of season
              </span>
            )}
            {v.manual_only ? (
              <span className="ml-2 inline-block rounded px-2 py-0.5 text-[10px] uppercase tracking-widest" style={{ background: 'rgba(196,146,58,0.15)', color: 'var(--gold)' }}>
                manual only
              </span>
            ) : null}
          </div>
          <div className="text-right text-xs" style={{ color: accent }}>
            {v.next_order_date ? (
              <>
                <div className="font-bold uppercase tracking-widest" style={{ fontFamily: 'var(--font-josefin)', fontSize: '10px' }}>
                  Next order
                </div>
                <div className="text-sm">{formatDate(v.next_order_date)}{v.order_cutoff_time_et ? ` · by ${v.order_cutoff_time_et} ET` : ''}</div>
              </>
            ) : (
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>no recurring schedule</span>
            )}
          </div>
        </div>

        <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-2">
          <div>
            <dt className="font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-josefin)', fontSize: '10px' }}>Order days</dt>
            <dd style={{ color: 'var(--cream)' }}>{formatDays(v.order_days)}</dd>
          </div>
          <div>
            <dt className="font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-josefin)', fontSize: '10px' }}>Delivery</dt>
            <dd style={{ color: 'var(--cream)' }}>{formatDays(v.delivery_days)}{v.delivery_offset_days ? ` (+${v.delivery_offset_days}d)` : ''}</dd>
          </div>
          <div>
            <dt className="font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-josefin)', fontSize: '10px' }}>Contact</dt>
            <dd style={{ color: 'var(--cream)' }}>
              {v.contact_name ?? '—'}
              {v.contact_phone ? <> · <a href={`tel:${v.contact_phone}`} style={{ color: 'var(--gold)' }}>{v.contact_phone}</a></> : null}
              {v.contact_email ? <> · <a href={`mailto:${v.contact_email}`} style={{ color: 'var(--gold)' }}>{v.contact_email}</a></> : null}
              {v.gmail_label ? (
                <>
                  {' · '}
                  <a
                    href={`https://mail.google.com/mail/u/0/#label/${encodeURIComponent(v.gmail_label)}`}
                    target="_blank" rel="noopener noreferrer"
                    style={{ color: 'var(--gold)' }}
                  >
                    {v.gmail_label}
                  </a>
                </>
              ) : null}
            </dd>
          </div>
          <div>
            <dt className="font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-josefin)', fontSize: '10px' }}>Categories</dt>
            <dd style={{ color: 'var(--cream)' }}>{v.categories.length ? v.categories.join(', ') : '—'}</dd>
          </div>
          {v.notes ? (
            <div className="sm:col-span-2">
              <dt className="font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-josefin)', fontSize: '10px' }}>Notes</dt>
              <dd style={{ color: 'var(--sage)' }}>{v.notes}</dd>
            </div>
          ) : null}
        </dl>
      </CardContent>
    </Card>
  );
}

function Section({ title, vendors, accent }: { title: string; vendors: ProduceVendor[]; accent: string }) {
  if (vendors.length === 0) return null;
  return (
    <section>
      <h2 className="mb-3 text-xs font-bold uppercase tracking-widest" style={{ color: accent, fontFamily: 'var(--font-josefin)' }}>
        {title} · {vendors.length}
      </h2>
      <div className="grid gap-3">
        {vendors.map((v) => <VendorCard key={v.id} v={v} />)}
      </div>
    </section>
  );
}

export default async function VendorsProducePage() {
  const supabase = await createClient();
  const user = supabase ? (await supabase.auth.getUser()).data.user : null;
  if (!user) {
    return <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Sign in to view vendors.</p>;
  }
  const vendors = await listProduceVendors({ activeOnly: false });
  const buckets = bucketVendors(vendors);

  return (
    <div className="space-y-8 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold uppercase tracking-wider" style={{ fontFamily: 'var(--font-josefin)', color: 'var(--gold)' }}>
          Produce Vendors
        </h1>
        <p className="mt-0.5 text-sm" style={{ color: 'var(--sage)' }}>
          Source of truth for ordering schedule. The Mon/Thu produce cron reads this table.
        </p>
      </div>

      <Section title="Ordering today" vendors={buckets.today} accent="var(--gold)" />
      <Section title="Coming up (next 3 days)" vendors={buckets.soon} accent="var(--sage)" />
      <Section title="Later this week" vendors={buckets.later} accent="var(--sage)" />
      <Section title="Manual / no recurring schedule" vendors={buckets.manual} accent="var(--text-muted)" />
      <Section title="Inactive" vendors={buckets.inactive} accent="var(--text-muted)" />

      <p className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-josefin)' }}>
        {vendors.length} total · {buckets.today.length} ordering today · {buckets.soon.length + buckets.later.length} upcoming
      </p>
    </div>
  );
}

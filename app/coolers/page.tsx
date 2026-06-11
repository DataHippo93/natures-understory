import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getCoolerDashboard, OUT_OF_RANGE_ALERT_MINUTES, type CoolerStatus, type CoolerState } from '@/lib/coolers';
import { Card, CardContent } from '@/components/ui/card';
import { CoolerSparkline } from '@/components/charts/cooler-sparkline';

export const dynamic = 'force-dynamic';

const STATE_META: Record<CoolerState, { label: string; color: string; bg: string; border: string }> = {
  ok:        { label: 'In Range',     color: '#7aaa62', bg: 'rgba(122,170,98,0.12)',  border: 'rgba(122,170,98,0.4)' },
  warning:   { label: 'Out of Range', color: '#c4923a', bg: 'rgba(196,146,58,0.12)',  border: 'rgba(196,146,58,0.4)' },
  alert:     { label: 'ALERT',        color: '#d96b6b', bg: 'rgba(176,96,96,0.15)',   border: 'rgba(217,107,107,0.6)' },
  stale:     { label: 'No Signal',    color: '#8a8a8a', bg: 'rgba(138,138,138,0.10)', border: 'rgba(138,138,138,0.35)' },
  'no-data': { label: 'No Data',      color: '#8a8a8a', bg: 'rgba(138,138,138,0.10)', border: 'rgba(138,138,138,0.35)' },
};

function fmtTemp(t: number | null): string {
  return t == null ? '—' : `${t.toFixed(1)}°F`;
}

function fmtAgo(iso: string | null): string {
  if (!iso) return 'never';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m ago`;
}

function fmtDuration(mins: number): string {
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

export default async function CoolersPage() {
  const supabase = await createClient();
  const user = supabase ? (await supabase.auth.getUser()).data.user : null;
  if (!user) redirect('/login');

  const coolers = await getCoolerDashboard();

  const alerts = coolers.filter((c) => c.state === 'alert');
  const warnings = coolers.filter((c) => c.state === 'warning');
  const problems = coolers.filter((c) => c.state === 'stale' || c.state === 'no-data');
  const okCount = coolers.filter((c) => c.state === 'ok').length;

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold uppercase tracking-wider" style={{ fontFamily: 'var(--font-josefin)', color: 'var(--gold)' }}>
            Cooler Monitor
          </h1>
          <p className="mt-0.5 text-sm" style={{ color: 'var(--sage)' }}>
            Live temperatures from Home Assistant, polled every 5 minutes.
            Flagged when out of range {OUT_OF_RANGE_ALERT_MINUTES}+ minutes.
          </p>
        </div>
      </div>

      {/* Alert banner */}
      {alerts.length > 0 && (
        <div
          className="rounded-lg px-4 py-3"
          style={{ background: 'rgba(176,96,96,0.15)', border: '1px solid rgba(217,107,107,0.6)' }}
        >
          <p className="text-sm font-bold" style={{ color: '#d96b6b', fontFamily: 'var(--font-josefin)' }}>
            ⚠ {alerts.length} cooler{alerts.length > 1 ? 's' : ''} out of temp for {OUT_OF_RANGE_ALERT_MINUTES}+ minutes:
            {' '}{alerts.map((a) => a.config.display_name).join(', ')}
          </p>
          <p className="mt-0.5 text-xs" style={{ color: 'var(--sage)' }}>
            Check door seals, product blocking vents, and compressor operation. Move product if needed.
          </p>
        </div>
      )}

      {/* Summary strip */}
      <div className="grid gap-4 sm:grid-cols-4">
        {[
          { label: 'In Range', value: okCount, color: '#7aaa62' },
          { label: 'Excursions', value: warnings.length, color: '#c4923a' },
          { label: 'Alerts (30m+)', value: alerts.length, color: '#d96b6b' },
          { label: 'No Signal', value: problems.length, color: '#8a8a8a' },
        ].map((s) => (
          <div key={s.label} className="rounded-lg p-4" style={{ background: 'var(--forest)', border: '1px solid var(--forest-mid)' }}>
            <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-josefin)' }}>
              {s.label}
            </p>
            <p className="mt-1 text-3xl font-bold" style={{ color: s.color, fontFamily: 'var(--font-josefin)' }}>
              {s.value}
            </p>
          </div>
        ))}
      </div>

      {/* Cooler cards */}
      {coolers.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-sm" style={{ color: 'var(--cream)' }}>No cooler sensors registered yet.</p>
            <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
              Sensors are auto-discovered from Home Assistant on the next 5-minute poll.
              Anything with “cooler”, “freezer”, or “fridge” in its name will appear here automatically.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {coolers.map((c) => (
            <CoolerCard key={c.config.entity_id} cooler={c} />
          ))}
        </div>
      )}

      <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
        Acceptable ranges are per-cooler (FDA default 32–41°F for coolers, -20–5°F for freezers).
        To adjust a range or rename a sensor, edit the <span className="font-mono">cooler_config</span> table.
      </p>
    </div>
  );
}

function CoolerCard({ cooler }: { cooler: CoolerStatus }) {
  const meta = STATE_META[cooler.state];
  const { config } = cooler;

  return (
    <div
      className="rounded-lg p-4 space-y-3"
      style={{ background: 'var(--forest)', border: `1px solid ${cooler.state === 'alert' ? meta.border : 'var(--forest-mid)'}` }}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-bold" style={{ color: 'var(--cream)', fontFamily: 'var(--font-josefin)' }}>
            {config.display_name}
          </p>
          <p className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>{config.entity_id}</p>
        </div>
        <span
          className="rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest whitespace-nowrap"
          style={{ background: meta.bg, color: meta.color, border: `1px solid ${meta.border}`, fontFamily: 'var(--font-josefin)' }}
        >
          {meta.label}
        </span>
      </div>

      <div className="flex items-end justify-between">
        <p className="text-4xl font-bold" style={{ color: meta.color, fontFamily: 'var(--font-josefin)' }}>
          {fmtTemp(cooler.currentTemp)}
        </p>
        <div className="text-right">
          <p className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-josefin)' }}>
            Range
          </p>
          <p className="text-xs font-semibold" style={{ color: 'var(--sage)' }}>
            {Number(config.min_f).toFixed(0)}–{Number(config.max_f).toFixed(0)}°F
          </p>
        </div>
      </div>

      {(cooler.state === 'alert' || cooler.state === 'warning') && (
        <p className="text-xs font-semibold" style={{ color: meta.color }}>
          Out of range for {fmtDuration(cooler.outOfRangeMinutes)}
        </p>
      )}

      <CoolerSparkline
        readings={cooler.recentReadings.map((r) => ({ t: r.recorded_at, temp: r.temp_f }))}
        minF={Number(config.min_f)}
        maxF={Number(config.max_f)}
        color={meta.color}
      />

      <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
        Last reading {fmtAgo(cooler.lastReadingAt)} · 24h history
      </p>
    </div>
  );
}

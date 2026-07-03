'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceArea, ResponsiveContainer,
} from 'recharts';
import type { CoolerConfig } from '@/lib/coolers';
import type { Breach, ReadingAggregate } from '@/lib/cooler-drilldown';

interface SeriesPoint { t: string; temp: number; }

interface Props {
  config: CoolerConfig;
  currentTemp: number | null;
  lastIso: string | null;
  today: ReadingAggregate;
  yday: ReadingAggregate;
  lastWeek: ReadingAggregate;
  series24h: SeriesPoint[];
  series7d: SeriesPoint[];
  series30d: SeriesPoint[];
  breaches: Breach[];
}

const RANGES = [
  { key: '24h', label: '24h' },
  { key: '7d',  label: '7d'  },
  { key: '30d', label: '30d' },
] as const;
type RangeKey = typeof RANGES[number]['key'];

function statusFromTemp(t: number | null, config: CoolerConfig): { color: string; label: string } {
  if (t == null) return { color: '#8a8a8a', label: 'No Data' };
  const mn = Number(config.min_f);
  const mx = Number(config.max_f);
  if (t < mn || t > mx) return { color: '#d96b6b', label: 'Out of Range' };
  const slack = Math.min(2, (mx - mn) * 0.15);
  if (t < mn + slack || t > mx - slack) return { color: '#c4923a', label: 'Near Limit' };
  return { color: '#7aaa62', label: 'In Range' };
}

function fmtIsoShort(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
function fmtAgo(iso: string | null) {
  if (!iso) return 'never';
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  return `${Math.floor(m / 60)}h ${m % 60}m ago`;
}
function fmtDur(m:
  number): string {
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function AggregateBlock({ label, agg, safeMin, safeMax, comparison }: {
  label: string; agg: ReadingAggregate; safeMin: number; safeMax: number;
  comparison?: { avg: number | null };
}) {
  const avg = agg.avg;
  const haveComp = comparison && avg != null && comparison.avg != null;
  const delta = haveComp ? (avg! - comparison!.avg!) : null;
  const deltaColor = delta == null ? 'var(--text-muted)' : delta > 0.5 ? '#d96b6b' : delta < -0.5 ? '#84a8f0' : 'var(--sage)';
  const arrow = delta == null ? '' : delta > 0.5 ? '▲' : delta < -0.5 ? '▼' : '■';
  return (
    <div className="rounded-lg p-4" style={{ background: 'var(--forest)', border: '1px solid var(--forest-mid)' }}>
      <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-josefin)' }}>{label}</p>
      <p className="mt-1 text-3xl font-bold leading-none" style={{ color: 'var(--cream)', fontFamily: 'var(--font-josefin)' }}>
        {avg == null ? '—' : `${avg.toFixed(1)}°`}
        {avg != null && (
          <span className="ml-2 text-xs font-bold" style={{ color: deltaColor }}>
            {arrow} {delta == null ? '' : `${Math.abs(delta).toFixed(1)}°F`}
          </span>
        )}
      </p>
      <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
        {agg.count} readings{agg.min != null && agg.max != null ? ` · min ${agg.min.toFixed(0)} · max ${agg.max.toFixed(0)}` : ''}
      </p>
    </div>
  );
}

export function CoolerDrilldownClient(p: Props) {
  const [range, setRange] = useState<RangeKey>('24h');
  const status = statusFromTemp(p.currentTemp, p.config);
  const safeMin = Number(p.config.min_f);
  const safeMax = Number(p.config.max_f);

  const series = range === '24h' ? p.series24h : range === '7d' ? p.series7d : p.series30d;
  const tempValues = series.map((pt) => pt.temp);
  const yMin = Math.min(safeMin - 2, ...tempValues);
  const yMax = Math.max(safeMax + 2, ...tempValues);

  return (
    <>
      {/* Back + header */}
      <div className="flex items-center gap-3">
        <Link href="/coolers" className="u-tap-target flex items-center justify-center rounded-md"
          style={{ color: 'var(--sage)', border: '1px solid var(--forest-mid)' }} aria-label="Back to coolers">
          ←
        </Link>
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold uppercase tracking-wider break-words" style={{ fontFamily: 'var(--font-josefin)', color: 'var(--gold)' }}>
            {p.config.display_name}
          </h1>
          <p className="mt-0.5 text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{p.config.entity_id}</p>
        </div>
      </div>

      {/* Current-temp hero block */}
      <div className="rounded-lg p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
        style={{ background: 'var(--forest)', border: `1px solid ${status.color}` }}>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-josefin)' }}>Current</p>
          <p className="text-5xl sm:text-6xl font-bold leading-none" style={{ color: status.color, fontFamily: 'var(--font-josefin)' }}>
            {p.currentTemp == null ? '—' : `${p.currentTemp.toFixed(1)}°F`}
          </p>
          <p className="mt-1 text-xs" style={{ color: 'var(--sage)' }}>
            {status.label} · last reading {fmtAgo(p.lastIso)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-josefin)' }}>Safe Range</p>
          <p className="text-2xl font-bold" style={{ color: 'var(--cream)', fontFamily: 'var(--font-josefin)' }}>
            {safeMin.toFixed(0)}–{safeMax.toFixed(0)}°F
          </p>
        </div>
      </div>

      {/* Chart card with range chips */}
      <div className="rounded-lg" style={{ background: 'var(--forest)', border: '1px solid var(--forest-mid)' }}>
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4">
          <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--gold)', fontFamily: 'var(--font-josefin)' }}>Temp over time</p>
          <div className="flex gap-1">
            {RANGES.map(((r) => (
              <button key={r.key} type="button" onClick={() => setRange(r.key)}
                className="rounded px-3 py-2 text-xs font-bold uppercase tracking-widest transition-colors"
                style={{
                  background: range === r.key ? 'var(--gold)' : 'var(--forest-darkest)',
                  color: range === r.key ? 'var(--forest-darkest)' : 'var(--sage)',
                  border: `1px solid ${range === r.key ? 'var(--gold)' : 'var(--forest-mid)'}`,
                  fontFamily: 'var(--font-josefin)',
                }}>{r.label}</button>
            )))}
          </div>
        </div>
        <div className="p-2 sm:p-3" style={{ height: '40vh', minHeight: 240 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={series} margin={{ top: 5, right: 8, left: -20, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--forest-mid)" />
              <XAxis dataKey="t" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} hide />
              <YAxis domain={[yMin, yMax]} tick={{ fontSize: 10, fill: 'var(--text-muted)' }} unit="°" />
              <Tooltip contentStyle={{ background: 'var(--forest-darkest)', border: '1px solid var(--forest-mid)', fontSize: '12px' }}
                labelStyle={{ color: 'var(--cream)' }}
                formatter={((v: unknown) => [`${Number(v).toFixed(1)}°F`, 'Temp']) as never}
                labelFormatter={(l) => fmtIsoShort(String(l))} />
              {/* Safe-range shaded green, out-of-range implicit (paint the rest via boundary stripes) */}
              <ReferenceArea y1={yMin} y2={safeMin} fill="rgba(217,107,107,0.10)" strokeOpacity={0} />
              <ReferenceArea y1={safeMax} y2={yMax} fill="rgba(217,107,107,0.10)" strokeOpacity={0} />
              <ReferenceArea y1={safeMin} y2={safeMax} fill="rgba(122,170,98,0.10)" strokeOpacity={0} />
              <Line type="monotone" dataKey="temp" stroke={status.color} strokeWidth={2} dot={false} activeDot={{ r: 3}} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Comparison strip */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <AggregateBlock label="Today" agg={p.today} safeMin={safeMin} safeMax={safeMax} comparison={p.yday} />
        <AggregateBlock label="Yesterday" agg={p.yday} safeMin={safeMin} safeMax={safeMax} comparison={p.lastWeek} />
        <AggregateBlock label="Same day, last week" agg={p.lastWeek} safeMin={safeMin} safeMax={safeMax} />
      </div>

      {/* Alert history */}
      <div className="rounded-lg" style={{ background: 'var(--forest)', border: '1px solid var(--forest-mid)' }}>
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3" style={{ borderBottom: '1px solid var(--forest-mid)' }}>
          <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--gold)', fontFamily: 'var(--font-josefin)' }}>Alert history</p>
          <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>last 30 days · {p.breaches.length} event{p.breaches.length === 1 ? '' : 's'}</p>
        </div>
        {p.breaches.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm" style={{ color: 'var(--sage)' }}>
            ✓ No out-of-range excursions in the last 30 days.
          </p>
        ) : (
          <ul className="divide-y" style={{ borderColor: 'var(--forest-mid)' }}>
            {p.breaches.map((b, i) => (
              <li key={i} className="px-4 py-3 flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold" style={{ color: 'var(--cream)' }}>
                    {fmtIsoShort(b.start)}
                  </p>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {fmtDur(b.durationMinutes)} · min {b.minTemp.toFixed(1)}°, max {b.maxTemp.toFixed(1)}° {b.recovered ? '· recovered' : '· not recovered'}
                  </p>
                </div>
                <span className="rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest"
                  style={{ background: b.recovered ? 'rgba(122,170,98,0.15)' : 'rgba(217,107,107,0.15)', color: b.recovered ? '#7aaa62' : '#d96b6b', fontFamily: 'var(--font-josefin)' }}>
                  {b.recovered ? 'Recovered' : 'Ongoing'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Metadata strip */}
      <div className="rounded-lg p-4 text-xs"
        style={{ background: 'var(--forest)', border: '1px solid var(--forest-mid)', color: 'var(--text-muted)' }}>
        <p className="uppercase tracking-widest font-bold text-[10px] mb-2" style={{ color: 'var(--gold)', fontFamily: 'var(--font-josefin)' }}>Device</p>
        <dl className="grid grid-cols-1 sm:grid-cols-3 gap-col-6 gap-row-1">
          <div><dt className="text-[9px] uppercase tracking-widest">Entity</dt><dd className="font-mono break-all" style={{ color: 'var(--cream)' }}>{p.config.entity_id}</dd></div>
          <div><dt className="text-[9px] uppercase tracking-widest">Safe range</dt><dd style={{ color: 'var(--cream)' }}>{safeMin.toFixed(1)}°-–{safeMax.toFixed(1)}°F</dd></div>
          <div><dt className="text-[9px] uppercase tracking-widest">Sort order</dt><dd style={{ color: 'var(--cream)' }}>{p.config.sort_order}</dd></div>
        </dl>
        <p className="mt-3 text-[10px]">
          To adjust the safe range or rename the sensor, edit the <code>cooler_config</code> table in Supabase.
        </p>
      </div>
    </>
  );
}

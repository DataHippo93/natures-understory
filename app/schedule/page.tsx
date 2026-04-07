import { Suspense } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { getRosterData } from '@/lib/data';
import { formatCurrency } from '@/lib/utils';
import type { RosterDay } from '@/lib/types';
import { ScheduleDatePicker } from '@/components/schedule-date-picker';

function formatShiftTime(isoStr: string): string {
  return new Date(isoStr).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'America/New_York',
  });
}

function HoursDisplay({ entry }: { entry: RosterDay['categories'][0]['entries'][0] }) {
  if (entry.isActual) {
    if (entry.clockedIn) {
      return (
        <span className="text-xs font-semibold" style={{ color: '#7aaa62' }}>
          Clocked in
        </span>
      );
    }
    return (
      <span className="text-xs">
        <span style={{ color: '#7aaa62' }}>{entry.actualHours?.toFixed(1)}h</span>
        <span className="ml-1 text-[10px]" style={{ color: 'var(--text-muted)' }}>actual</span>
      </span>
    );
  }
  return (
    <span className="text-xs">
      <span style={{ color: 'var(--cream)' }}>{entry.scheduledHours.toFixed(1)}h</span>
      <span className="ml-1 text-[10px]" style={{ color: 'var(--text-muted)' }}>scheduled</span>
    </span>
  );
}

const categoryColors: Record<string, { text: string; bg: string; border: string }> = {
  'Front End':  { text: '#7aaa62', bg: 'rgba(122,170,98,0.12)', border: 'rgba(122,170,98,0.3)' },
  'Office':     { text: '#c4923a', bg: 'rgba(196,146,58,0.12)', border: 'rgba(196,146,58,0.3)' },
  'Kitchen':    { text: '#b06060', bg: 'rgba(176,96,96,0.12)',  border: 'rgba(176,96,96,0.3)' },
  'Deli':       { text: '#b06060', bg: 'rgba(176,96,96,0.12)',  border: 'rgba(176,96,96,0.3)' },
  'Produce':    { text: '#8fa872', bg: 'rgba(143,168,114,0.12)', border: 'rgba(143,168,114,0.3)' },
  'GM Work':    { text: '#c4923a', bg: 'rgba(196,146,58,0.12)', border: 'rgba(196,146,58,0.3)' },
  'General':    { text: '#a8956e', bg: 'rgba(168,149,110,0.12)', border: 'rgba(168,149,110,0.3)' },
};

function categoryColor(name: string) {
  return categoryColors[name] ?? { text: '#a8956e', bg: 'rgba(168,149,110,0.12)', border: 'rgba(168,149,110,0.3)' };
}

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const params = await searchParams;
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const date = params.date ?? today;

  let roster: RosterDay | null = null;
  let error: string | null = null;

  try {
    roster = await getRosterData(date);
  } catch (err) {
    error = err instanceof Error ? err.message : 'Failed to load schedule';
  }

  const displayDate = new Date(date + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold uppercase tracking-wider" style={{ fontFamily: 'var(--font-josefin)', color: 'var(--gold)' }}>
            Schedule
          </h1>
          <p className="mt-0.5 text-sm" style={{ color: 'var(--sage)' }}>
            {displayDate}
          </p>
        </div>
        <Suspense>
          <ScheduleDatePicker current={date} today={today} />
        </Suspense>
      </div>

      {error && (
        <div className="rounded-lg px-4 py-3 text-sm" style={{ background: 'rgba(176,96,96,0.12)', border: '1px solid rgba(176,96,96,0.3)', color: '#b06060' }}>
          {error}
        </div>
      )}

      {roster && (
        <>
          {/* Summary stats */}
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-lg p-4" style={{ background: 'var(--forest)', border: '1px solid var(--forest-mid)' }}>
              <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--sage)', fontFamily: 'var(--font-josefin)' }}>Total Headcount</p>
              <p className="mt-1 text-3xl font-bold" style={{ color: 'var(--cream)', fontFamily: 'var(--font-josefin)' }}>
                {roster.categories.reduce((s, c) => s + c.entries.length, 0)}
              </p>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {roster.categories.length} {roster.categories.length === 1 ? 'department' : 'departments'}
              </p>
            </div>
            <div className="rounded-lg p-4" style={{ background: 'var(--forest)', border: '1px solid var(--forest-mid)' }}>
              <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--sage)', fontFamily: 'var(--font-josefin)' }}>Scheduled Hours</p>
              <p className="mt-1 text-3xl font-bold" style={{ color: 'var(--cream)', fontFamily: 'var(--font-josefin)' }}>
                {roster.totalScheduledHours.toFixed(1)}h
              </p>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {roster.totalActualHours > 0 ? `${roster.totalActualHours.toFixed(1)}h actual` : 'no clocked hours yet'}
              </p>
            </div>
            <div className="rounded-lg p-4" style={{ background: 'var(--forest)', border: '1px solid var(--forest-mid)' }}>
              <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--sage)', fontFamily: 'var(--font-josefin)' }}>Scheduled Labor Cost</p>
              <p className="mt-1 text-3xl font-bold" style={{ color: '#c4923a', fontFamily: 'var(--font-josefin)' }}>
                {formatCurrency(roster.totalScheduledCost)}
              </p>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>wages only, pre-load</p>
            </div>
          </div>

          {/* Category sections */}
          {roster.categories.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center">
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No scheduled shifts found for this date.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {roster.categories.map((cat) => {
                const cc = categoryColor(cat.name);
                const catHours = cat.entries.reduce((s, e) => s + e.scheduledHours, 0);
                const catActual = cat.entries.reduce((s, e) => s + (e.actualHours ?? 0), 0);
                return (
                  <Card key={cat.name}>
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <span
                            className="rounded-md px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest"
                            style={{ background: cc.bg, color: cc.text, border: `1px solid ${cc.border}` }}
                          >
                            {cat.name}
                          </span>
                          <CardTitle style={{ color: 'var(--cream)' }}>
                            {cat.entries.length} {cat.entries.length === 1 ? 'person' : 'people'}
                          </CardTitle>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-semibold" style={{ color: 'var(--cream)' }}>
                            {catHours.toFixed(1)}h scheduled
                          </p>
                          {catActual > 0 && (
                            <p className="text-xs" style={{ color: '#7aaa62' }}>
                              {catActual.toFixed(1)}h actual
                            </p>
                          )}
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <table className="min-w-full text-sm">
                        <thead>
                          <tr style={{ borderBottom: '1px solid var(--forest-mid)' }}>
                            {['Name', 'Shift', 'Duration', 'Hours'].map((h, i) => (
                              <th
                                key={h}
                                className={`pb-2 text-[10px] font-bold uppercase tracking-widest ${i > 0 ? 'text-right' : 'text-left'}`}
                                style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-josefin)' }}
                              >
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {cat.entries.map((entry, i) => (
                            <tr
                              key={`${entry.employeeName}-${entry.shiftStart}`}
                              style={{ borderBottom: i < cat.entries.length - 1 ? '1px solid var(--forest-mid)' : 'none' }}
                              onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = 'var(--forest-hover)')}
                              onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'transparent')}
                            >
                              <td className="py-2.5 font-medium" style={{ color: 'var(--cream)' }}>
                                {entry.employeeName}
                                {entry.isActual && (
                                  <span
                                    className="ml-2 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase"
                                    style={{ background: 'rgba(122,170,98,0.15)', color: '#7aaa62', border: '1px solid rgba(122,170,98,0.3)' }}
                                  >
                                    {entry.clockedIn ? 'on shift' : 'clocked out'}
                                  </span>
                                )}
                              </td>
                              <td className="py-2.5 text-right text-xs" style={{ color: 'var(--sage)' }}>
                                {formatShiftTime(entry.shiftStart)} – {formatShiftTime(entry.shiftEnd)}
                              </td>
                              <td className="py-2.5 text-right text-xs" style={{ color: 'var(--text-muted)' }}>
                                {entry.scheduledHours.toFixed(1)}h
                              </td>
                              <td className="py-2.5 text-right">
                                <HoursDisplay entry={entry} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

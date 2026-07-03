import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { Page } from '@/components/ui/page';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type { CoolerConfig, CoolerReading } from '@/lib/coolers';
import {
  aggregate,
  bucketAverages,
  computeBreaches,
  nyIsoDate,
  readingsBetween,
} from '@/lib/cooler-drilldown';
import { CoolerDrilldownClient } from './client';

export const dynamic = 'force-dynamic';

export default async function CoolerDrilldownPage({
  params,
}: {
  params: Promise<{ entityId: string }>;
}) {
  const supabase = await createClient();
  const user = supabase ? (await supabase.auth.getUser()).data.user : null;
  if (!user) redirect('/login');

  const { entityId: slug } = await params;
  const entityId = decodeURIComponent(slug);

  const admin = createAdminClient();
  if (!admin) throw new Error('Supabase admin client not configured');

  // Fetch config + 30 days of readings in parallel.
  const windowStart = new Date(Date.now() - 30 * 24 * 3_600_000);
  const [cfgRes, readRes] = await Promise.all([
    admin.from('cooler_config').select('*').eq('entity_id', entityId).maybeSingle(),
    admin
      .from('cooler_readings')
      .select('entity_id, temp_f, in_range, recorded_at')
      .eq('entity_id', entityId)
      .gte('recorded_at', windowStart.toISOString())
      .order('recorded_at', { ascending: true })
      .limit(15000),
  ]);

  if (cfgRes.error) throw new Error(`cooler_config: ${cfgRes.error.message}`);
  if (!cfgRes.data) notFound();
  if (readRes.error) throw new Error(`cooler_readings: ${readRes.error.message}`);

  const config: CoolerConfig = {
    ...(cfgRes.data as CoolerConfig),
    min_f: Number((cfgRes.data as CoolerConfig).min_f),
    max_f: Number((cfgRes.data as CoolerConfig).max_f),
  };
  const readings: CoolerReading[] = (readRes.data as CoolerReading[]).map((r) => ({
    ...r,
    temp_f: Number(r.temp_f),
  }));

  // --- Comparison windows (New York calendar days) ---
  const now = new Date();
  const todayIso = nyIsoDate(now);
  const ydayIso = nyIsoDate(new Date(now.getTime() - 24 * 3_600_000));
  const lastWeekIso = nyIsoDate(new Date(now.getTime() - 7 * 24 * 3_600_000));

  function nYDayBounds(iso: string): { start: Date; end: Date } {
    // Construct the boundary at NY midnight. Using a rough offset of -5h
    // would be wrong across DST; instead we generate the boundary string
    // and rely on the engine to interpret it as NY time via the offset.
    // Shortcut: use 12:00 UTC of that calendar day and shift back by 12 h
    // to land within NY midnight regardless of DST. Then round to the NY
    // calendar day.
    const base = new Date(iso + 'T05:00:00Z'); // crude but safe for this computation
    // Find start-of-day NY-relative by scanning backward until the NY iso
    // label changes. This runs a few iterations at most.
    let start = base;
    while (nyIsoDate(new Date(start.getTime() - 1)) === iso) {
      start = new Date(start.getTime() - 60 * 60_000);
    }
    let end = base;
    while (nyIsoDate(end) === iso) {
      end = new Date(end.getTime() + 60 * 60_000);
    }
    return { start, end };
  }

  const today = aggregate(
    readingsBetween(readings, nYDayBounds(todayIso).start, now),
  );
  const yday = aggregate(
    readingsBetween(readings, nYDayBounds(ydayIso).start, nYDayBounds(ydayIso).end),
  );
  const lastWeek = aggregate(
    readingsBetween(readings, nYDayBounds(lastWeekIso).start, nYDayBounds(lastWeekIso).end),
  );

  // --- Chart series (three pre-computed views) ---
  const win24h = new Date(now.getTime() - 24 * 3_600_000);
  const win7d = new Date(now.getTime() - 7 * 24 * 3_600_000);
  const series24h = readingsBetween(readings, win24h, now).map(r => ({ t: r.recorded_at, temp: r.temp_f }));
  const series7d = bucketAverages(readingsBetween(readings, win7d, now), 60);   // hourly
  const series30d = bucketAverages(readings, 6 * 60);  // 6-hour over full 30d

  // --- Breaches (last 30d) ---
  const breaches = computeBreaches(readings);

  // --- Current status for header ---
  const last = readings[readings.length - 1] ?? null;
  const currentTemp = last ? Number(last.temp_f) : null;
  const lastIso = last?.recorded_at ?? null;

  return (
    <Page maxWidth="5xl">
      <CoolerDrilldownClient
        config={config}
        currentTemp={currentTemp}
        lastIso={lastIso}
        today={today}
        yday={yday}
        lastWeek={lastWeek}
        series24h={series24h}
        series7d={series7d}
        series30d={series30d}
        breaches={breaches}
      />
    </Page>
  );
}

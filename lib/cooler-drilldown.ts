// Server-side aggregation helpers for the /coolers/[id] drill-down.
// Kept in its own file so it remains easily unit-testable.
import type { CoolerReading } from './coolers';

export interface ReadingAggregate {
  count: number;
  avg: number | null;
  min: number | null;
  max: number | null;
}

export interface Breach {
  start: string;  // ISO
  end: string;    // ISO
  durationMinutes: number;
  minTemp: number;
  maxTemp: number;
  recovered: boolean;
  readingCount: number;
}

/**
 * YYYY-MM-DD. All our dates are New York time for user-visible comparisons
 * (Canton, NY -- store locale).
 */
export function nyIsoDate(d: Date): string {
  return d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

export function aggregate(readings: CoolerReading[]): ReadingAggregate {
  if (readings.length === 0) return { count: 0, avg: null, min: null, max: null };
  let sum = 0;
  let mx = -Infinity;
  let mn = Infinity;
  for (const r of readings) {
    const t = Number(r.temp_f);
    sum += t;
    if (t > mx) mx = t;
    if (t < mn) mn = t;
  }
  return {
    count: readings.length,
    avg: Math.round((sum / readings.length) * 10) / 10,
    min: Math.round(mn * 10) / 10,
    max: Math.round(mx * 10) / 10,
  };
}

export function readingsBetween(
  readings: CoolerReading[],
  start: Date,
  end: Date,
): CoolerReading[] {
  const s = start.getTime();
  const e = end.getTime();
  return readings.filter((r => {
    const t = new Date(r.recorded_at).getTime();
    return t >= s && t < e;
  }));
}

/**
 * Bucket readings by a time interval (in minutes) and return avg per bucket.
 * Used to smooth the 7d and 30d views so the chart stays readable.
 */
export function bucketAverages(
  readings: CoolerReading[],
  bucketMinutes: number,
): Array<{ t: string; temp: number }> {
  if (readings.length === 0) return [];
  const bucketMs = bucketMinutes * 60_000;
  const buckets = new Map<number, { sum: number; count: number }>();
  for (const r of readings) {
    const t = new Date(r.recorded_at).getTime();
    const bucket = Math.floor(t / bucketMs) * bucketMs;
    const existing = buckets.get(bucket) ?? { sum: 0, count: 0 };
    existing.sum += Number(r.temp_f);
    existing.count += 1;
    buckets.set(bucket, existing);
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, v]) => ({ t: new Date(t).toISOString(), temp: Math.round((v.sum / v.count) * 10) / 10 }));
}

/**
 * Walk a series of readings and return every contiguous out-of-range
 * stretch. A breach is closed (recovered) when we see an in-range reading;
 * a breach that spans the final reading is not recovered.
 *
 * `readings` must be ascending by `recorded_at`.
 */
export function computeBreaches(readings: CoolerReading[]): Breach[] {
  const out: Breach[] = [];
  let start: string | null = null;
  let startIx: number = -1;
  let mx: number = -Infinity;
  let mn: number = Infinity;
  let lastT: string | null = null;
  for (let i = 0; i < readings.length; i++) {
    const r = readings[i];
    const t = Number(r.temp_f);
    if (!r.in_range) {
      if (start === null) {
        start = r.recorded_at;
        startIx = i;
        mx = t;
        mn = t;
      } else {
        if (t > mx) mx = t;
        if (t < mn) mn = t;
      }
      lastT = r.recorded_at;
    } else if (start !== null) {
      const endIso = r.recorded_at;
      const dur = Math.round(
        (new Date(endIso).getTime() - new Date(start).getTime()) / 60_000,
      );
      out.push({
        start,
        end: endIso,
        durationMinutes: dur,
        minTemp: Math.round(mn * 10) / 10,
        maxTemp: Math.round(mx * 10) / 10,
        recovered: true,
        readingCount: i - startIx,
      });
      start = null;
      startIx = -1;
      mx = -Infinity;
      mn = Infinity;
    }
  }
  if (start !== null && lastT) {
    const dur = Math.round(
      (new Date(lastT).getTime() - new Date(start).getTime()) / 60_000,
    );
    out.push({
      start,
      end: lastT,
      durationMinutes: dur,
      minTemp: Math.round(mn * 10) / 10,
      maxTemp: Math.round(mx * 10) / 10,
      recovered: false,
      readingCount: readings.length - startIx,
    });
  }
  // Newest first for the UI list.
  return out.reverse();
}

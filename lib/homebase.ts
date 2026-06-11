// Homebase labor data — Supabase-backed reader.
//
// Previously this module called the Homebase REST API on every request
// (`fetchTimecards` / `fetchShifts`). The `homebase-pipeline` Vercel
// project now syncs labor data into the natures-understory Supabase
// project on schedule (every 6h for shifts/timecards, daily for the
// pre-aggregated labor table), so the app reads from the warehouse
// instead.
//
// Tables this module reads from (all in the `public` schema of the
// natures-understory Supabase project, populated by homebase-pipeline):
//   - homebase_shifts_worked      (timecards: actual clock-in/out)
//   - homebase_shifts_scheduled   (upcoming + past scheduled shifts)
//   - homebase_employees          (full_name lookup)
//
// Compatibility notes:
//   - Same exported types (`Timecard`, `ScheduledShift`) and function
//     signatures (`fetchTimecards(startISO, endISO)` /
//     `fetchShifts(startISO, endISO)`) so call sites in `lib/data.ts`
//     don't change.
//   - Date filter uses `(timestamp AT TIME ZONE 'America/New_York')::date`
//     to match the original Homebase API behavior (which filtered by
//     local-store dates).
//   - All money fields in Supabase are integer cents; we divide by 100
//     for the dollar-shaped fields the UI expects.
//   - Open clock-ins (clock_in IS NOT NULL AND clock_out IS NULL) are
//     intentionally absent — the cron skips them. They reappear once
//     the shift closes. If the UI ever needs "who's clocked in right
//     now", that's a separate live-API route by design.
//
// Failure mode: if Supabase is not configured (SERVICE_ROLE_KEY
// missing), `fetchTimecards` / `fetchShifts` return [] rather than
// throwing — matches the pre-existing demo-mode fallback in
// `lib/data.ts` (which already catches errors and falls back to demo
// data).

import { createAdminClient } from '@/lib/supabase/admin';

export interface Timecard {
  id: string;
  date: string; // YYYY-MM-DD (clock_in date in America/New_York)
  clockedInAt: string; // ISO8601
  clockedOutAt: string; // ISO8601
  regularHours: number;
  overtimeHours: number;
  totalCost: number; // dollars (nominal, not loaded)
  employeeName: string;
}

export interface ScheduledShift {
  id: string;
  date: string; // YYYY-MM-DD (start_at date in America/New_York)
  startAt: string; // ISO8601
  endAt: string; // ISO8601
  scheduledHours: number;
  scheduledCost: number; // dollars
  employeeName: string;
  department: string;
  wageRate: number; // dollars per hour
}

const NY_TZ = 'America/New_York';

/** Convert a YYYY-MM-DD store-local date string to a UTC ISO timestamp
 *  representing midnight in `America/New_York` on that date. We cannot
 *  build a Date from "2026-04-01" because JS would treat it as UTC; we
 *  need to find the right offset (EDT vs EST) for that specific date. */
function nyMidnightUTC(dateStr: string): Date {
  // dateStr is YYYY-MM-DD. Treat it as midnight NY-local and ask the
  // Intl machinery what UTC instant that maps to.
  const [y, m, d] = dateStr.split('-').map((s) => parseInt(s, 10));
  // Start with a guess in UTC, then bisect by checking what NY thinks
  // the local date is.
  for (const offsetH of [4, 5]) {
    // EDT=-4, EST=-5; one of these will produce midnight NY for this date.
    const candidate = new Date(Date.UTC(y, m - 1, d, offsetH, 0, 0, 0));
    const localDate = candidate.toLocaleDateString('en-CA', { timeZone: NY_TZ });
    if (localDate === dateStr) return candidate;
  }
  // Fallback (should never hit) — naive UTC midnight.
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
}

/** Build an inclusive [startDate, endDate] timestamptz range covering
 *  store-local-midnight on startDate to store-local-midnight on the day
 *  after endDate. Used so `clock_in >= rangeStart && clock_in < rangeEnd`
 *  matches Homebase's local-date filtering exactly. */
function nyDayRange(startDate: string, endDate: string): { startUTC: string; endUTC: string } {
  const startUTC = nyMidnightUTC(startDate).toISOString();
  // endUTC is exclusive — midnight NY on (endDate + 1 day).
  // Date arithmetic only: converting Date.UTC(y,m,d+1) through the NY
  // timezone lands at 7/8pm the PREVIOUS evening, which collapsed the end
  // date back onto endDate (single-day ranges became empty, multi-day
  // ranges silently lost their last day). Use noon UTC so the calendar
  // rollover is timezone-safe, then take the ISO date directly.
  const [y, m, d] = endDate.split('-').map((s) => parseInt(s, 10));
  const endPlus1 = new Date(Date.UTC(y, m - 1, d + 1, 12));
  const endStr = endPlus1.toISOString().slice(0, 10);
  const endUTC = nyMidnightUTC(endStr).toISOString();
  return { startUTC, endUTC };
}

/** YYYY-MM-DD in `America/New_York` for a UTC ISO timestamp. */
function nyDateOf(utcIso: string): string {
  return new Date(utcIso).toLocaleDateString('en-CA', { timeZone: NY_TZ });
}

export async function fetchTimecards(
  startDate: string,
  endDate: string
): Promise<Timecard[]> {
  const supabase = createAdminClient();
  if (!supabase) return [];

  const { startUTC, endUTC } = nyDayRange(startDate, endDate);

  const { data, error } = await supabase
    .from('homebase_shifts_worked')
    .select(
      `hb_timecard_id, hb_employee_id, role, department,
       clock_in, clock_out, regular_hours, paid_hours, overtime_hours,
       total_cost_cents, wage_rate_cents, approved,
       employee:homebase_employees!hb_employee_id (full_name, first_name, last_name)`
    )
    .gte('clock_in', startUTC)
    .lt('clock_in', endUTC)
    .not('clock_out', 'is', null)
    .order('clock_in', { ascending: true });

  if (error) {
    throw new Error(`Supabase homebase_shifts_worked: ${error.message}`);
  }

  type Row = {
    hb_timecard_id: number | string;
    clock_in: string;
    clock_out: string | null;
    regular_hours: number | string | null;
    paid_hours: number | string | null;
    overtime_hours: number | string | null;
    total_cost_cents: number | null;
    employee?:
      | { full_name?: string | null; first_name?: string | null; last_name?: string | null }
      | Array<{ full_name?: string | null; first_name?: string | null; last_name?: string | null }>
      | null;
  };

  const employeeName = (e: Row['employee']): string => {
    const first = Array.isArray(e) ? e[0] : e;
    if (!first) return 'Unknown';
    if (first.full_name && first.full_name.trim()) return first.full_name.trim();
    const composed = `${first.first_name ?? ''} ${first.last_name ?? ''}`.trim();
    return composed || 'Unknown';
  };

  return ((data ?? []) as Row[])
    .filter((r) => r.clock_out)
    .map<Timecard>((r) => {
      const regular = Number(r.regular_hours ?? 0);
      const overtime = Number(r.overtime_hours ?? 0);
      // If both legs were null, fall back to paid_hours minus overtime.
      const reg = regular || Math.max(0, Number(r.paid_hours ?? 0) - overtime);
      return {
        id: String(r.hb_timecard_id),
        date: nyDateOf(r.clock_in),
        clockedInAt: r.clock_in,
        clockedOutAt: r.clock_out as string,
        regularHours: reg,
        overtimeHours: overtime,
        totalCost: (r.total_cost_cents ?? 0) / 100,
        employeeName: employeeName(r.employee),
      };
    });
}

export async function fetchShifts(
  startDate: string,
  endDate: string
): Promise<ScheduledShift[]> {
  const supabase = createAdminClient();
  if (!supabase) return [];

  const { startUTC, endUTC } = nyDayRange(startDate, endDate);

  const { data, error } = await supabase
    .from('homebase_shifts_scheduled')
    .select(
      `hb_shift_id, hb_employee_id, role, department,
       start_at, end_at, scheduled_hours, scheduled_cost_cents, wage_rate_cents,
       published,
       employee:homebase_employees!hb_employee_id (full_name, first_name, last_name)`
    )
    .gte('start_at', startUTC)
    .lt('start_at', endUTC)
    .eq('published', true)
    .order('start_at', { ascending: true });

  if (error) {
    throw new Error(`Supabase homebase_shifts_scheduled: ${error.message}`);
  }

  type Row = {
    hb_shift_id: number | string;
    start_at: string;
    end_at: string;
    role: string | null;
    department: string | null;
    scheduled_hours: number | string | null;
    scheduled_cost_cents: number | null;
    wage_rate_cents: number | null;
    employee?:
      | { full_name?: string | null; first_name?: string | null; last_name?: string | null }
      | Array<{ full_name?: string | null; first_name?: string | null; last_name?: string | null }>
      | null;
  };

  const employeeName = (e: Row['employee']): string => {
    const first = Array.isArray(e) ? e[0] : e;
    if (!first) return 'Unknown';
    if (first.full_name && first.full_name.trim()) return first.full_name.trim();
    const composed = `${first.first_name ?? ''} ${first.last_name ?? ''}`.trim();
    return composed || 'Unknown';
  };

  return ((data ?? []) as Row[]).map<ScheduledShift>((r) => {
    const scheduledHoursRaw = Number(r.scheduled_hours ?? 0);
    const scheduledHours =
      scheduledHoursRaw > 0 ? scheduledHoursRaw : computeHours(r.start_at, r.end_at);
    const scheduledCost = (r.scheduled_cost_cents ?? 0) / 100;
    const wageRate = (r.wage_rate_cents ?? 0) / 100;
    return {
      id: String(r.hb_shift_id),
      date: nyDateOf(r.start_at),
      startAt: r.start_at,
      endAt: r.end_at,
      scheduledHours,
      scheduledCost: scheduledCost > 0 ? scheduledCost : scheduledHours * wageRate,
      employeeName: employeeName(r.employee),
      department: r.department ?? r.role ?? 'General',
      wageRate,
    };
  });
}

function computeHours(start: string, end: string): number {
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  return Math.max(0, (endMs - startMs) / 3_600_000);
}

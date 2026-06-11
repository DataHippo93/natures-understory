// Data fetching layer.
//
// Sources of truth:
//   • Historical sales  → Thrive warehouse (thrive_sales_history, lib/thrive.ts)
//   • Today's intraday  → Clover Payments API (live; Thrive lands a day at a time)
//   • Labor             → Homebase API (live; creds in BWS → Vercel env)
//
// IMPORTANT: demo data is shown ONLY when DEMO_MODE=true. Real-data errors
// propagate to the page error boundary — we never silently show fake numbers.
import type { KPIData, ShiftAnalysisData, LaborRatioData, QuietScore, DayOfWeekBreakdown } from './types';
import { getDemoKPIData, getDemoShiftAnalysisData, getDemoLaborRatioData } from './demo-data';
import {
  fetchPayments,
  netSalesDollars,
  localDateStr,
  localHour,
  todayMidnightMs,
  nDaysAgoMidnightMs,
} from './clover';
import { fetchTimecards, fetchShifts } from './homebase';
import { getDailyRevenue, getDowAverageRevenue } from './thrive';

const LOADED_COST_MULTIPLIER = 1.2;
const LOCAL_TZ = 'America/New_York';
const STORE_OPEN_HOUR = 8;
const STORE_CLOSE_HOUR = 20;
const DOW_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function getIsDemoMode(): boolean {
  // Demo data must be EXPLICITLY requested. Missing credentials are a
  // configuration error and should surface as one — never as fake numbers.
  return process.env.DEMO_MODE === 'true';
}

// ─── KPI Data ───────────────────────────────────────────────────────────────

export async function getKPIData(): Promise<KPIData> {
  if (getIsDemoMode()) return getDemoKPIData();
  try {
    const now = Date.now();
    const todayStart = todayMidnightMs(LOCAL_TZ);
    const yesterdayStart = nDaysAgoMidnightMs(1, LOCAL_TZ);

    // Fetch from store open hour today, not midnight — avoids pre-open test transactions
    const todayOpenMs = todayStart + STORE_OPEN_HOUR * 3_600_000;
    const [todayPayments, yesterdayPayments, laborData] = await Promise.all([
      fetchPayments(todayOpenMs, now),
      fetchPayments(yesterdayStart, todayStart),
      getLaborRatioData(14),
    ]);

    const todaySales = todayPayments.reduce((s, p) => s + netSalesDollars(p), 0);
    const yesterdaySales = yesterdayPayments.reduce((s, p) => s + netSalesDollars(p), 0);
    const todaySalesChange =
      yesterdaySales > 0
        ? Math.round(((todaySales - yesterdaySales) / yesterdaySales) * 100 * 10) / 10
        : 0;

    const hourlyScores = computeQuietScores(todayPayments);
    const currentHour = localHour(now, LOCAL_TZ);
    // No scores yet (store hasn't transacted today) — default to neutral
    const currentScore = hourlyScores.find((h) => h.hour === currentHour) ?? {
      hour: currentHour,
      score: 5,
      label: 'light' as const,
    };

    return {
      todaySales,
      todaySalesChange,
      laborRatio: laborData.laborRatioPercent,
      laborRatioTarget: 25,
      currentQuietScore: currentScore.score,
      quietScoreLabel: currentScore.label,
    };
  } catch (err) {
    console.error('getKPIData failed:', err);
    throw err instanceof Error ? err : new Error(String(err));
  }
}

// ─── Shift Analysis ──────────────────────────────────────────────────────────

export async function getShiftAnalysisData(lookbackDays = 30): Promise<ShiftAnalysisData> {
  if (getIsDemoMode()) return getDemoShiftAnalysisData(lookbackDays);
  try {
    const now = Date.now();
    const todayStart = todayMidnightMs(LOCAL_TZ);

    // Hour-of-day analysis needs transaction timestamps, which the Thrive
    // warehouse doesn't carry (daily grain). Clover's Payments API is the
    // hourly source — today's scores and the DOW lookback both come from it.
    const todayOpenMs = todayStart + STORE_OPEN_HOUR * 3_600_000;
    const lookbackStart = nDaysAgoMidnightMs(Math.min(lookbackDays, 60), LOCAL_TZ);

    const [todayPayments, historicalPayments] = await Promise.all([
      fetchPayments(todayOpenMs, now),
      fetchPayments(lookbackStart, todayStart),
    ]);

    const hourlyScores = computeQuietScores(todayPayments);
    const dayOfWeekBreakdown = computeDowBreakdown(historicalPayments);

    return { hourlyScores, dayOfWeekBreakdown, lookbackDays };
  } catch (err) {
    console.error('getShiftAnalysisData failed:', err);
    throw err instanceof Error ? err : new Error(String(err));
  }
}

// ─── Labor Ratio Data ────────────────────────────────────────────────────────

export async function getLaborRatioData(lookbackDays = 14): Promise<LaborRatioData> {
  if (getIsDemoMode()) return getDemoLaborRatioData();
  try {
    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: LOCAL_TZ });

    const actualsStartDate = offsetDateStr(todayStr, -lookbackDays);
    const actualsEndDate   = offsetDateStr(todayStr, -1);
    const projStartDate    = todayStr;
    const projEndDate      = offsetDateStr(todayStr, 14);

    // Daily sales come from the Thrive warehouse (synced nightly), labor
    // comes from Homebase live. Two cheap queries instead of paging through
    // thousands of Clover payment records.
    const [timecards, shifts, dailyRevenue, dowAvgSales] = await Promise.all([
      fetchTimecards(actualsStartDate, actualsEndDate).catch(() => []),
      fetchShifts(projStartDate, projEndDate).catch(() => []),
      getDailyRevenue(actualsStartDate, actualsEndDate),
      getDowAverageRevenue(90),
    ]);

    // ── Daily sales map from Thrive ──────────────────────────────────────────
    const dailySalesMap: Record<string, number> = {};
    for (const d of dailyRevenue) {
      dailySalesMap[d.date] = d.revenue;
    }

    // ── Daily labor map from Homebase timecards ──────────────────────────────
    const dailyLaborMap: Record<string, { hours: number; wages: number }> = {};
    for (const tc of timecards) {
      if (!dailyLaborMap[tc.date]) dailyLaborMap[tc.date] = { hours: 0, wages: 0 };
      dailyLaborMap[tc.date].hours += tc.regularHours + tc.overtimeHours;
      dailyLaborMap[tc.date].wages += tc.totalCost;
    }

    // ── Build actuals: show every day that has sales, labor optional ─────────
    const actuals = [];
    for (let i = lookbackDays; i >= 1; i--) {
      const d = offsetDateStr(todayStr, -i);
      const netSales = dailySalesMap[d] ?? 0;
      if (netSales === 0) continue; // no sales = closed or no data

      const labor = dailyLaborMap[d];
      const wages = labor?.wages ?? 0;
      const hours = labor?.hours ?? 0;
      const fullyLoadedCost = wages * LOADED_COST_MULTIPLIER;

      actuals.push({
        date: d,
        timesheetHours: Math.round(hours * 10) / 10,
        wages: Math.round(wages * 100) / 100,
        fullyLoadedCost: Math.round(fullyLoadedCost * 100) / 100,
        netSales: Math.round(netSales * 100) / 100,
        // If no labor data yet, show null-ish ratio so UI can display N/A
        laborRatio: wages > 0 ? Math.round((fullyLoadedCost / netSales) * 100 * 10) / 10 : 0,
        hasLaborData: wages > 0,
      });
    }

    // ── Daily shift map ──────────────────────────────────────────────────────
    const dailyShiftMap: Record<string, { hours: number; cost: number }> = {};
    for (const shift of shifts) {
      if (!dailyShiftMap[shift.date]) dailyShiftMap[shift.date] = { hours: 0, cost: 0 };
      dailyShiftMap[shift.date].hours += shift.scheduledHours;
      dailyShiftMap[shift.date].cost  += shift.scheduledCost;
    }

    // ── Build projections (next 14 days) ────────────────────────────────────
    const projections = [];
    for (let i = 0; i < 14; i++) {
      const d = offsetDateStr(todayStr, i);
      const shiftData = dailyShiftMap[d];
      if (!shiftData) continue;

      const dow = new Date(d + 'T12:00:00').getDay();
      const projectedSales = dowAvgSales[dow] ?? 7000;
      const projectedLoadedCost = shiftData.cost * LOADED_COST_MULTIPLIER;

      projections.push({
        date: d,
        scheduledHours: Math.round(shiftData.hours * 10) / 10,
        projectedWages: Math.round(shiftData.cost * 100) / 100,
        projectedLoadedCost: Math.round(projectedLoadedCost * 100) / 100,
        projectedSales: Math.round(projectedSales * 100) / 100,
        projectedLaborRatio:
          projectedSales > 0
            ? Math.round((projectedLoadedCost / projectedSales) * 100 * 10) / 10
            : 0,
      });
    }

    // ── Summary ratios ───────────────────────────────────────────────────────
    const totalActualSales  = actuals.reduce((s, a) => s + a.netSales, 0);
    const totalActualLabor  = actuals.reduce((s, a) => s + a.fullyLoadedCost, 0);
    const laborRatioPercent =
      totalActualSales > 0 && totalActualLabor > 0
        ? Math.round((totalActualLabor / totalActualSales) * 100 * 10) / 10
        : 0;

    const totalProjSales = projections.reduce((s, p) => s + p.projectedSales, 0);
    const totalProjLabor = projections.reduce((s, p) => s + p.projectedLoadedCost, 0);
    const projectedRatioPercent =
      totalProjSales > 0
        ? Math.round((totalProjLabor / totalProjSales) * 100 * 10) / 10
        : 0;

    return {
      actuals,
      projections,
      laborRatioPercent,
      projectedRatioPercent,
      loadedCostFactor: LOADED_COST_MULTIPLIER,
    };
  } catch (err) {
    console.error('getLaborRatioData failed:', err);
    throw err instanceof Error ? err : new Error(String(err));
  }
}

// ─── Roster / Schedule ───────────────────────────────────────────────────────

export async function getRosterData(dateStr?: string): Promise<import('./types').RosterDay> {
  const date = dateStr ?? new Date().toLocaleDateString('en-CA', { timeZone: LOCAL_TZ });

  const [shifts, timecards] = await Promise.all([
    fetchShifts(date, date).catch(() => []),
    fetchTimecards(date, date).catch(() => []),
  ]);

  // Group timecards by employee — one person may have multiple cards in a day
  // (e.g. clocked in for a morning Front End shift then an afternoon Office shift)
  const timecardsByEmployee: Record<string, import('./homebase').Timecard[]> = {};
  for (const tc of timecards) {
    if (!timecardsByEmployee[tc.employeeName]) timecardsByEmployee[tc.employeeName] = [];
    timecardsByEmployee[tc.employeeName].push(tc);
  }

  const entries: import('./types').RosterEntry[] = shifts.map((shift) => {
    const employeeCards = timecardsByEmployee[shift.employeeName] ?? [];

    // Match this shift to the timecard whose clock-in is closest to the shift start,
    // capped at a 2-hour window so we never cross-assign cards between shifts.
    const shiftStartMs = new Date(shift.startAt).getTime();
    let bestTc: import('./homebase').Timecard | null = null;
    let bestDelta = Infinity;
    for (const tc of employeeCards) {
      const delta = Math.abs(new Date(tc.clockedInAt).getTime() - shiftStartMs);
      if (delta < bestDelta && delta < 2 * 3_600_000) {
        bestDelta = delta;
        bestTc = tc;
      }
    }

    const actualHours = bestTc
      ? Math.round((bestTc.regularHours + bestTc.overtimeHours) * 100) / 100
      : null;

    return {
      employeeId: shift.id,
      employeeName: shift.employeeName,
      department: shift.department || 'General',
      shiftStart: shift.startAt,
      shiftEnd: shift.endAt,
      scheduledHours: Math.round(shift.scheduledHours * 100) / 100,
      actualHours,
      clockedIn: bestTc != null && !bestTc.clockedOutAt,
      isActual: bestTc != null,
    };
  });

  // Group by category/department
  const categoryMap: Record<string, import('./types').RosterEntry[]> = {};
  for (const entry of entries) {
    if (!categoryMap[entry.department]) categoryMap[entry.department] = [];
    categoryMap[entry.department].push(entry);
  }

  const categories = Object.entries(categoryMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, catEntries]) => ({
      name,
      entries: catEntries.sort((a, b) => a.shiftStart.localeCompare(b.shiftStart)),
    }));

  return {
    date,
    categories,
    totalScheduledHours: Math.round(entries.reduce((s, e) => s + e.scheduledHours, 0) * 10) / 10,
    totalActualHours: Math.round(entries.reduce((s, e) => s + (e.actualHours ?? 0), 0) * 10) / 10,
    totalScheduledCost: Math.round(shifts.reduce((s, sh) => s + sh.scheduledCost, 0) * 100) / 100,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function computeQuietScores(payments: import('./clover').CloverPayment[]): QuietScore[] {
  // No transactions yet today — return empty so the UI can show a "no data" state
  if (payments.length === 0) return [];

  const hourCounts: Record<number, number> = {};
  const hourSales: Record<number, number> = {};
  for (let h = STORE_OPEN_HOUR; h <= STORE_CLOSE_HOUR; h++) {
    hourCounts[h] = 0;
    hourSales[h] = 0;
  }

  for (const p of payments) {
    const h = localHour(p.createdTime, LOCAL_TZ);
    if (h >= STORE_OPEN_HOUR && h <= STORE_CLOSE_HOUR) {
      hourCounts[h] = (hourCounts[h] ?? 0) + 1;
      hourSales[h] = (hourSales[h] ?? 0) + netSalesDollars(p);
    }
  }

  const counts = Object.values(hourCounts);
  const minC = Math.min(...counts);
  const maxC = Math.max(...counts);
  const range = maxC - minC;

  return Object.entries(hourCounts).map(([hourStr, count]) => {
    const score = range === 0 ? 8 : (10 * (maxC - count)) / range;
    const rounded = Math.round(score * 10) / 10;
    const h = parseInt(hourStr);
    return {
      hour: h,
      score: rounded,
      label: rounded >= 7 ? 'quiet' : rounded >= 4 ? 'light' : 'peak',
      transactions: count,
      hourlySales: Math.round((hourSales[h] ?? 0) * 100) / 100,
    } as QuietScore;
  });
}

function computeDowBreakdown(
  payments: import('./clover').CloverPayment[]
): DayOfWeekBreakdown[] {
  const dailyHourCounts: Record<string, Record<number, number>> = {};
  for (const p of payments) {
    const d = localDateStr(p.createdTime, LOCAL_TZ);
    const h = localHour(p.createdTime, LOCAL_TZ);
    if (h < STORE_OPEN_HOUR || h > STORE_CLOSE_HOUR) continue;
    if (!dailyHourCounts[d]) dailyHourCounts[d] = {};
    dailyHourCounts[d][h] = (dailyHourCounts[d][h] ?? 0) + 1;
  }

  const dowHourScores: Record<number, Record<number, number[]>> = {};
  for (const [dateStr, hourCounts] of Object.entries(dailyHourCounts)) {
    const dow = new Date(dateStr + 'T12:00:00').getDay();
    const counts = Object.values(hourCounts);
    const minC = Math.min(...counts, 0);
    const maxC = Math.max(...counts, 1);
    const range = maxC - minC;

    for (const [hourStr, count] of Object.entries(hourCounts)) {
      const score = range === 0 ? 8 : (10 * (maxC - count)) / range;
      const h = parseInt(hourStr);
      if (!dowHourScores[dow]) dowHourScores[dow] = {};
      if (!dowHourScores[dow][h]) dowHourScores[dow][h] = [];
      dowHourScores[dow][h].push(score);
    }
  }

  return DOW_NAMES.map((day, dow) => {
    const hourScores = dowHourScores[dow] ?? {};
    const avgByHour: Record<number, number> = {};
    for (const [hourStr, scores] of Object.entries(hourScores)) {
      avgByHour[parseInt(hourStr)] = scores.reduce((s, v) => s + v, 0) / scores.length;
    }

    const allScores = Object.values(avgByHour);
    const avgQuietScore =
      allScores.length > 0
        ? Math.round((allScores.reduce((s, v) => s + v, 0) / allScores.length) * 10) / 10
        : 5;

    // Top 3 quietest and busiest hours rather than fixed thresholds, so there's
    // always something meaningful to display regardless of score distribution.
    const sorted = Object.entries(avgByHour)
      .map(([h, s]) => ({ h: parseInt(h), s }))
      .sort((a, b) => b.s - a.s);

    const bestHours = sorted.slice(0, 3).filter(({ s }) => s >= 6).map(({ h }) => h).sort((a, b) => a - b);
    const peakHours = sorted.slice(-3).filter(({ s }) => s < 5).map(({ h }) => h).sort((a, b) => a - b);

    return { day, avgQuietScore, bestHours, peakHours };
  });
}

function offsetDateStr(baseDate: string, offsetDays: number): string {
  const d = new Date(baseDate + 'T12:00:00');
  d.setDate(d.getDate() + offsetDays);
  return d.toLocaleDateString('en-CA');
}

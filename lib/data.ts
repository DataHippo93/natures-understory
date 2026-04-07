// Data fetching layer — calls real Clover + Homebase APIs, falls back to demo data on error
import type { KPIData, ShiftAnalysisData, LaborRatioData, QuietScore, DayOfWeekBreakdown } from './types';
import { getDemoKPIData, getDemoShiftAnalysisData, getDemoLaborRatioData } from './demo-data';
import {
  fetchPayments,
  netSalesDollars,
  localDateStr,
  localHour,
  localDayOfWeek,
  todayMidnightMs,
  nDaysAgoMidnightMs,
} from './clover';
import { fetchTimecards, fetchShifts } from './homebase';
import { createAdminClient } from './supabase/admin';

const LOADED_COST_MULTIPLIER = 1.2;
const LOCAL_TZ = 'America/New_York';
const STORE_OPEN_HOUR = 8;
const STORE_CLOSE_HOUR = 20;
const DOW_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function getIsDemoMode(): boolean {
  if (process.env.DEMO_MODE === 'true') return true;
  return !process.env.NATURES_STOREHOUSE_MID || !process.env.NATURES_STOREHOUSE_TOKEN;
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
    console.error('getKPIData failed, falling back to demo:', err);
    return getDemoKPIData();
  }
}

// ─── Shift Analysis ──────────────────────────────────────────────────────────

export async function getShiftAnalysisData(lookbackDays = 30): Promise<ShiftAnalysisData> {
  if (getIsDemoMode()) return getDemoShiftAnalysisData(lookbackDays);
  try {
    const now = Date.now();
    const todayStart = todayMidnightMs(LOCAL_TZ);
    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: LOCAL_TZ });
    const lookbackStartStr = offsetDateStr(todayStr, -lookbackDays);

    // Today's live hourly scores — Clover (real-time, small date range)
    const todayOpenMs = todayStart + STORE_OPEN_HOUR * 3_600_000;
    const todayPayments = await fetchPayments(todayOpenMs, now);
    const hourlyScores = computeQuietScores(todayPayments);

    // DOW breakdown — Supabase (already synced daily, no Clover rate-limit risk)
    const admin = createAdminClient();
    let dayOfWeekBreakdown: DayOfWeekBreakdown[];

    if (admin) {
      // Aggregate counts in SQL — returns ≤(days×13) rows, no 1000-row cap issue
      const sql = `
        SELECT sale_date, sale_hour, COUNT(*)::int AS tx_count
        FROM sales_line_items
        WHERE sale_date >= '${lookbackStartStr}' AND sale_date < '${todayStr}'
          AND sale_hour BETWEEN ${STORE_OPEN_HOUR} AND ${STORE_CLOSE_HOUR}
        GROUP BY sale_date, sale_hour
        ORDER BY sale_date, sale_hour
      `;
      const { data: rows } = await admin.rpc('run_report_query', { query: sql });
      const typed = (rows ?? []) as Array<{ sale_date: string; sale_hour: number; tx_count: number }>;
      dayOfWeekBreakdown = computeDowBreakdownFromRows(typed);
    } else {
      // No Supabase — fall back to Clover historical fetch
      const lookbackStart = nDaysAgoMidnightMs(lookbackDays, LOCAL_TZ);
      const historicalPayments = await fetchPayments(lookbackStart, todayStart);
      dayOfWeekBreakdown = computeDowBreakdown(historicalPayments);
    }

    return { hourlyScores, dayOfWeekBreakdown, lookbackDays };
  } catch (err) {
    console.error('getShiftAnalysisData failed, falling back to demo:', err);
    return getDemoShiftAnalysisData(lookbackDays);
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

    // Cap historical at 90 days for DOW averages — 13 weeks is more than enough pattern data.
    // Avoids fetching thousands of Clover records for large lookback periods.
    const DOW_HISTORY_CAP = 90;
    const historicalDays = Math.max(Math.min(lookbackDays, DOW_HISTORY_CAP), 56);
    // If lookback ≤ historicalDays, fetch once and reuse; otherwise fetch actuals + history separately.
    const needsSeparateFetch = lookbackDays > historicalDays;

    const [timecards, shifts, historicalPayments] = await Promise.all([
      fetchTimecards(actualsStartDate, actualsEndDate).catch(() => []),
      fetchShifts(projStartDate, projEndDate).catch(() => []),
      fetchPayments(nDaysAgoMidnightMs(historicalDays, LOCAL_TZ), todayMidnightMs(LOCAL_TZ)),
    ]);

    // For actuals, use a separate fetch only when lookback > DOW_HISTORY_CAP
    const actualsPayments = needsSeparateFetch
      ? await fetchPayments(nDaysAgoMidnightMs(lookbackDays, LOCAL_TZ), todayMidnightMs(LOCAL_TZ))
      : historicalPayments;

    // ── Daily sales map from Clover ──────────────────────────────────────────
    const dailySalesMap: Record<string, number> = {};
    for (const p of actualsPayments) {
      const d = localDateStr(p.createdTime, LOCAL_TZ);
      dailySalesMap[d] = (dailySalesMap[d] ?? 0) + netSalesDollars(p);
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

    // ── DOW average sales for projections ───────────────────────────────────
    const dowDayMap: Record<number, Record<string, number>> = {};
    for (const p of historicalPayments) {
      const dow = localDayOfWeek(p.createdTime, LOCAL_TZ);
      const d   = localDateStr(p.createdTime, LOCAL_TZ);
      if (!dowDayMap[dow]) dowDayMap[dow] = {};
      dowDayMap[dow][d] = (dowDayMap[dow][d] ?? 0) + netSalesDollars(p);
    }
    const dowAvgSales: Record<number, number> = {};
    for (const [dowStr, days] of Object.entries(dowDayMap)) {
      const values = Object.values(days);
      dowAvgSales[parseInt(dowStr)] = values.reduce((s, v) => s + v, 0) / values.length;
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
    const actualsWithLabor = actuals.filter((a) => a.hasLaborData);
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
    console.error('getLaborRatioData failed, falling back to demo:', err);
    return getDemoLaborRatioData();
  }
}

// ─── Roster / Schedule ───────────────────────────────────────────────────────

export async function getRosterData(dateStr?: string): Promise<import('./types').RosterDay> {
  const date = dateStr ?? new Date().toLocaleDateString('en-CA', { timeZone: LOCAL_TZ });

  const [shifts, timecards] = await Promise.all([
    fetchShifts(date, date).catch(() => []),
    fetchTimecards(date, date).catch(() => []),
  ]);

  // Build a map of employee timecards for the day
  const timecardMap: Record<string, import('./homebase').Timecard> = {};
  for (const tc of timecards) {
    // Key by employee name (best we have without a stable employee ID cross-ref)
    timecardMap[tc.employeeName] = tc;
  }

  const entries: import('./types').RosterEntry[] = shifts.map((shift) => {
    const tc = timecardMap[shift.employeeName];
    const actualHours = tc
      ? Math.round((tc.regularHours + tc.overtimeHours) * 100) / 100
      : null;

    return {
      employeeId: shift.id,
      employeeName: shift.employeeName,
      department: shift.department || 'General',
      shiftStart: shift.startAt,
      shiftEnd: shift.endAt,
      scheduledHours: Math.round(shift.scheduledHours * 100) / 100,
      actualHours,
      clockedIn: tc != null && !tc.clockedOutAt,
      isActual: tc != null,
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

/** DOW breakdown from pre-aggregated Supabase rows (sale_date, sale_hour, tx_count) */
function computeDowBreakdownFromRows(
  rows: Array<{ sale_date: string; sale_hour: number; tx_count: number }>
): DayOfWeekBreakdown[] {
  // Build daily hour-count map from pre-aggregated counts
  const dailyHourCounts: Record<string, Record<number, number>> = {};
  for (const row of rows) {
    if (!dailyHourCounts[row.sale_date]) dailyHourCounts[row.sale_date] = {};
    dailyHourCounts[row.sale_date][row.sale_hour] = row.tx_count;
  }

  // Score each hour relative to that day's traffic, then average by DOW
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

    // Show top 3 quietest and top 3 busiest hours rather than using fixed thresholds,
    // so there's always something meaningful to display regardless of score distribution.
    const sorted = Object.entries(avgByHour)
      .map(([h, s]) => ({ h: parseInt(h), s }))
      .sort((a, b) => b.s - a.s);

    const bestHours = sorted.slice(0, 3).filter(({ s }) => s >= 6).map(({ h }) => h).sort((a, b) => a - b);
    const peakHours = sorted.slice(-3).filter(({ s }) => s < 5).map(({ h }) => h).sort((a, b) => a - b);

    return { day, avgQuietScore, bestHours, peakHours };
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

    const bestHours = Object.entries(avgByHour)
      .filter(([, s]) => s >= 7)
      .map(([h]) => parseInt(h))
      .sort((a, b) => a - b);

    const peakHours = Object.entries(avgByHour)
      .filter(([, s]) => s < 4)
      .map(([h]) => parseInt(h))
      .sort((a, b) => a - b);

    return { day, avgQuietScore, bestHours, peakHours };
  });
}

function offsetDateStr(baseDate: string, offsetDays: number): string {
  const d = new Date(baseDate + 'T12:00:00');
  d.setDate(d.getDate() + offsetDays);
  return d.toLocaleDateString('en-CA');
}

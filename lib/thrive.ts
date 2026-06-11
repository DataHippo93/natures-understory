// Thrive (Shopventory) warehouse data layer.
//
// Source of truth for SALES REPORTING: public.thrive_sales_history —
// daily per-variant aggregates synced nightly (5am UTC) by the
// thrive-pipeline repo (separate Vercel project). Catalog enrichment
// comes from public.thrive_product_catalog (department, brand, vendor).
//
// This module deliberately contains NO Clover dependencies. Clover's
// live Payments API is still used elsewhere for *today's* intraday
// numbers (Thrive lands a full day at a time).
import { createAdminClient } from './supabase/admin';

const LOCAL_TZ = 'America/New_York';

export interface DepartmentSales {
  department: string;
  revenue: number;       // dollars
  unitsSold: number;
  profit: number;        // dollars
  marginPct: number;     // weighted avg margin
  pct: number;           // % of total revenue
}

export interface ItemSales {
  itemName: string;
  variantName: string | null;
  sku: string | null;
  department: string;
  brand: string | null;
  unitsSold: number;
  revenue: number;
  profit: number;
  marginPct: number | null;
}

export interface DailyRevenue {
  date: string; // YYYY-MM-DD
  revenue: number;
  units: number;
}

function todayStr(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: LOCAL_TZ });
}

function offsetDateStr(baseDate: string, offsetDays: number): string {
  const d = new Date(baseDate + 'T12:00:00');
  d.setDate(d.getDate() + offsetDays);
  return d.toLocaleDateString('en-CA');
}

/** Validates YYYY-MM-DD before SQL interpolation. */
function assertDate(s: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error(`Invalid date: ${s}`);
  return s;
}

/** A resolved reporting window: either a trailing-days lookback or a
 *  calendar month (?month=YYYY-MM). */
export interface SalesWindow {
  start: string; // YYYY-MM-DD inclusive
  end: string;   // YYYY-MM-DD inclusive
  label: string; // human label, e.g. "June 2026" or "last 30 days"
  days: number;  // lookback days (kept for the day-preset UI state)
  month: string | null; // YYYY-MM when a calendar month is active
}

export function resolveSalesWindow(params: { days?: string; month?: string }): SalesWindow {
  const today = todayStr();
  const m = params.month;
  if (m && /^\d{4}-\d{2}$/.test(m) && `${m}-01` <= today) {
    const [y, mo] = m.split('-').map(Number);
    const lastDay = new Date(y, mo, 0).getDate();
    const endOfMonth = `${m}-${String(lastDay).padStart(2, '0')}`;
    return {
      start: `${m}-01`,
      end: endOfMonth < today ? endOfMonth : today,
      label: new Date(y, mo - 1, 15).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
      days: 30,
      month: m,
    };
  }
  const days = Math.min(365, Math.max(7, parseInt(params.days ?? '30') || 30));
  return {
    start: offsetDateStr(today, -days),
    end: today,
    label: `last ${days} days`,
    days,
    month: null,
  };
}

async function reportQuery<T>(sql: string): Promise<T[]> {
  const admin = createAdminClient();
  if (!admin) throw new Error('Supabase admin client not configured');
  // trim: the RPC's SELECT-only guard rejects leading whitespace/newlines
  const { data, error } = await admin.rpc('run_report_query', { query_sql: sql.trim() });
  if (error) throw new Error(`Thrive report query failed: ${error.message}`);
  return (data ?? []) as T[];
}

// ─── Inventory cleanup report ────────────────────────────────────────────────

export interface CleanupItem {
  name: string;
  sku: string | null;
  barcode: string | null;
  categories: string | null;
}

export interface CleanupReport {
  noVendor: CleanupItem[];
  conflictingCategories: CleanupItem[];
  noBarcode: CleanupItem[];
}

const CLEANUP_COLS = `
  name,
  NULLIF(sku, '') AS sku,
  NULLIF(barcode, '') AS barcode,
  (SELECT string_agg(c->>'name', ' | ')
     FROM jsonb_array_elements(COALESCE(raw->'item'->'categories', '[]'::jsonb)) c) AS categories`;

/** List-manage data problems in the Thrive catalog so they can be fixed at
 *  the source. Active items only. */
export async function getCleanupReport(): Promise<CleanupReport> {
  const [noVendor, conflictingCategories, noBarcode] = await Promise.all([
    reportQuery<CleanupItem>(`
      SELECT ${CLEANUP_COLS}
      FROM thrive_product_catalog
      WHERE active
        AND jsonb_array_length(COALESCE(raw->'variant'->'vendors_list', '[]'::jsonb)) = 0
      ORDER BY name
      LIMIT 500`),
    reportQuery<CleanupItem>(`
      WITH cats AS (
        SELECT name, sku, barcode, raw,
               ARRAY(SELECT jsonb_array_elements(COALESCE(raw->'item'->'categories','[]'::jsonb))->>'name') AS cat_names
        FROM thrive_product_catalog WHERE active
      )
      SELECT ${CLEANUP_COLS}
      FROM cats
      WHERE 'Produce [EBT]' = ANY(cat_names)
        AND ('Supplements' = ANY(cat_names) OR 'Grocery [EBT]' = ANY(cat_names))
      ORDER BY name
      LIMIT 500`),
    reportQuery<CleanupItem>(`
      SELECT ${CLEANUP_COLS}
      FROM thrive_product_catalog
      WHERE active AND (barcode IS NULL OR barcode = '')
      ORDER BY name
      LIMIT 500`),
  ]);
  return { noVendor, conflictingCategories, noBarcode };
}

/** Most recent sale_date in the warehouse — drives the "data through" badge. */
export async function getLatestSaleDate(): Promise<string | null> {
  const rows = await reportQuery<{ d: string | null }>(
    `SELECT MAX(sale_date)::text AS d FROM thrive_sales_history`
  );
  return rows[0]?.d ?? null;
}

/** Revenue by department over the trailing N days, or an explicit window. */
export async function getDepartmentSales(
  days: number,
  win?: { start: string; end: string }
): Promise<DepartmentSales[]> {
  const end = assertDate(win?.end ?? todayStr());
  const start = assertDate(win?.start ?? offsetDateStr(end, -Math.max(1, Math.min(365, days))));

  const rows = await reportQuery<{
    department: string;
    revenue_cents: number;
    units: number;
    profit_cents: number;
  }>(`
    SELECT
      COALESCE(c.department, 'Uncategorized') AS department,
      COALESCE(SUM(s.revenue_cents), 0)::bigint AS revenue_cents,
      COALESCE(SUM(s.units), 0)::numeric AS units,
      COALESCE(SUM(s.profit_cents), 0)::bigint AS profit_cents
    FROM thrive_sales_history s
    LEFT JOIN thrive_product_catalog c ON c.thrive_variant_id = s.variant_id
    WHERE s.sale_date >= '${start}' AND s.sale_date <= '${end}'
    GROUP BY COALESCE(c.department, 'Uncategorized')
    ORDER BY revenue_cents DESC
  `);

  const total = rows.reduce((s, r) => s + (r.revenue_cents ?? 0), 0);
  return rows.map((r) => ({
    department: r.department,
    revenue: (r.revenue_cents ?? 0) / 100,
    unitsSold: Math.round(Number(r.units ?? 0)),
    profit: (r.profit_cents ?? 0) / 100,
    marginPct:
      r.revenue_cents > 0 ? Math.round(((r.profit_cents ?? 0) / r.revenue_cents) * 1000) / 10 : 0,
    pct: total > 0 ? ((r.revenue_cents ?? 0) / total) * 100 : 0,
  }));
}

/** Top items by revenue over the trailing N days, optionally within one department. */
export async function getItemSales(
  days: number,
  limit = 100,
  department: string | null = null,
  win?: { start: string; end: string }
): Promise<ItemSales[]> {
  const end = assertDate(win?.end ?? todayStr());
  const start = assertDate(win?.start ?? offsetDateStr(end, -Math.max(1, Math.min(365, days))));
  const lim = Math.max(1, Math.min(500, Math.floor(limit)));
  const deptClause = department
    ? `AND COALESCE(c.department, 'Uncategorized') = '${department.replace(/'/g, "''")}'`
    : '';

  const rows = await reportQuery<{
    item_name: string;
    variant_name: string | null;
    sku: string | null;
    department: string;
    brand: string | null;
    units: number;
    revenue_cents: number;
    profit_cents: number;
  }>(`
    SELECT
      s.item_name,
      NULLIF(s.variant_name, '') AS variant_name,
      NULLIF(s.sku, '') AS sku,
      COALESCE(c.department, 'Uncategorized') AS department,
      c.brand,
      COALESCE(SUM(s.units), 0)::numeric AS units,
      COALESCE(SUM(s.revenue_cents), 0)::bigint AS revenue_cents,
      COALESCE(SUM(s.profit_cents), 0)::bigint AS profit_cents
    FROM thrive_sales_history s
    LEFT JOIN thrive_product_catalog c ON c.thrive_variant_id = s.variant_id
    WHERE s.sale_date >= '${start}' AND s.sale_date <= '${end}'
    ${deptClause}
    GROUP BY s.item_name, NULLIF(s.variant_name, ''), NULLIF(s.sku, ''),
             COALESCE(c.department, 'Uncategorized'), c.brand
    ORDER BY revenue_cents DESC
    LIMIT ${lim}
  `);

  return rows.map((r) => ({
    itemName: r.item_name,
    variantName: r.variant_name,
    sku: r.sku,
    department: r.department,
    brand: r.brand,
    unitsSold: Math.round(Number(r.units ?? 0) * 10) / 10,
    revenue: (r.revenue_cents ?? 0) / 100,
    profit: (r.profit_cents ?? 0) / 100,
    marginPct:
      r.revenue_cents > 0 ? Math.round(((r.profit_cents ?? 0) / r.revenue_cents) * 1000) / 10 : null,
  }));
}

/**
 * Daily net revenue between two dates (inclusive), from the Thrive warehouse.
 * Used by the labor-ratio page (daily sales denominators) and DOW projections.
 */
export async function getDailyRevenue(startDate: string, endDate: string): Promise<DailyRevenue[]> {
  const start = assertDate(startDate);
  const end = assertDate(endDate);

  const rows = await reportQuery<{ sale_date: string; revenue_cents: number; units: number }>(`
    SELECT sale_date::text AS sale_date,
           COALESCE(SUM(revenue_cents), 0)::bigint AS revenue_cents,
           COALESCE(SUM(units), 0)::numeric AS units
    FROM thrive_sales_history
    WHERE sale_date >= '${start}' AND sale_date <= '${end}'
    GROUP BY sale_date
    ORDER BY sale_date
  `);

  return rows.map((r) => ({
    date: r.sale_date,
    revenue: (r.revenue_cents ?? 0) / 100,
    units: Math.round(Number(r.units ?? 0)),
  }));
}

/** Average daily revenue by day-of-week (0=Sun..6=Sat) over trailing N days. */
export async function getDowAverageRevenue(days = 90): Promise<Record<number, number>> {
  const end = todayStr();
  const start = offsetDateStr(end, -Math.max(14, Math.min(365, days)));
  const daily = await getDailyRevenue(start, end);

  const byDow: Record<number, number[]> = {};
  for (const d of daily) {
    if (d.revenue <= 0) continue; // closed days don't drag averages down
    const dow = new Date(d.date + 'T12:00:00').getDay();
    (byDow[dow] ??= []).push(d.revenue);
  }

  const avg: Record<number, number> = {};
  for (const [dow, vals] of Object.entries(byDow)) {
    avg[Number(dow)] = vals.reduce((s, v) => s + v, 0) / vals.length;
  }
  return avg;
}

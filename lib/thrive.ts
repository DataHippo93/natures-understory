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
  detail: string | null;
}

export interface CleanupSection {
  key: string;
  title: string;
  description: string;
  detailLabel: string | null;
  items: CleanupItem[];
}

// Thrive sends jsonb null (a scalar) for missing arrays — COALESCE doesn't
// catch that and jsonb_array_length() errors on it. Always type-guard.
const CATS = `CASE WHEN jsonb_typeof(raw->'item'->'categories') = 'array'
                   THEN raw->'item'->'categories' ELSE '[]'::jsonb END`;
const VENDORS = `CASE WHEN jsonb_typeof(raw->'variant'->'vendors_list') = 'array'
                      THEN raw->'variant'->'vendors_list' ELSE '[]'::jsonb END`;
const CLEANUP_COLS = `
  name,
  NULLIF(sku, '') AS sku,
  NULLIF(barcode, '') AS barcode,
  (SELECT string_agg(c->>'name', ' | ') FROM jsonb_array_elements(${CATS}) c) AS categories`;

/** List-manage data problems in the Thrive catalog so they can be fixed at
 *  the source. Active items only; each list capped at 500 rows. */
export async function getCleanupReport(): Promise<CleanupSection[]> {
  const q = (sql: string) => reportQuery<CleanupItem>(sql);
  const [noVendor, conflicting, noBarcode, lowMargin, taxAmbiguous, likelyEbt,
         noSales, naming, stockTake] = await Promise.all([
    q(`SELECT ${CLEANUP_COLS}, department AS detail
       FROM thrive_product_catalog
       WHERE active AND jsonb_array_length(${VENDORS}) = 0
       ORDER BY name LIMIT 500`),
    q(`WITH cats AS (
         SELECT name, sku, barcode, raw,
                ARRAY(SELECT jsonb_array_elements(${CATS})->>'name') AS cat_names
         FROM thrive_product_catalog WHERE active)
       SELECT ${CLEANUP_COLS}, NULL AS detail
       FROM cats
       WHERE 'Produce [EBT]' = ANY(cat_names)
         AND ('Supplements' = ANY(cat_names) OR 'Grocery [EBT]' = ANY(cat_names))
       ORDER BY name LIMIT 500`),
    q(`SELECT ${CLEANUP_COLS}, department AS detail
       FROM thrive_product_catalog
       WHERE active AND (barcode IS NULL OR barcode = '')
       ORDER BY name LIMIT 500`),
    q(`SELECT ${CLEANUP_COLS},
              round(100.0 * (price_cents - default_cost_cents) / price_cents, 1) || '% margin · $'
                || round(price_cents / 100.0, 2) || ' price / $'
                || round(default_cost_cents / 100.0, 2) || ' cost' AS detail
       FROM thrive_product_catalog
       WHERE active AND price_cents > 0 AND default_cost_cents > 0
         AND (price_cents - default_cost_cents)::float / price_cents < 0.15
       ORDER BY (price_cents - default_cost_cents)::float / price_cents ASC
       LIMIT 500`),
    q(`WITH cats AS (
         SELECT name, sku, barcode, raw,
                ARRAY(SELECT jsonb_array_elements(${CATS})->>'name') AS cat_names
         FROM thrive_product_catalog WHERE active)
       SELECT ${CLEANUP_COLS}, NULL AS detail
       FROM cats
       WHERE EXISTS (SELECT 1 FROM unnest(cat_names) n WHERE n LIKE '%[TAX]%')
         AND EXISTS (SELECT 1 FROM unnest(cat_names) n WHERE n LIKE '%[EBT]%')
       ORDER BY name LIMIT 500`),
    q(`SELECT ${CLEANUP_COLS}, department AS detail
       FROM thrive_product_catalog
       WHERE active AND department IN ('Grocery', 'Produce', 'Bulk')
         AND NOT EXISTS (
           SELECT 1 FROM jsonb_array_elements(${CATS}) c
           WHERE c->>'name' LIKE '%[EBT]%')
       ORDER BY name LIMIT 500`),
    q(`SELECT ${CLEANUP_COLS},
              COALESCE((SELECT max(s.sale_date)::text FROM thrive_sales_history s
                        WHERE s.variant_id = thrive_product_catalog.thrive_variant_id), 'never') AS detail
       FROM thrive_product_catalog
       WHERE active
         AND COALESCE(substring(raw->'variant'->>'created' FROM 1 FOR 10)::date, '2000-01-01') < current_date - 60
         AND NOT EXISTS (
           SELECT 1 FROM thrive_sales_history s
           WHERE s.variant_id = thrive_product_catalog.thrive_variant_id
             AND s.sale_date >= current_date - 180)
       ORDER BY name LIMIT 500`),
    q(`SELECT ${CLEANUP_COLS},
              CASE
                WHEN name <> btrim(name) THEN 'leading/trailing space'
                WHEN position('  ' IN name) > 0 THEN 'double space'
                WHEN length(name) > 6 AND upper(name) = name THEN 'ALL CAPS'
              END AS detail
       FROM thrive_product_catalog
       WHERE active AND (
         name <> btrim(name) OR position('  ' IN name) > 0
         OR (length(name) > 6 AND upper(name) = name))
       ORDER BY name LIMIT 500`),
    q(`WITH sold AS (
         SELECT c.thrive_item_id, sum(s.units) AS units90
         FROM thrive_sales_history s
         JOIN thrive_product_catalog c ON c.thrive_variant_id = s.variant_id
         WHERE s.sale_date >= current_date - 90
         GROUP BY c.thrive_item_id)
       SELECT il.item_name AS name, NULL AS sku, NULL AS barcode,
              max(c.department) || COALESCE(' · ' || max(v.name), '') AS categories,
              'on hand ' || il.qty_on_hand || COALESCE(' ' || il.unit, '')
                || ' · sold (90d) ' || COALESCE(round(sold.units90), 0)
                || CASE WHEN il.qty_on_hand < 0 THEN ' · NEGATIVE on-hand'
                        WHEN COALESCE(sold.units90, 0) = 0 THEN ' · no sales 90d'
                        ELSE ' · on-hand far above sales' END AS detail
       FROM thrive_inventory_latest il
       LEFT JOIN sold ON sold.thrive_item_id = il.thrive_item_id
       LEFT JOIN thrive_product_catalog c ON c.thrive_item_id = il.thrive_item_id
       LEFT JOIN thrive_vendors v ON v.thrive_vendor_id = c.primary_vendor_id
       WHERE il.qty_on_hand < 0
          OR (il.qty_on_hand >= 20 AND COALESCE(sold.units90, 0) = 0)
          OR (il.qty_on_hand >= 20 AND il.qty_on_hand > 4 * COALESCE(sold.units90, 0))
       GROUP BY il.item_name, il.qty_on_hand, il.unit, sold.units90
       ORDER BY il.qty_on_hand ASC LIMIT 500`),
  ]);

  return [
    { key: 'vendors', title: 'No Vendor Configured', detailLabel: 'Department',
      description: 'Active items with no vendor in Thrive. These can’t flow through PO ordering and show a blank Brand on the Loss Tally sheet. Fix: item → Vendors in Thrive.',
      items: noVendor },
    { key: 'conflicts', title: 'Conflicting Categories', detailLabel: null,
      description: 'In Produce AND Grocery/Supplements at once — these pairs shouldn’t coexist. (Grocery + Locally Made is fine and not flagged.)',
      items: conflicting },
    { key: 'tax', title: 'Tax Status Ambiguous', detailLabel: null,
      description: 'In both a [TAX] and an [EBT] category — the register can only apply one treatment, so one of these categories is wrong.',
      items: taxAmbiguous },
    { key: 'ebt', title: 'Likely EBT, Not in an EBT Category', detailLabel: 'Department',
      description: 'Grocery/Produce/Bulk items with no [EBT] category. If they’re EBT-eligible foods, customers can’t use SNAP on them until categorized.',
      items: likelyEbt },
    { key: 'margin', title: 'Selling at Very Low Margin', detailLabel: 'Margin',
      description: 'Active items with margin under 15% (or selling below cost). Check for stale costs or prices that never got updated.',
      items: lowMargin },
    { key: 'deactivate', title: 'Deactivation Candidates (No Sales in 180 Days)', detailLabel: 'Last sale',
      description: 'Active items (created 60+ days ago) with zero sales in 6 months. Deactivate in Thrive to declutter the catalog, or put them on the Bonus Bin list.',
      items: noSales },
    { key: 'naming', title: 'Naming Standards', detailLabel: 'Rule broken',
      description: 'Placeholder rules for now: leading/trailing spaces, double spaces, ALL-CAPS names. Tell me the real house standards and I’ll encode them per category.',
      items: naming },
    { key: 'stocktake', title: 'Stock-Take Candidates (Inventory Looks Off)', detailLabel: 'Why flagged',
      description: 'Negative on-hand, or 20+ on hand with no/low sales in 90 days — counts that deserve a physical check. Department · vendor shown for routing the count.',
      items: stockTake },
  ];
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

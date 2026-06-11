// Nightly 3 AM ET — compute seasonal_index + elasticity_hint and write
// to Supabase. Feature tables already exist in this project (matching the
// Python pipeline's expectations). Until the sales backfill (Task #8)
// lands, every row is written with insufficient_data=true and a real
// `reason` so the order pipeline knows not to act on it.
//
// TS twin of:
//   natures-produce-buying/scripts/compute_seasonal_index.py
//   natures-produce-buying/scripts/compute_elasticity.py

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const maxDuration = 300;

// -- Tier requirements ---------------------------------------------------
const SEASONAL_MIN_DAYS = 365;
const SEASONAL_MIN_YEARS_PER_WEEK = 2;

// Tier A/B thresholds — read by future Tier A (log-log around price events)
// and Tier B (Spearman correlation) implementations. Kept here so the
// gate logic in tierCReason() and the documentation match.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const TIER_A_MIN_DAYS = 365;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const TIER_A_MIN_PRICE_LEVELS = 3;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const TIER_A_MIN_WEEKS_PER_LEVEL = 2;

const TIER_B_MIN_DAYS = 180;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const TIER_B_MIN_PRICE_LEVELS = 3;

function verify(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.get('authorization');
  return auth === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) { return handler(req); }
export async function POST(req: NextRequest) { return handler(req); }

async function handler(req: NextRequest) {
  if (!verify(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: 'Admin not configured' }, { status: 500 });

  const log: string[] = [];
  const started = Date.now();
  const startedAt = new Date().toISOString();

  const { data: logEntry } = await admin.from('sync_log').insert({
    sync_type: 'feature_compute',
    started_at: startedAt,
  }).select().single();
  const logId: string | undefined = logEntry?.id;

  try {
    // Data depth probe — Thrive warehouse (sales_line_items was dropped 2026-05-01)
    const { data: rangeData, error: rangeErr } = await admin.rpc('run_report_query', {
      query_sql: `SELECT MIN(sale_date)::text AS earliest, MAX(sale_date)::text AS latest FROM thrive_sales_history`,
    });
    if (rangeErr) throw new Error(`sales depth probe: ${rangeErr.message}`);
    const range = (rangeData as Array<{ earliest: string | null; latest: string | null }>)?.[0];
    const earliest = range?.earliest ?? undefined;
    const latest = range?.latest ?? undefined;
    const historyDays = earliest && latest ? daysBetween(earliest, latest) : 0;
    log.push(`Sales depth: earliest=${earliest ?? '—'}, latest=${latest ?? '—'}, days=${historyDays}`);

    // Inventory presence — for the elasticity stockout-mask gate
    const { count: invCount } = await admin
      .from('thrive_inventory_history')
      .select('*', { count: 'exact', head: true });
    const hasInventory = (invCount ?? 0) > 0;
    log.push(`Inventory snapshots: ${invCount ?? 0}`);

    // ---- Seasonal index ------------------------------------------------
    const seasonalRows = await computeSeasonalIndex(admin, historyDays, latest);
    log.push(`Seasonal index: ${seasonalRows.length} rows (${seasonalRows.filter((r) => !r.insufficient_data).length} sufficient)`);
    await upsertSeasonal(admin, seasonalRows);

    // ---- Elasticity ----------------------------------------------------
    const seasonalReady = seasonalRows.some((r) => !r.insufficient_data);
    const elasticityRows = await computeElasticity(admin, historyDays, hasInventory, seasonalReady);
    log.push(`Elasticity: ${elasticityRows.length} rows (${elasticityRows.filter((r) => !r.insufficient_data).length} sufficient)`);
    await upsertElasticity(admin, elasticityRows);

    if (logId) {
      await admin.from('sync_log').update({
        completed_at: new Date().toISOString(),
        records_synced: seasonalRows.length + elasticityRows.length,
      }).eq('id', logId);
    }

    return NextResponse.json({
      ok: true,
      elapsed_s: ((Date.now() - started) / 1000).toFixed(1),
      seasonal_rows: seasonalRows.length,
      elasticity_rows: elasticityRows.length,
      seasonal_sufficient: seasonalRows.filter((r) => !r.insufficient_data).length,
      elasticity_sufficient: elasticityRows.filter((r) => !r.insufficient_data).length,
      history_days: historyDays,
      has_inventory: hasInventory,
      log,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.push(`ERROR: ${message}`);
    if (logId) {
      try {
        await admin.from('sync_log').update({
          completed_at: new Date().toISOString(),
          error: message,
        }).eq('id', logId);
      } catch { /* ignore */ }
    }
    return NextResponse.json({ ok: false, error: message, log }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// Seasonal index
// ---------------------------------------------------------------------------

interface SeasonalRow {
  sales_item_id: string;
  iso_week: number;
  as_of_year: number;
  index_value: number | null;
  insufficient_data: boolean;
  reason: string | null;
  updated_at: string;
}

async function computeSeasonalIndex(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  historyDays: number,
  latest: string | undefined,
): Promise<SeasonalRow[]> {
  if (!latest) return [];
  const asOfYear = parseInt(latest.slice(0, 4), 10);

  // Pull weekly produce buckets from the Thrive warehouse, aggregated in SQL.
  // (The old per-row REST pull from sales_line_items silently capped at
  // 1000 rows — SQL aggregation avoids that class of bug entirely.)
  const { data, error } = await admin.rpc('run_report_query', {
    query_sql: `
      SELECT s.variant_id AS item_id,
             EXTRACT(isoyear FROM s.sale_date)::int AS iso_year,
             EXTRACT(week FROM s.sale_date)::int AS iso_week,
             COALESCE(SUM(s.units), 0)::float AS units
      FROM thrive_sales_history s
      JOIN thrive_product_catalog c ON c.thrive_variant_id = s.variant_id
      WHERE c.department = 'Produce'
      GROUP BY 1, 2, 3
    `,
  });
  if (error) throw new Error(`thrive produce sales pull: ${error.message}`);

  // Bucket per (item, iso_year, iso_week)
  type Cell = { units: number };
  const perItemWeek = new Map<string, Map<string, Cell>>(); // item → "year-week" → cell
  for (const row of (data ?? []) as Array<{ item_id: string | null; iso_year: number; iso_week: number; units: number }>) {
    const item = row.item_id ?? '';
    if (!item) continue;
    const k = `${row.iso_year}-${row.iso_week}`;
    let weeks = perItemWeek.get(item);
    if (!weeks) { weeks = new Map(); perItemWeek.set(item, weeks); }
    const c = weeks.get(k) ?? { units: 0 };
    c.units += Number(row.units ?? 0);
    weeks.set(k, c);
  }

  // For each item: avg_weekly = avg(units across weeks)
  // index per (item, iso_week) = avg(units in that week across years) / avg_weekly
  const out: SeasonalRow[] = [];
  const sufficientWindow = historyDays >= SEASONAL_MIN_DAYS;
  const now = new Date().toISOString();

  for (const [item, weeks] of perItemWeek) {
    const allCells = Array.from(weeks.entries()); // [(year-week), cell]
    if (allCells.length === 0) continue;

    const avgWeekly = allCells.reduce((acc, [, c]) => acc + c.units, 0) / allCells.length;
    if (avgWeekly <= 0) continue;

    // Group by iso_week (across years)
    const perWeek = new Map<number, { sumUnits: number; nObs: number; years: Set<number> }>();
    for (const [k, c] of allCells) {
      const [yearStr, weekStr] = k.split('-');
      const year = parseInt(yearStr, 10);
      const week = parseInt(weekStr, 10);
      const cur = perWeek.get(week) ?? { sumUnits: 0, nObs: 0, years: new Set<number>() };
      cur.sumUnits += c.units;
      cur.nObs += 1;
      cur.years.add(year);
      perWeek.set(week, cur);
    }

    for (const [week, agg] of perWeek) {
      const avgThisWeek = agg.sumUnits / agg.nObs;
      const idx = avgThisWeek / avgWeekly;
      const itemSufficient = sufficientWindow && agg.years.size >= SEASONAL_MIN_YEARS_PER_WEEK;
      out.push({
        sales_item_id: item,
        iso_week: week,
        as_of_year: asOfYear,
        index_value: itemSufficient ? round(idx, 4) : null,
        insufficient_data: !itemSufficient,
        reason: itemSufficient ? null : seasonalReason(historyDays, agg.years.size),
        updated_at: now,
      });
    }
  }
  return out;
}

function seasonalReason(historyDays: number, nYears: number): string {
  const parts: string[] = [];
  if (historyDays < SEASONAL_MIN_DAYS) parts.push(`history ${historyDays}d < ${SEASONAL_MIN_DAYS}d`);
  if (nYears < SEASONAL_MIN_YEARS_PER_WEEK) parts.push(`years_observed ${nYears} < ${SEASONAL_MIN_YEARS_PER_WEEK}`);
  return parts.join('; ') || 'insufficient';
}

async function upsertSeasonal(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  rows: SeasonalRow[],
): Promise<void> {
  if (!rows.length) return;
  const BATCH = 500;
  for (let i = 0; i < rows.length; i += BATCH) {
    const { error } = await admin
      .from('seasonal_index')
      .upsert(rows.slice(i, i + BATCH), { onConflict: 'sales_item_id,iso_week,as_of_year' });
    if (error) throw new Error(`seasonal_index batch ${i}: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// Elasticity
// ---------------------------------------------------------------------------

interface ElasticityRow {
  sales_item_id: string;
  signed_elasticity: number | null;
  swings_observed: number;
  insufficient_data: boolean;
  reason: string | null;
  updated_at: string;
}

async function computeElasticity(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  historyDays: number,
  hasInventory: boolean,
  seasonalReady: boolean,
): Promise<ElasticityRow[]> {
  // Phase: Tier C only until backfill (#8) lands. Schema + plumbing are
  // wired so the moment data is real, swap in Tier A/B math here.
  const { data: skuMap } = await admin
    .from('sku_mapping')
    .select('alberts_sku,sales_item_id')
    .eq('verified', true);
  if (!skuMap || skuMap.length === 0) return [];
  const now = new Date().toISOString();

  return skuMap.map((s) => ({
    sales_item_id: (s.sales_item_id as string | null) ?? (s.alberts_sku as string),
    signed_elasticity: null,
    swings_observed: 0,
    insufficient_data: true,
    reason: tierCReason(historyDays, hasInventory, seasonalReady),
    updated_at: now,
  }));
}

function tierCReason(historyDays: number, hasInventory: boolean, seasonalReady: boolean): string {
  const missing: string[] = [];
  if (historyDays < TIER_B_MIN_DAYS) missing.push(`history ${historyDays}d < ${TIER_B_MIN_DAYS}`);
  if (!hasInventory) missing.push('no inventory data (Task #6)');
  if (!seasonalReady) missing.push('no seasonal_index (Task #8 unblocks)');
  return missing.length ? missing.join('; ') : 'tier_a/b_not_implemented_yet';
}

async function upsertElasticity(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  rows: ElasticityRow[],
): Promise<void> {
  if (!rows.length) return;
  const { error } = await admin
    .from('elasticity_hint')
    .upsert(rows, { onConflict: 'sales_item_id' });
  if (error) throw new Error(`elasticity_hint upsert: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function daysBetween(a: string, b: string): number {
  const da = new Date(a + 'T00:00:00Z').getTime();
  const db = new Date(b + 'T00:00:00Z').getTime();
  return Math.round((db - da) / 86_400_000);
}

function round(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

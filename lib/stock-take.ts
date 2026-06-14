// Drift-prioritized stock-take list generator (Feature 3).
//
// For each variant in the requested category, computes:
//   - reported_on_hand   (latest snapshot)
//   - expected_on_hand   (last counted qty - sales since last count)
//   - drift_units / drift_pct
//   - days_since_count
//   - priority_score    (Produce*1.5, high drift*1.5, stale*1.2, negative*2.0)
//
// Returns the top N rows sorted by priority. Designed to be rendered as
// a printable clipboard sheet.

import { createAdminClient } from './supabase/admin';

export interface StockTakeRow {
  thrive_item_id: string;
  thrive_variant_id: string | null;
  sku: string | null;
  name: string;
  department: string | null;
  units_per_case: number | null;
  reported_on_hand: number | null;
  expected_on_hand: number | null;
  drift_units: number | null;
  drift_pct: number | null;
  last_counted_at: string | null;
  days_since_count: number | null;
  priority_score: number;
  flags: string[];
}

export interface StockTakeResult {
  generated_at: string;
  category: string;
  total_candidates: number;
  rows: StockTakeRow[];
}

async function rpcQuery<T = unknown>(sql: string): Promise<T[]> {
  const admin = createAdminClient();
  if (!admin) return [];
  const { data, error } = await admin.rpc('run_report_query', { query_sql: sql });
  if (error) throw new Error(`run_report_query: ${error.message}`);
  return (data as T[]) ?? [];
}

interface ItemRow {
  thrive_item_id: string;
  thrive_variant_id: string | null;
  sku: string | null;
  name: string;
  department: string | null;
  units_per_case: number | string | null;
  reported_on_hand: number | string | null;
  last_counted_at: string | null;
  qty_at_last_count: number | string | null;
}

interface SalesRow { item_id: string; total_units: number | string }

export async function generateStockTake(opts: { category: string; limit?: number; vendorIds?: string[]; activeWindowDays?: number }): Promise<StockTakeResult> {
  const category = opts.category;
  const limit = opts.limit ?? 50;

  // Catalog + latest inventory in one query
  const catSql = `
    SELECT
      c.thrive_item_id, c.thrive_variant_id, c.sku, c.name, c.department,
      c.units_per_case,
      inv.qty_on_hand AS reported_on_hand,
      inv.last_counted_at,
      -- Find qty at last count: in history where snapshot_ts >= last_counted_at and qty_on_hand is not null,
      -- take the oldest after last_counted_at as the post-count snapshot.
      (SELECT h.qty_on_hand FROM thrive_inventory_history h
        WHERE h.thrive_item_id = c.thrive_item_id
          AND h.snapshot_ts >= inv.last_counted_at
          AND h.qty_on_hand IS NOT NULL
        ORDER BY h.snapshot_ts ASC LIMIT 1) AS qty_at_last_count
    FROM thrive_product_catalog c
    LEFT JOIN LATERAL (
      SELECT qty_on_hand, last_counted_at
      FROM thrive_inventory_history h
      WHERE h.thrive_item_id = c.thrive_item_id
      ORDER BY snapshot_ts DESC LIMIT 1
    ) inv ON true
    WHERE c.active = true
      AND c.department = '${category.replace(/'/g, "''")}'
      ${opts.vendorIds && opts.vendorIds.length > 0
        ? `AND (c.primary_vendor_id IS NULL OR c.primary_vendor_id IN (${opts.vendorIds.map((v) => `'${v.replace(/'/g, "''")}'`).join(',')}))`
        : ''}
  `;
  const catalog = await rpcQuery<ItemRow>(catSql);
  if (catalog.length === 0) {
    return { generated_at: new Date().toISOString(), category, total_candidates: 0, rows: [] };
  }

  // Optional activity filter: only items that moved in the last N days.
  // Use a separate query so the IN-list size stays bounded.
  const activityFilter = new Set<string>();
  let activityFilterEnabled = false;
  if (opts.activeWindowDays && opts.activeWindowDays > 0) {
    activityFilterEnabled = true;
    const days = Math.max(1, Math.min(365, Math.floor(opts.activeWindowDays)));
    const activeRows = await rpcQuery<{ item_id: string }>(
      `SELECT DISTINCT item_id FROM thrive_sales_history
        WHERE sale_date >= CURRENT_DATE - INTERVAL '${days} days'`
    );
    for (const r of activeRows) activityFilter.add(r.item_id);
  }

  // For each item, find sum of sales since last_counted_at. We bucket
  // this in one query keyed by item_id, then look up in code.
  // Default the "since" cutoff to last_counted_at OR (now - 30 days) for items never counted.
  const salesSql = `
    WITH latest AS (
      SELECT c.thrive_item_id, l.last_counted_at
      FROM (SELECT DISTINCT thrive_item_id FROM thrive_product_catalog
            WHERE thrive_item_id IS NOT NULL) c
      CROSS JOIN LATERAL (
        SELECT last_counted_at FROM thrive_inventory_history h
        WHERE h.thrive_item_id = c.thrive_item_id
        ORDER BY snapshot_ts DESC LIMIT 1
      ) l
    )
    SELECT s.item_id, SUM(s.units)::numeric AS total_units
    FROM thrive_sales_history s
    LEFT JOIN latest inv ON inv.thrive_item_id = s.item_id
    WHERE s.sale_date >= COALESCE(inv.last_counted_at::date, CURRENT_DATE - INTERVAL '30 days')
    GROUP BY s.item_id
  `;
  const salesRows = await rpcQuery<SalesRow>(salesSql);
  const salesByItem = new Map<string, number>();
  for (const r of salesRows) salesByItem.set(r.item_id, Number(r.total_units ?? 0));

  const now = Date.now();
  const rows: StockTakeRow[] = catalog.map((c) => {
    const reported = c.reported_on_hand != null ? Number(c.reported_on_hand) : null;
    const qtyAtCount = c.qty_at_last_count != null ? Number(c.qty_at_last_count) : null;
    const lastCountTs = c.last_counted_at ? Date.parse(c.last_counted_at) : null;
    const daysSinceCount = lastCountTs ? Math.floor((now - lastCountTs) / 86400000) : null;
    const soldSince = salesByItem.get(c.thrive_item_id) ?? 0;

    // expected_on_hand = max(0, qtyAtCount - soldSince) — only if we have a baseline
    let expected: number | null = null;
    if (qtyAtCount != null) expected = Math.max(0, qtyAtCount - soldSince);

    let driftUnits: number | null = null;
    let driftPct: number | null = null;
    if (reported != null && expected != null) {
      driftUnits = Math.round((reported - expected) * 100) / 100;
      const denom = Math.max(1, expected);
      driftPct = Math.round((Math.abs(driftUnits) / denom) * 1000) / 1000;
    }

    const flags: string[] = [];
    if (reported == null) flags.push('no_inventory');
    if (reported != null && reported < 0) flags.push('negative_on_hand');
    if (driftPct != null && driftPct >= 0.25) flags.push('drift_high');
    if (daysSinceCount != null && daysSinceCount > 30) flags.push('stale_count');
    if (daysSinceCount == null) flags.push('never_counted');

    // Priority score
    let priority = 1.0;
    if (c.department === 'Produce') priority *= 1.5;
    if (driftPct != null && driftPct >= 0.25) priority *= 1.5;
    if (daysSinceCount != null && daysSinceCount > 30) priority *= 1.2;
    if (reported != null && reported < 0) priority *= 2.0;
    if (daysSinceCount == null) priority *= 1.2; // never-counted bias
    priority = Math.round(priority * 100) / 100;

    return {
      thrive_item_id: c.thrive_item_id,
      thrive_variant_id: c.thrive_variant_id,
      sku: c.sku,
      name: c.name,
      department: c.department,
      units_per_case: c.units_per_case != null ? Number(c.units_per_case) : null,
      reported_on_hand: reported,
      expected_on_hand: expected,
      drift_units: driftUnits,
      drift_pct: driftPct,
      last_counted_at: c.last_counted_at,
      days_since_count: daysSinceCount,
      priority_score: priority,
      flags,
    };
  });

  const filteredRows = activityFilterEnabled
    ? rows.filter((r) => activityFilter.has(r.thrive_item_id))
    : rows;
  filteredRows.sort((a, b) => {
    if (b.priority_score !== a.priority_score) return b.priority_score - a.priority_score;
    // tiebreak alphabetical
    return a.name.localeCompare(b.name);
  });

  return {
    generated_at: new Date().toISOString(),
    category,
    total_candidates: filteredRows.length,
    rows: filteredRows.slice(0, limit),
  };
}

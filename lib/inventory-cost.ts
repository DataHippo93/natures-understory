/**
 * Live Thrive inventory cost lookup.
 *
 * Source of truth for COST in pricing/ordering decisions. Order of preference:
 *
 *   1. last_receipt  →  thrive_inventory_latest.raw_response.current_lot_unit_cost_cents
 *                       (the cost on the most recent inventory lot — actual receipt $)
 *   2. default       →  thrive_product_catalog.default_cost_cents
 *                       (catalog default — STALE; chip warns Clark)
 *   3. missing       →  neither source available
 *
 * Why default is stale: it only updates when someone hand-edits the SKU's
 * default cost in Thrive. The last_receipt cost moves every time a PO is
 * received. For ~13% of SKUs we have no last_receipt cost because they've
 * never been received against (new SKUs, kits, etc.) — default is the best
 * we can do, and Clark gets a chip so he knows.
 *
 * (Eventually a third tier — Albert's pricelist — will land. The table
 * exists but is empty pending pipeline fix #2.)
 */

import { createAdminClient } from './supabase/admin';

export type CostSource = 'last_receipt' | 'default' | 'missing';

export interface InventoryCost {
  /** cost per unit in dollars (0 if missing) */
  dollars: number;
  /** which fallback tier this came from */
  source: CostSource;
}

const MISSING: InventoryCost = { dollars: 0, source: 'missing' };

/**
 * Bulk lookup. Resolves cost for every requested thrive_item_id (item-level,
 * NOT variant-level — current_lot_unit_cost_cents lives on the variant
 * snapshot but the snapshot is keyed by item).
 *
 * Returns a Map from thrive_item_id → InventoryCost. Items not found resolve
 * to {dollars: 0, source: 'missing'}.
 */
export async function getInventoryCosts(
  thriveItemIds: string[]
): Promise<Map<string, InventoryCost>> {
  const out = new Map<string, InventoryCost>();
  if (!thriveItemIds.length) return out;
  const admin = createAdminClient();
  if (!admin) return out;

  // Dedupe + sanitize for SQL inlining (item IDs are numeric strings).
  const ids = Array.from(new Set(thriveItemIds.filter((i) => /^\d+$/.test(i))));
  if (!ids.length) return out;
  const inList = ids.map((i) => `'${i}'`).join(',');

  const sql = `
    SELECT
      c.thrive_item_id,
      c.default_cost_cents,
      (l.raw_response->>'current_lot_unit_cost_cents')::int AS lot_cost_cents
    FROM thrive_product_catalog c
    LEFT JOIN thrive_inventory_latest l
      ON l.thrive_item_id = c.thrive_item_id
    WHERE c.thrive_item_id IN (${inList})
  `;
  const { data, error } = await admin.rpc('run_report_query', { query_sql: sql });
  if (error) return out;

  for (const row of (data ?? []) as Array<{
    thrive_item_id: string;
    default_cost_cents: number | null;
    lot_cost_cents: number | null;
  }>) {
    const lot = row.lot_cost_cents;
    const def = row.default_cost_cents;
    if (lot != null && lot > 0) {
      out.set(String(row.thrive_item_id), { dollars: lot / 100, source: 'last_receipt' });
    } else if (def != null && def > 0) {
      out.set(String(row.thrive_item_id), { dollars: def / 100, source: 'default' });
    } else {
      out.set(String(row.thrive_item_id), MISSING);
    }
  }
  return out;
}

/** Same as getInventoryCosts but keyed on thrive_variant_id. */
export async function getInventoryCostsByVariant(
  thriveVariantIds: string[]
): Promise<Map<string, InventoryCost>> {
  const out = new Map<string, InventoryCost>();
  if (!thriveVariantIds.length) return out;
  const admin = createAdminClient();
  if (!admin) return out;

  const ids = Array.from(new Set(thriveVariantIds.filter((i) => /^\d+$/.test(i))));
  if (!ids.length) return out;
  const inList = ids.map((i) => `'${i}'`).join(',');

  // catalog row keyed by variant_id; inventory_latest keyed by item_id.
  const sql = `
    SELECT
      c.thrive_variant_id,
      c.default_cost_cents,
      (l.raw_response->>'current_lot_unit_cost_cents')::int AS lot_cost_cents
    FROM thrive_product_catalog c
    LEFT JOIN thrive_inventory_latest l
      ON l.thrive_item_id = c.thrive_item_id
    WHERE c.thrive_variant_id IN (${inList})
  `;
  const { data, error } = await admin.rpc('run_report_query', { query_sql: sql });
  if (error) return out;

  for (const row of (data ?? []) as Array<{
    thrive_variant_id: string;
    default_cost_cents: number | null;
    lot_cost_cents: number | null;
  }>) {
    const lot = row.lot_cost_cents;
    const def = row.default_cost_cents;
    if (lot != null && lot > 0) {
      out.set(String(row.thrive_variant_id), { dollars: lot / 100, source: 'last_receipt' });
    } else if (def != null && def > 0) {
      out.set(String(row.thrive_variant_id), { dollars: def / 100, source: 'default' });
    } else {
      out.set(String(row.thrive_variant_id), MISSING);
    }
  }
  return out;
}

/** Display label for a cost-source chip. */
export function costSourceLabel(s: CostSource): string {
  switch (s) {
    case 'last_receipt': return 'last receipt';
    case 'default':      return 'catalog default — stale';
    case 'missing':      return 'no cost on file';
  }
}

/** Color hint for the chip (matches Tailwind palette already used in the app). */
export function costSourceTone(s: CostSource): 'ok' | 'warn' | 'bad' {
  switch (s) {
    case 'last_receipt': return 'ok';
    case 'default':      return 'warn';
    case 'missing':      return 'bad';
  }
}

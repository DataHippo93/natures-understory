// Evaluates "what would we order right now" for Produce — v1 with
// loss-aware velocity + profit-center verdict + notes-driven overrides.
//
// Pipeline:
//   1. thrive_product_catalog (Produce, active)            -> SKU rows
//   2. thrive_inventory_latest                              -> current_on_hand
//   3. thrive_sales_history (30d + 7d windows)              -> raw velocity
//   4. loss_ledger (fuzzy name-match)                       -> loss_units_30d
//   5. clean velocity = raw - loss                          -> velocity_per_day_clean
//   6. produce_vendors (Albert's next truck)                -> target_dos
//   7. profit-center math (unit_cost, sticky_retail,        -> verdict
//      loss_rate_30d, expected_margin_pct, core-staple)
//   8. notes parser (apply add/skip/s/o overrides)          -> NextOrderRow.override_*
//
// All "clean" math excludes loss-tally units. Raw exposes the noise for
// transparency; suggested_cases is computed against clean velocity.

import { createAdminClient } from './supabase/admin';
import { getInventoryCosts, type CostSource } from './inventory-cost';
import { loadLossByItem30d } from './loss-match';
import { isCoreStaple } from './core-staples';
import { parseNotes, type ParsedAction, type Catalog as ParserCatalog } from './notes-parser';

export interface NextOrderRow {
  thrive_item_id: string;
  thrive_variant_id: string | null;
  sku: string | null;
  name: string;
  department: string | null;

  // Inventory
  current_on_hand: number | null;
  inventory_snapshot_ts: string | null;

  // Velocity (raw + clean)
  velocity_per_day_raw: number;
  velocity_per_day_clean: number;
  velocity_per_week_clean: number;
  velocity_per_day_7d_clean: number;
  units_sold_30d_raw: number;
  units_lost_30d: number;
  velocity_signal_days: number;       // sale-days observed in 30d (data confidence)

  // Days-of-supply
  days_of_supply: number | null;

  // Vendor + truck
  vendor_id: string | null;
  vendor_name: string | null;
  next_truck_date: string | null;
  days_until_truck: number | null;
  target_dos: number | null;          // overrides[<order_day>]  ??  gap × buffer_mult
  target_dos_source: 'override' | 'multiplier' | 'fallback' | null;

  // Pack + suggestion
  units_per_case: number | null;
  suggested_units: number;
  suggested_cases: number;

  // Profit-center
  sticky_retail_dollars: number | null;
  unit_cost_dollars: number | null;
  cost_source: CostSource;        // last_receipt | default | missing
  loss_rate_30d: number;              // 0..1
  expected_margin_pct: number | null;
  is_core_staple: boolean;
  verdict: 'BUY' | 'SKIP' | 'REVIEW';
  verdict_reason: string;

  // UI
  confidence: number;
  rationale: string[];
  flags: string[];

  // Overrides (from notes parser; null if no override)
  override_cases: number | null;
  override_reason: string | null;
  override_kind: 'add' | 'skip' | 'so' | null;
  override_so_customer: string | null;
  override_note: string | null;
}

export interface NextOrderEvaluation {
  evaluated_at: string;
  inventory_snapshot_ts: string | null;
  rows: NextOrderRow[];
  parsed_notes: ParsedAction[];
  totals: {
    items: number;
    suggested_cases_total: number;
    suggested_dollars_total: number;
    buy_count: number;
    skip_count: number;
    review_count: number;
  };
  /** Set when the evaluation degraded due to an upstream error
   *  (e.g. missing table, broken RPC). Page renders an empty state +
   *  a UI-side warning chip instead of crashing. */
  error?: string;
}

const TZ = 'America/New_York';
const PROFIT_CENTER_MIN_MARGIN = 0.40;

// Vendor schedule fallback (used when produce_vendors row is missing).
const FALLBACK_SCHEDULE: Record<string, string[]> = {
  alberts:        ['monday', 'thursday'],
  "albert's":     ['monday', 'thursday'],
  kents:          ['tuesday'],
  "kent's":       ['tuesday'],
  birdsfoot:      ['thursday'],
  'brandy-view':  ['sunday'],
  'deep root farm':['thursday'],
  'holton farms': ['wednesday'],
  'house of greens':['wednesday'],
};

const TZ_FMT = new Intl.DateTimeFormat('en-CA', { timeZone: TZ });
function todayNY(): string {
  // Use 'sv-SE' formatter trick? simpler: en-CA gives YYYY-MM-DD.
  return new Date().toLocaleDateString('en-CA', { timeZone: TZ });
}
function weekdayOf(dateStr: string): string {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', timeZone: TZ }).toLowerCase();
}
function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString('en-CA');
}
function nextOrderDate(orderDays: string[] | null | undefined, fromISO?: string): { date: string; daysOut: number } | null {
  if (!orderDays || orderDays.length === 0) return null;
  const start = fromISO ?? todayNY();
  const set = new Set(orderDays.map((d) => d.toLowerCase()));
  for (let i = 0; i < 14; i++) {
    const d = addDays(start, i);
    if (set.has(weekdayOf(d))) return { date: d, daysOut: i };
  }
  return null;
}

const DAY_KEYS: Record<string, string> = {
  monday: 'mon', tuesday: 'tue', wednesday: 'wed', thursday: 'thu',
  friday: 'fri', saturday: 'sat', sunday: 'sun',
};

/**
 * Target days-of-supply per order day. Order of preference:
 *   1. vendor.target_dos_overrides[<short day key>]  (explicit per-weekday)
 *   2. gap_to_next_truck * vendor.target_buffer_multiplier
 *   3. gap × 1.5 (legacy default)
 */
function targetDosFor(
  vendor: VendorMapRow | null,
  orderDays: string[] | null | undefined,
  fromISO?: string
): { trucks: [string, string] | null; targetDos: number | null; source: 'override' | 'multiplier' | 'fallback' | null } {
  const t1 = nextOrderDate(orderDays, fromISO);
  if (!t1) return { trucks: null, targetDos: null, source: null };

  // Lookup an explicit override for THIS order's weekday first.
  const t1day = weekdayOf(t1.date);                  // e.g. "monday"
  const shortKey = DAY_KEYS[t1day] ?? t1day.slice(0, 3);
  const overrides = vendor?.target_dos_overrides ?? null;
  if (overrides && typeof overrides === 'object') {
    const raw = overrides[shortKey] ?? overrides[t1day];
    if (raw != null) {
      const v = Number(raw);
      if (Number.isFinite(v) && v > 0) {
        const t2 = nextOrderDate(orderDays, addDays(t1.date, 1));
        return { trucks: t2 ? [t1.date, t2.date] : [t1.date, ''], targetDos: Math.round(v * 10) / 10, source: 'override' };
      }
    }
  }

  // Else compute gap × multiplier.
  const t2 = nextOrderDate(orderDays, addDays(t1.date, 1));
  if (!t2) return { trucks: [t1.date, ''], targetDos: 4.5, source: 'fallback' };
  const gap = Math.max(
    1,
    Math.round((new Date(t2.date + 'T12:00:00').getTime() - new Date(t1.date + 'T12:00:00').getTime()) / 86_400_000)
  );
  const mult = Number(vendor?.target_buffer_multiplier ?? 1.5);
  const safeMult = Number.isFinite(mult) && mult > 0 ? mult : 1.5;
  return {
    trucks: [t1.date, t2.date],
    targetDos: Math.round(gap * safeMult * 10) / 10,
    source: safeMult === 1.5 ? 'fallback' : 'multiplier',
  };
}

interface CatalogRow {
  thrive_item_id: string;
  thrive_variant_id: string;
  sku: string | null;
  name: string;
  department: string | null;
  units_per_case: number | string | null;
  price_cents: number | null;
  default_cost_cents: number | null;
  primary_vendor_id: string | null;
}
interface InventoryRow {
  thrive_item_id: string;
  qty_on_hand: number | string | null;
  snapshot_ts: string;
  last_counted_at: string | null;
  confidence: number | string | null;
}
interface VendorMapRow {
  thrive_vendor_id: string | null;
  display_name: string;
  order_days: string[] | null;
  target_buffer_multiplier: number | string | null;
  target_dos_overrides: Record<string, number | string> | null;
}
interface SalesAggRow {
  item_id: string;
  units_30d: number | string;
  units_7d: number | string;
  days_30d: number;
}

async function rpc<T = unknown>(sql: string): Promise<T[]> {
  const admin = createAdminClient();
  if (!admin) return [];
  const { data, error } = await admin.rpc('run_report_query', { query_sql: sql });
  if (error) throw new Error(`run_report_query: ${error.message}`);
  return (data as T[]) ?? [];
}

async function _evaluateNextProduceOrderImpl(opts: { notes?: string } = {}): Promise<NextOrderEvaluation> {
  const today = todayNY();
  const evaluatedAt = new Date().toISOString();

  // 1. Catalog (active Produce)
  const catalog = await rpc<CatalogRow>(`
    SELECT thrive_item_id, thrive_variant_id, sku, name, department,
           units_per_case, price_cents, default_cost_cents, primary_vendor_id
    FROM thrive_product_catalog
    WHERE active = true AND department = 'Produce'
  `);
  if (catalog.length === 0) {
    return { evaluated_at: evaluatedAt, inventory_snapshot_ts: null, rows: [], parsed_notes: [], totals: { items: 0, suggested_cases_total: 0, suggested_dollars_total: 0, buy_count: 0, skip_count: 0, review_count: 0 } };
  }

  // 2. Inventory (latest per item)
  const itemIds = catalog.map((c) => `'${c.thrive_item_id.replace(/'/g, "''")}'`);
  const inventory = await rpc<InventoryRow>(`
    SELECT thrive_item_id, qty_on_hand, snapshot_ts, last_counted_at, confidence
    FROM thrive_inventory_latest
    WHERE thrive_item_id IN (${itemIds.join(',')})
  `);
  const invByItem = new Map<string, InventoryRow>();
  let latestSnapshotTs: string | null = null;
  for (const r of inventory) {
    invByItem.set(r.thrive_item_id, r);
    if (!latestSnapshotTs || r.snapshot_ts > latestSnapshotTs) latestSnapshotTs = r.snapshot_ts;
  }

  // 2b. Live inventory cost (last-receipt) with fallback chain — keyed by item.
  const invCostByItem = await getInventoryCosts(catalog.map((c) => c.thrive_item_id));

  // 3. Sales velocity (30d + 7d)
  const sales = await rpc<SalesAggRow>(`
    SELECT item_id,
      SUM(units)::numeric AS units_30d,
      SUM(CASE WHEN sale_date >= CURRENT_DATE - INTERVAL '7 days' THEN units ELSE 0 END)::numeric AS units_7d,
      COUNT(DISTINCT sale_date)::int AS days_30d
    FROM thrive_sales_history
    WHERE sale_date >= CURRENT_DATE - INTERVAL '30 days'
      AND item_id IN (${itemIds.join(',')})
    GROUP BY item_id
  `);
  const salesByItem = new Map<string, { units_30d: number; units_7d: number; days_30d: number }>();
  for (const r of sales) {
    salesByItem.set(r.item_id, {
      units_30d: Number(r.units_30d ?? 0),
      units_7d: Number(r.units_7d ?? 0),
      days_30d: Number(r.days_30d ?? 0),
    });
  }

  // 4. Loss exclusion (fuzzy name match)
  const lossByItem = await loadLossByItem30d(catalog.map((c) => ({ thrive_item_id: c.thrive_item_id, name: c.name })));

  // 5. Vendor map
  let vendors: VendorMapRow[] = [];
  try {
    vendors = await rpc<VendorMapRow>(`SELECT thrive_vendor_id, display_name, order_days, target_buffer_multiplier, target_dos_overrides FROM produce_vendors WHERE active = true`);
  } catch { /* table may not exist on first deploy */ }
  const vendorById = new Map<string, VendorMapRow>();
  for (const v of vendors) if (v.thrive_vendor_id) vendorById.set(v.thrive_vendor_id, v);

  // 6. Build rows
  const parserCatalog: ParserCatalog[] = catalog.map((c) => ({ thrive_item_id: c.thrive_item_id, name: c.name }));
  const parsedNotes = opts.notes ? parseNotes(opts.notes, parserCatalog) : [];

  // Map parsed actions by item for quick row-side lookup
  const overrideByItem = new Map<string, ParsedAction[]>();
  for (const a of parsedNotes) {
    if (a.kind === 'noop') continue;
    const arr = overrideByItem.get(a.itemId) ?? [];
    arr.push(a);
    overrideByItem.set(a.itemId, arr);
  }

  const rows: NextOrderRow[] = [];
  for (const c of catalog) {
    const inv = invByItem.get(c.thrive_item_id);
    const qty = inv?.qty_on_hand != null ? Number(inv.qty_on_hand) : null;
    const sale = salesByItem.get(c.thrive_item_id) ?? { units_30d: 0, units_7d: 0, days_30d: 0 };
    const lossUnits = lossByItem.get(c.thrive_item_id) ?? 0;

    const units_sold_30d_raw = sale.units_30d;
    const units_sold_30d_clean = Math.max(0, units_sold_30d_raw - lossUnits);
    const velocity_per_day_raw = units_sold_30d_raw / 30;
    const velocity_per_day_clean = units_sold_30d_clean / 30;
    const velocity_per_day_7d_clean = Math.max(0, sale.units_7d - (lossUnits * 7 / 30)) / 7;

    const dos = (velocity_per_day_clean > 0 && qty != null) ? qty / velocity_per_day_clean : null;

    // Vendor
    let vendor: VendorMapRow | null = null;
    if (c.primary_vendor_id) vendor = vendorById.get(c.primary_vendor_id) ?? null;
    let orderDays: string[] = vendor?.order_days ?? [];
    let scheduleSource: 'db' | 'fallback' | 'none' = vendor ? 'db' : 'none';
    if (!vendor) { orderDays = FALLBACK_SCHEDULE['alberts']; scheduleSource = 'fallback'; }
    const { trucks, targetDos, source: targetDosSource } = targetDosFor(vendor, orderDays, today);
    const next_truck_date = trucks ? trucks[0] : null;
    const days_until_truck = next_truck_date ? Math.round((new Date(next_truck_date + 'T12:00:00').getTime() - new Date(today + 'T12:00:00').getTime()) / 86_400_000) : null;

    // Suggested order
    const unitsPerCase = c.units_per_case != null ? Number(c.units_per_case) : null;
    let suggested_units = 0;
    if (targetDos != null && qty != null && velocity_per_day_clean > 0) {
      suggested_units = Math.max(0, targetDos * velocity_per_day_clean - qty);
    }
    let suggested_cases = unitsPerCase && unitsPerCase > 0 ? Math.ceil(suggested_units / unitsPerCase) : 0;

    // Profit-center
    const sticky_retail_dollars = c.price_cents != null && c.price_cents > 0 ? c.price_cents / 100 : null;

    // Cost: prefer live inventory (last receipt), then catalog default,
    // then mark missing. Per-case → per-unit normalisation kicks in only
    // for the catalog-default path; current_lot_unit_cost is already per
    // selling unit. (Same assumption Thrive uses internally.)
    const invCost = invCostByItem.get(c.thrive_item_id);
    const cost_source: CostSource = invCost?.source ?? 'missing';
    let unit_cost_dollars: number | null = null;
    if (invCost && invCost.source === 'last_receipt') {
      unit_cost_dollars = invCost.dollars;
    } else if (c.default_cost_cents != null && c.default_cost_cents > 0) {
      unit_cost_dollars = unitsPerCase && unitsPerCase > 0
        ? c.default_cost_cents / 100 / unitsPerCase
        : c.default_cost_cents / 100;
    }
    // loss_rate = loss/(loss + sold_clean) — fraction of throughput that becomes loss
    const throughput_30d = units_sold_30d_clean + lossUnits;
    const loss_rate_30d = throughput_30d > 0 ? lossUnits / throughput_30d : 0;
    const expected_margin_pct = (sticky_retail_dollars != null && unit_cost_dollars != null && sticky_retail_dollars > 0)
      ? (sticky_retail_dollars * (1 - loss_rate_30d) - unit_cost_dollars) / sticky_retail_dollars
      : null;
    const core_staple = isCoreStaple(c.name);

    let verdict: 'BUY' | 'SKIP' | 'REVIEW' = 'REVIEW';
    let verdict_reason = '';
    if (core_staple) {
      verdict = 'BUY';
      verdict_reason = 'core staple — always stock';
    } else if (expected_margin_pct == null) {
      verdict = 'REVIEW';
      verdict_reason = 'missing cost or retail';
    } else if (expected_margin_pct >= PROFIT_CENTER_MIN_MARGIN) {
      verdict = 'BUY';
      verdict_reason = `margin ${(expected_margin_pct * 100).toFixed(0)}%`;
    } else {
      verdict = 'SKIP';
      const lossPct = loss_rate_30d * 100;
      verdict_reason = lossPct >= 15
        ? `loss rate ${lossPct.toFixed(0)}% (margin only ${(expected_margin_pct * 100).toFixed(0)}%)`
        : `margin too thin: ${(expected_margin_pct * 100).toFixed(0)}%`;
    }

    // Confidence
    const invAgeHrs = inv ? (Date.now() - Date.parse(inv.snapshot_ts)) / 3_600_000 : null;
    let conf = 1.0;
    if (qty == null) conf *= 0.3;
    else if (invAgeHrs != null) conf *= Math.max(0.3, 1 - invAgeHrs / (24 * 14));
    conf *= sale.days_30d >= 14 ? 1.0 : Math.max(0.4, sale.days_30d / 14);
    if (scheduleSource === 'fallback') conf *= 0.85;
    conf = Math.round(conf * 100) / 100;

    // Flags + rationale
    const flags: string[] = [];
    if (qty == null) flags.push('no_inventory');
    if (qty != null && qty < 0) flags.push('negative_on_hand');
    if (sale.days_30d < 7) flags.push('low_velocity_signal');
    if (lossUnits > 0 && lossUnits >= units_sold_30d_raw * 0.10) flags.push('high_loss_rate');
    if (scheduleSource === 'fallback') flags.push('vendor_mapping_fallback');
    if (verdict === 'SKIP') flags.push('profit_center_skip');
    if (cost_source === 'default') flags.push('cost_stale');
    if (cost_source === 'missing') flags.push('cost_missing');

    const rationale: string[] = [];
    if (dos != null) rationale.push(`${dos.toFixed(1)}d supply at ${velocity_per_day_clean.toFixed(2)} u/d clean`);
    if (lossUnits > 0) rationale.push(`${lossUnits.toFixed(1)} u lost in last 30d (excluded)`);
    if (targetDos != null && next_truck_date) rationale.push(`truck ${days_until_truck === 0 ? 'today' : `in ${days_until_truck}d`}; target ${targetDos}d cover`);
    if (verdict_reason) rationale.push(verdict_reason);

    // Overrides
    const overrides = overrideByItem.get(c.thrive_item_id) ?? [];
    let override_cases: number | null = null;
    let override_reason: string | null = null;
    let override_kind: 'add' | 'skip' | 'so' | null = null;
    let override_so_customer: string | null = null;
    let override_note: string | null = null;
    for (const a of overrides) {
      if (a.kind === 'skip') {
        override_cases = 0;
        override_reason = 'skipped via notes';
        override_kind = 'skip';
      } else if (a.kind === 'add') {
        const cs = a.unit === 'cases' ? a.qty : (unitsPerCase && unitsPerCase > 0 ? Math.ceil(a.qty / unitsPerCase) : a.qty);
        override_cases = (override_cases ?? 0) + cs;
        override_reason = (override_reason ? override_reason + '; ' : '') + `+${cs}cs via notes`;
        override_kind = override_kind ?? 'add';
      } else if (a.kind === 'so') {
        const cs = a.unit === 'cases' ? a.qty : (unitsPerCase && unitsPerCase > 0 ? Math.ceil(a.qty / unitsPerCase) : a.qty);
        override_cases = (override_cases ?? 0) + cs;
        override_reason = (override_reason ? override_reason + '; ' : '') + `S/O ${a.customer} +${cs}cs`;
        override_kind = 'so';
        override_so_customer = a.customer;
      } else if (a.kind === 'note') {
        override_note = a.text;
      }
    }
    // Final case count after overrides
    const final_cases = override_cases != null ? override_cases : (verdict === 'SKIP' ? 0 : suggested_cases);

    rows.push({
      thrive_item_id: c.thrive_item_id,
      thrive_variant_id: c.thrive_variant_id,
      sku: c.sku,
      name: c.name,
      department: c.department,
      current_on_hand: qty,
      inventory_snapshot_ts: inv?.snapshot_ts ?? null,
      velocity_per_day_raw: Math.round(velocity_per_day_raw * 100) / 100,
      velocity_per_day_clean: Math.round(velocity_per_day_clean * 100) / 100,
      velocity_per_week_clean: Math.round(velocity_per_day_clean * 7 * 10) / 10,
      velocity_per_day_7d_clean: Math.round(velocity_per_day_7d_clean * 100) / 100,
      units_sold_30d_raw: Math.round(units_sold_30d_raw * 10) / 10,
      units_lost_30d: Math.round(lossUnits * 10) / 10,
      velocity_signal_days: sale.days_30d,
      days_of_supply: dos != null ? Math.round(dos * 10) / 10 : null,
      vendor_id: c.primary_vendor_id,
      vendor_name: vendor?.display_name ?? (scheduleSource === 'fallback' ? "Albert's (fallback)" : null),
      next_truck_date,
      days_until_truck,
      target_dos: targetDos,
      target_dos_source: targetDosSource,
      units_per_case: unitsPerCase,
      suggested_units: Math.round(suggested_units * 10) / 10,
      suggested_cases: final_cases,
      sticky_retail_dollars,
      unit_cost_dollars: unit_cost_dollars != null ? Math.round(unit_cost_dollars * 100) / 100 : null,
      cost_source,
      loss_rate_30d: Math.round(loss_rate_30d * 1000) / 1000,
      expected_margin_pct: expected_margin_pct != null ? Math.round(expected_margin_pct * 1000) / 1000 : null,
      is_core_staple: core_staple,
      verdict,
      verdict_reason,
      confidence: conf,
      rationale,
      flags,
      override_cases,
      override_reason,
      override_kind,
      override_so_customer,
      override_note,
    });
  }

  // Sort: BUY+suggested first (by urgency), then REVIEW, then SKIP, then no-suggest
  rows.sort((a, b) => {
    const aBand = a.suggested_cases > 0 ? 0 : (a.verdict === 'REVIEW' ? 1 : (a.verdict === 'SKIP' ? 2 : 3));
    const bBand = b.suggested_cases > 0 ? 0 : (b.verdict === 'REVIEW' ? 1 : (b.verdict === 'SKIP' ? 2 : 3));
    if (aBand !== bBand) return aBand - bBand;
    const aDos = a.days_of_supply ?? 999;
    const bDos = b.days_of_supply ?? 999;
    return aDos - bDos;
  });

  const totals = {
    items: rows.length,
    suggested_cases_total: rows.reduce((s, r) => s + r.suggested_cases, 0),
    suggested_dollars_total: rows.reduce((s, r) => {
      if (r.suggested_cases <= 0 || !r.unit_cost_dollars || !r.units_per_case) return s;
      return s + r.suggested_cases * r.units_per_case * r.unit_cost_dollars;
    }, 0),
    buy_count: rows.filter((r) => r.verdict === 'BUY').length,
    skip_count: rows.filter((r) => r.verdict === 'SKIP').length,
    review_count: rows.filter((r) => r.verdict === 'REVIEW').length,
  };

  return {
    evaluated_at: evaluatedAt,
    inventory_snapshot_ts: latestSnapshotTs,
    rows,
    parsed_notes: parsedNotes,
    totals,
  };
}


/**
 * Safety wrapper: any single-table failure degrades to an empty evaluation
 * with the error captured in the returned `error` field instead of
 * crashing the Server Component. This keeps the page rendering even when
 * loss_ledger / alberts_price_entries / inventory_adjustment_queue
 * aren't populated yet.
 */
export async function evaluateNextProduceOrder(opts: { notes?: string } = {}): Promise<NextOrderEvaluation & { error?: string }> {
  try {
    return await _evaluateNextProduceOrderImpl(opts);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Log so it shows up in Vercel function logs alongside the digest
    console.error('[next-produce] evaluation failed:', msg);
    return {
      evaluated_at: new Date().toISOString(),
      inventory_snapshot_ts: null,
      rows: [],
      parsed_notes: [],
      totals: { items: 0, suggested_cases_total: 0, suggested_dollars_total: 0, buy_count: 0, skip_count: 0, review_count: 0 },
      error: msg,
    };
  }
}

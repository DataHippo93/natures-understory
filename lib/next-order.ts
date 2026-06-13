// Evaluates "what would we order right now" for produce.
//
// Joins thrive_inventory_latest × thrive_sales_history × thrive_product_catalog
// to compute per-SKU current on-hand, 30-day velocity, days-of-supply,
// and a suggested order quantity for the next vendor truck.
//
// The vendor schedule is read from public.produce_vendors (Feature 2).
// Vendors without a row default to a hardcoded fallback so the page
// works even before the produce_vendors seed lands.

import { createAdminClient } from './supabase/admin';

export interface NextOrderRow {
  thrive_item_id: string;
  thrive_variant_id: string | null;
  sku: string | null;
  name: string;
  department: string | null;
  current_on_hand: number | null;
  velocity_per_day: number;
  velocity_per_week: number;
  days_of_supply: number | null;   // null if velocity 0
  vendor_id: string | null;
  vendor_name: string | null;
  next_truck_date: string | null;
  days_until_truck: number | null;
  units_per_case: number | null;
  suggested_units: number;
  suggested_cases: number;
  suggested_price_dollars: number | null;
  confidence: number;
  rationale: string[];
  flags: string[];
}

export interface NextOrderEvaluation {
  evaluated_at: string;
  inventory_snapshot_ts: string | null;
  rows: NextOrderRow[];
}

const BUFFER_DAYS = 1;
const TZ = 'America/New_York';

// Hardcoded vendor schedule fallback for vendors not yet in produce_vendors.
// Lowercase weekday names. Matches the seed migration but works without it.
const FALLBACK_SCHEDULE: Record<string, string[]> = {
  alberts:        ['monday', 'thursday'],
  'albert\'s':    ['monday', 'thursday'],
  kents:          ['tuesday'],
  'kent\'s':      ['tuesday'],
  birdsfoot:      ['thursday'],
  'martin\'s farmstand': [],
  'house of greens': ['wednesday'],
  'canton apples': [],
  'ferris ridge':  [],
  'brandy-view':   ['sunday'],
  'deep root farm':['thursday'],
  'holton farms':  ['wednesday'],
};

function todayNY(): string {
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

interface InventoryRow {
  thrive_item_id: string;
  item_name: string;
  qty_on_hand: number | string | null;
  snapshot_ts: string;
  last_counted_at: string | null;
  confidence: number | string | null;
}

interface CatalogRow {
  thrive_item_id: string;
  thrive_variant_id: string;
  sku: string | null;
  name: string;
  department: string | null;
  units_per_case: number | string | null;
  price_cents: number | null;
  primary_vendor_id: string | null;
  active: boolean;
}

interface VendorMapRow {
  thrive_vendor_id: string | null;
  display_name: string;
  order_days: string[] | null;
}

interface SalesAggRow {
  item_id: string;
  total_units: number | string;
  days_with_sales: number;
}

/**
 * Run a Supabase RPC `run_report_query` returning an array of rows.
 * Falls back to an empty array on missing admin client.
 */
async function rpcQuery<T = unknown>(sql: string): Promise<T[]> {
  const admin = createAdminClient();
  if (!admin) return [];
  const { data, error } = await admin.rpc('run_report_query', { query: sql });
  if (error) throw new Error(`run_report_query: ${error.message}`);
  return (data as T[]) ?? [];
}

/** Compute confidence per SKU. */
function computeConfidence(opts: {
  inventoryAgeHrs: number | null;
  hasInventory: boolean;
  salesDays: number;
  hasVendor: boolean;
}): number {
  let c = 1.0;
  // Inventory freshness: 1.0 at <24h, decays linearly to 0.3 at 7d
  if (!opts.hasInventory) c *= 0.3;
  else if (opts.inventoryAgeHrs !== null) {
    const dayFactor = Math.max(0.3, 1.0 - opts.inventoryAgeHrs / (24 * 14));
    c *= dayFactor;
  }
  // Velocity sample size
  if (opts.salesDays >= 14) c *= 1.0;
  else c *= Math.max(0.4, opts.salesDays / 14);
  // Vendor mapping
  if (!opts.hasVendor) c *= 0.6;
  return Math.round(c * 100) / 100;
}

export async function evaluateNextProduceOrder(): Promise<NextOrderEvaluation> {
  const today = todayNY();
  const evaluatedAt = new Date().toISOString();

  // Vendor schedule from DB (with fallback)
  let dbVendors: VendorMapRow[] = [];
  try {
    dbVendors = await rpcQuery<VendorMapRow>(`
      SELECT thrive_vendor_id, display_name, order_days
      FROM produce_vendors WHERE active = true
    `);
  } catch {
    /* table may not exist yet; fall through to hardcoded */
  }

  // 30-day sales velocity by item (variant rolls up to item)
  const salesRows = await rpcQuery<SalesAggRow>(`
    SELECT item_id, SUM(units)::numeric AS total_units, COUNT(DISTINCT sale_date)::int AS days_with_sales
    FROM thrive_sales_history
    WHERE sale_date >= (CURRENT_DATE - INTERVAL '30 days')
    GROUP BY item_id
  `);
  const salesByItem = new Map<string, { units: number; days: number }>();
  for (const r of salesRows) {
    const units = Number(r.total_units ?? 0);
    salesByItem.set(r.item_id, { units, days: Number(r.days_with_sales ?? 0) });
  }

  // Produce catalog (filter to active Produce dept items)
  const catalog = await rpcQuery<CatalogRow>(`
    SELECT thrive_item_id, thrive_variant_id, sku, name, department,
           units_per_case, price_cents, primary_vendor_id, active
    FROM thrive_product_catalog
    WHERE active = true AND department = 'Produce'
  `);
  if (catalog.length === 0) {
    return { evaluated_at: evaluatedAt, inventory_snapshot_ts: null, rows: [] };
  }

  // Latest inventory snapshot for these items
  const itemIds = catalog.map((c) => `'${c.thrive_item_id.replace(/'/g, "''")}'`).slice(0, 5000);
  const inventory = itemIds.length
    ? await rpcQuery<InventoryRow>(`
        SELECT thrive_item_id, item_name, qty_on_hand, snapshot_ts, last_counted_at, confidence
        FROM thrive_inventory_latest
        WHERE thrive_item_id IN (${itemIds.join(',')})
      `)
    : [];

  const invByItem = new Map<string, InventoryRow>();
  let latestSnapshotTs: string | null = null;
  for (const row of inventory) {
    invByItem.set(row.thrive_item_id, row);
    if (!latestSnapshotTs || row.snapshot_ts > latestSnapshotTs) latestSnapshotTs = row.snapshot_ts;
  }

  // Pick a vendor schedule for each item.
  // Strategy: catalog.primary_vendor_id -> match against produce_vendors.thrive_vendor_id.
  // Fall back to FALLBACK_SCHEDULE keyed on the lowercase display name if no DB row.
  const vendorById = new Map<string, VendorMapRow>();
  for (const v of dbVendors) {
    if (v.thrive_vendor_id) vendorById.set(v.thrive_vendor_id, v);
  }

  const out: NextOrderRow[] = [];

  for (const c of catalog) {
    const inv = invByItem.get(c.thrive_item_id);
    const qty = inv?.qty_on_hand != null ? Number(inv.qty_on_hand) : null;
    const sales = salesByItem.get(c.thrive_item_id);
    const velocityPerDay = (sales?.units ?? 0) / 30;
    const salesDays = sales?.days ?? 0;
    const daysOfSupply = velocityPerDay > 0 && qty != null ? qty / velocityPerDay : null;

    // Vendor + schedule resolution
    let vendor: VendorMapRow | null = null;
    if (c.primary_vendor_id) vendor = vendorById.get(c.primary_vendor_id) ?? null;
    let scheduleSource: 'db' | 'fallback' | 'none' = vendor ? 'db' : 'none';
    let orderDays: string[] = vendor?.order_days ?? [];
    if (!vendor && c.primary_vendor_id) {
      // Match Albert's specifically — most produce flows through them
      orderDays = FALLBACK_SCHEDULE['alberts'];
      scheduleSource = 'fallback';
    }
    const truck = nextOrderDate(orderDays, today);

    // Suggested order quantity
    const unitsPerCase = c.units_per_case != null ? Number(c.units_per_case) : null;
    const daysUntilTruck = truck?.daysOut ?? null;
    let suggestedUnits = 0;
    if (truck && qty != null && velocityPerDay > 0) {
      const horizon = truck.daysOut + BUFFER_DAYS;
      suggestedUnits = Math.max(0, horizon * velocityPerDay - qty);
    }
    const suggestedCases = unitsPerCase && unitsPerCase > 0 ? Math.ceil(suggestedUnits / unitsPerCase) : 0;

    const inventoryAgeHrs = inv ? (Date.now() - Date.parse(inv.snapshot_ts)) / 3_600_000 : null;
    const conf = computeConfidence({
      inventoryAgeHrs,
      hasInventory: qty != null,
      salesDays,
      hasVendor: scheduleSource !== 'none',
    });

    const rationale: string[] = [];
    if (daysOfSupply != null) rationale.push(`${daysOfSupply.toFixed(1)}d supply at ${velocityPerDay.toFixed(2)} units/day`);
    else if (qty != null) rationale.push(`${qty.toFixed(1)} on hand, no recent sales`);
    if (truck) rationale.push(`truck ${truck.daysOut === 0 ? 'today' : `in ${truck.daysOut}d (${truck.date})`}`);

    const flags: string[] = [];
    if (qty == null) flags.push('no_inventory');
    if (qty != null && qty < 0) flags.push('negative_on_hand');
    if (salesDays < 7) flags.push('low_velocity_signal');
    if (scheduleSource === 'none') flags.push('no_vendor_mapping');
    if (scheduleSource === 'fallback') flags.push('vendor_mapping_fallback');

    out.push({
      thrive_item_id: c.thrive_item_id,
      thrive_variant_id: c.thrive_variant_id,
      sku: c.sku,
      name: c.name,
      department: c.department,
      current_on_hand: qty,
      velocity_per_day: Math.round(velocityPerDay * 1000) / 1000,
      velocity_per_week: Math.round(velocityPerDay * 7 * 100) / 100,
      days_of_supply: daysOfSupply != null ? Math.round(daysOfSupply * 10) / 10 : null,
      vendor_id: c.primary_vendor_id,
      vendor_name: vendor?.display_name ?? null,
      next_truck_date: truck?.date ?? null,
      days_until_truck: daysUntilTruck,
      units_per_case: unitsPerCase,
      suggested_units: Math.round(suggestedUnits * 10) / 10,
      suggested_cases: suggestedCases,
      suggested_price_dollars: c.price_cents != null ? c.price_cents / 100 : null,
      confidence: conf,
      rationale,
      flags,
    });
  }

  // Sort: red (DoS < 1) > amber (1 ≤ DoS < 3) > green (else), within band by urgency
  out.sort((a, b) => {
    const aBand = a.days_of_supply == null ? 99 : a.days_of_supply < 1 ? 0 : a.days_of_supply < 3 ? 1 : 2;
    const bBand = b.days_of_supply == null ? 99 : b.days_of_supply < 1 ? 0 : b.days_of_supply < 3 ? 1 : 2;
    if (aBand !== bBand) return aBand - bBand;
    const aDos = a.days_of_supply ?? 999;
    const bDos = b.days_of_supply ?? 999;
    return aDos - bDos;
  });

  return { evaluated_at: evaluatedAt, inventory_snapshot_ts: latestSnapshotTs, rows: out };
}

// Read helpers for the produce_vendors table (Feature 2 — vendor schedule).
//
// Source: public.produce_vendors. Optional join to public.thrive_vendors
// (for phone/email fallback) and to alberts_orders / thrive_po_status
// (for "last order" + "next order draft" links).

import { createAdminClient } from './supabase/admin';

export interface ProduceVendor {
  id: string;
  display_name: string;
  active: boolean;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  gmail_label: string | null;
  order_days: string[];           // ['monday','thursday'] etc
  order_cutoff_time_et: string | null;
  delivery_days: string[];
  delivery_offset_days: number;
  categories: string[];
  seasonal_months: number[];      // 1..12
  notes: string | null;
  manual_only: boolean;
  thrive_vendor_id: string | null;
  /** Computed */
  next_order_date: string | null;
  /** Computed: currently in season (current ET month ∈ seasonal_months, or empty array = always in season) */
  in_season: boolean;
}

const WEEKDAYS = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'] as const;
const TZ = 'America/New_York';

/** YYYY-MM-DD in NY today */
function todayNY(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: TZ });
}

/** Current month in NY (1..12) */
function monthNY(): number {
  return new Date().getMonth() + 1; // close-enough; tz boundary at midnight UTC is rare
}

/** YYYY-MM-DD weekday name */
function weekdayOf(dateStr: string): string {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', timeZone: TZ }).toLowerCase();
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString('en-CA');
}

/** Given a vendor's order_days, find the next calendar date (≥ today) that
 *  appears in order_days. Returns null if the vendor has no recurring
 *  schedule (manual-only or empty). */
export function computeNextOrderDate(orderDays: string[], todayISO?: string): string | null {
  if (!orderDays || orderDays.length === 0) return null;
  const start = todayISO ?? todayNY();
  const set = new Set(orderDays.map((d) => d.toLowerCase()));
  for (let i = 0; i < 14; i++) {
    const d = addDays(start, i);
    if (set.has(weekdayOf(d))) return d;
  }
  return null;
}

export function isInSeason(seasonalMonths: number[]): boolean {
  if (!seasonalMonths || seasonalMonths.length === 0) return true;
  return seasonalMonths.includes(monthNY());
}

/** Read all produce vendors, optionally filtered to active=true. */
export async function listProduceVendors(opts: { activeOnly?: boolean } = {}): Promise<ProduceVendor[]> {
  const admin = createAdminClient();
  if (!admin) return [];

  let query = admin
    .from('produce_vendors')
    .select(`
      id, display_name, active,
      contact_name, contact_phone, contact_email, gmail_label,
      order_days, order_cutoff_time_et, delivery_days, delivery_offset_days,
      categories, seasonal_months,
      notes, manual_only, thrive_vendor_id
    `)
    .order('display_name', { ascending: true });

  if (opts.activeOnly) query = query.eq('active', true);

  const { data, error } = await query;
  if (error) throw new Error(`produce_vendors read: ${error.message}`);

  return (data ?? []).map((row): ProduceVendor => ({
    id: String(row.id),
    display_name: row.display_name,
    active: row.active,
    contact_name: row.contact_name,
    contact_phone: row.contact_phone,
    contact_email: row.contact_email,
    gmail_label: row.gmail_label,
    order_days: row.order_days ?? [],
    order_cutoff_time_et: row.order_cutoff_time_et,
    delivery_days: row.delivery_days ?? [],
    delivery_offset_days: row.delivery_offset_days ?? 1,
    categories: row.categories ?? [],
    seasonal_months: row.seasonal_months ?? [],
    notes: row.notes,
    manual_only: row.manual_only,
    thrive_vendor_id: row.thrive_vendor_id,
    next_order_date: computeNextOrderDate(row.order_days ?? []),
    in_season: isInSeason(row.seasonal_months ?? []),
  }));
}

/** Group vendors into UI buckets by urgency. */
export interface VendorBuckets {
  today:   ProduceVendor[];     // order day = today
  soon:    ProduceVendor[];     // order day within next 3 days
  later:   ProduceVendor[];     // order day in 4-14 days
  manual:  ProduceVendor[];     // no schedule / manual_only
  inactive: ProduceVendor[];
}

export function bucketVendors(vendors: ProduceVendor[]): VendorBuckets {
  const today = todayNY();
  const buckets: VendorBuckets = { today: [], soon: [], later: [], manual: [], inactive: [] };
  for (const v of vendors) {
    if (!v.active) { buckets.inactive.push(v); continue; }
    if (v.manual_only || !v.next_order_date) { buckets.manual.push(v); continue; }
    const diff = Math.round(
      (new Date(v.next_order_date + 'T12:00:00').getTime() - new Date(today + 'T12:00:00').getTime()) / 86400000
    );
    if (diff <= 0) buckets.today.push(v);
    else if (diff <= 3) buckets.soon.push(v);
    else buckets.later.push(v);
  }
  return buckets;
}

export { WEEKDAYS };

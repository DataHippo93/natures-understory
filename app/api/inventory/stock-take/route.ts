// GET /api/inventory/stock-take?category=Produce&limit=50&vendor=alberts&active_days=60
// Returns a drift-prioritized count list.
import { NextResponse } from 'next/server';
import { generateStockTake } from '@/lib/stock-take';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

/**
 * Resolve a vendor slug ("alberts") to one or more thrive_vendor_id values.
 * "alberts" maps to Albert's + UNFI Chesterfield (UNFI is the distributor
 * that delivers Albert's-branded produce). Other slugs map to whatever
 * `produce_vendors.display_name` matches case-insensitively.
 */
async function resolveVendorIds(slug: string | null): Promise<string[] | undefined> {
  if (!slug) return undefined;
  if (slug === 'alberts') return ['2257570029409417467', '2233107668598536406'];

  const admin = createAdminClient();
  if (!admin) return undefined;
  const { data } = await admin
    .from('produce_vendors')
    .select('thrive_vendor_id, display_name')
    .ilike('display_name', `%${slug}%`);
  const ids = (data ?? [])
    .map((r: { thrive_vendor_id?: string | null }) => r.thrive_vendor_id)
    .filter((v): v is string => Boolean(v));
  return ids.length > 0 ? ids : undefined;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const category = url.searchParams.get('category') ?? 'Produce';
  const limit = Math.min(500, Math.max(10, parseInt(url.searchParams.get('limit') ?? '50', 10) || 50));
  const vendorSlug = url.searchParams.get('vendor');
  const activeDays = parseInt(url.searchParams.get('active_days') ?? '0', 10);
  try {
    const vendorIds = await resolveVendorIds(vendorSlug);
    const result = await generateStockTake({
      category,
      limit,
      vendorIds,
      activeWindowDays: activeDays > 0 ? activeDays : undefined,
    });
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

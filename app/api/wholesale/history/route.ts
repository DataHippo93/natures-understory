import { NextRequest, NextResponse } from 'next/server';
import { hasRole } from '@/lib/rbac';

// v7.7.12: read the wholesale price/toggle audit trail.
// GET /api/wholesale/history?variantId=gid://... — last N rows for that variant.
// Optional filters: tier=T1|T2|RETAIL|WHOLESALE_ACTIVE, limit=N (default 20, max 500),
// since=<ISO timestamp>, productId=<gid> for cross-variant product history.
// Backed by Supabase `wholesale_price_history`, written by the save handlers +
// the one-off backfill route (see ../backfill/route.ts).

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req: NextRequest) {
  const session = await hasRole(['wholesale_manager', 'admin']);
  if (!session) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });

  const p = req.nextUrl.searchParams;
  const variantId = p.get('variantId');
  const productId = p.get('productId');
  const tier = p.get('tier');
  const since = p.get('since');
  const limitRaw = Number(p.get('limit') ?? '20');
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(1, Math.floor(limitRaw)), 500) : 20;

  if (!variantId && !productId) {
    return NextResponse.json({ error: 'variantId or productId required' }, { status: 400 });
  }

  const url = (process.env.UNDERSTORY_SUPABASE_URL ?? '').replace(/\/+$/, '');
  const key = process.env.UNDERSTORY_SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!url || !key) {
    return NextResponse.json({ rows: [], error: 'Supabase env not configured' }, { status: 200 });
  }

  const params = new URLSearchParams();
  params.set(
    'select',
    'id,changed_at,variant_id,product_id,product_title,variant_title,tier,price_cents,previous_price_cents,change_type,changed_by_email,source',
  );
  if (variantId) params.set('variant_id', `eq.${variantId}`);
  if (productId) params.set('product_id', `eq.${productId}`);
  if (tier) params.set('tier', `eq.${tier.toUpperCase()}`);
  if (since) params.set('changed_at', `gte.${since}`);
  params.set('order', 'changed_at.desc');
  params.set('limit', String(limit));

  try {
    const res = await fetch(`${url}/rest/v1/wholesale_price_history?${params.toString()}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      cache: 'no-store',
    });
    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json(
        { rows: [], error: `Supabase HTTP ${res.status}: ${text}` },
        { status: 200 },
      );
    }
    const rows = await res.json();
    return NextResponse.json({ rows });
  } catch (e) {
    return NextResponse.json(
      { rows: [], error: e instanceof Error ? e.message : 'History fetch failed' },
      { status: 200 },
    );
  }
}

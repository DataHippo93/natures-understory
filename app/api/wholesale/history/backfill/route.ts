import { NextRequest, NextResponse } from 'next/server';
import { hasRole } from '@/lib/rbac';
import { loadGrid } from '@/lib/wholesale';

// v7.7.12: one-time baseline seed for wholesale_price_history. For every
// variant currently priced in T1 or T2, and every variant with
// wholesale_active=true, insert a baseline row so future edits have
// context. Idempotent — skips when the table already has any
// source='backfill' rows unless ?force=1 is passed.
//
// Auth: admin/wholesale_manager session OR
//       Authorization: Bearer <UNDERSTORY_SUPABASE_SERVICE_ROLE_KEY>.
//       (The bearer branch is what the ops script uses to trigger this
//       route from a shell — no browser session needed.)

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const BATCH_SIZE = 250;

async function isAuthorized(req: NextRequest): Promise<boolean> {
  const auth = req.headers.get('authorization') ?? '';
  const key = process.env.UNDERSTORY_SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (key && auth === `Bearer ${key}`) return true;
  const session = await hasRole(['admin', 'wholesale_manager']);
  return !!session;
}

function toCents(x: string | null | undefined): number | null {
  if (x === null || x === undefined || x === '') return null;
  const n = Number(x);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  const url = (process.env.UNDERSTORY_SUPABASE_URL ?? '').replace(/\/+$/, '');
  const key = process.env.UNDERSTORY_SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!url || !key) {
    return NextResponse.json({ error: 'Supabase env not configured' }, { status: 500 });
  }

  const force = req.nextUrl.searchParams.get('force') === '1';
  if (!force) {
    const check = await fetch(
      `${url}/rest/v1/wholesale_price_history?source=eq.backfill&select=id&limit=1`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` }, cache: 'no-store' },
    );
    if (check.ok) {
      const existing = await check.json();
      if (Array.isArray(existing) && existing.length > 0) {
        return NextResponse.json({ ok: true, skipped: 'already_backfilled', inserted: 0 });
      }
    }
  }

  const grid = await loadGrid();
  const inserts: Array<Record<string, unknown>> = [];
  for (const r of grid) {
    const base = {
      variant_id: r.variantId,
      product_id: r.productId,
      product_title: r.productTitle,
      variant_title: r.variantTitle,
      previous_price_cents: null,
      changed_by_user_id: null,
      changed_by_email: 'backfill@system',
      source: 'backfill',
    };
    if (r.tier1) {
      inserts.push({ ...base, tier: 'T1', price_cents: toCents(r.tier1), change_type: 'set' });
    }
    if (r.tier2) {
      inserts.push({ ...base, tier: 'T2', price_cents: toCents(r.tier2), change_type: 'set' });
    }
    if (r.wholesaleActive) {
      inserts.push({
        ...base,
        tier: 'WHOLESALE_ACTIVE',
        price_cents: null,
        change_type: 'toggled_on',
      });
    }
  }

  let inserted = 0;
  for (let i = 0; i < inserts.length; i += BATCH_SIZE) {
    const chunk = inserts.slice(i, i + BATCH_SIZE);
    const res = await fetch(`${url}/rest/v1/wholesale_price_history`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(chunk),
      cache: 'no-store',
    });
    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json(
        { error: `Insert failed at batch ${i}: HTTP ${res.status} ${text}`, inserted },
        { status: 502 },
      );
    }
    inserted += chunk.length;
  }

  return NextResponse.json({
    ok: true,
    inserted,
    batches: Math.ceil(inserts.length / BATCH_SIZE),
    gridRows: grid.length,
  });
}

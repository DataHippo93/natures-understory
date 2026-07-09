// v7.7.8 (2026-07-09): produce ordering surface locked to `admin` role.
// Daniel (wholesale_manager) is scoped to /lopro/wholesale-pricing only.

// POST /api/produce-orders/[id]/rematch
//
// Re-runs the deterministic matcher (lib/produce/matcher.ts) over each
// existing line's raw_line, applying Clark's standing rules
// (shiitake-lock, chicken-thighs-small-pack, romaine-whole-heads,
// cilantro-local, herbs-smallest-case, ginger-smallest-case,
// organic-default) and recomputing qty from OH + 30d velocity.
//
// The heuristic parser (parse-raw-line.ts) runs first at create time;
// this endpoint is an additive "rule-enforcement" pass Clark can invoke
// once a draft exists.
//
// Auth: same roles as /api/produce-orders/*.

import { NextResponse } from 'next/server';
import { hasRole } from '@/lib/rbac';
import { createAdminClient } from '@/lib/supabase/admin';
import { buildMatchContext, matchLine } from '@/lib/produce/matcher';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ALLOWED_ROLES = ['admin'] as const;

function vendorDisplayToSlug(name: string): string {
  const norm = (name || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (norm.startsWith('albert')) return 'alberts';
  if (norm.startsWith('kent')) return 'kents';
  if (norm.startsWith('birdsfoot')) return 'birdsfoot';
  if (norm.startsWith('rvfm')) return 'rvfm';
  return norm || 'unknown';
}

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await hasRole([...ALLOWED_ROLES]);
  if (!session) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const { id } = await ctx.params;
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: 'supabase unavailable' }, { status: 500 });

  const { data: order, error: orderErr } = await admin
    .from('produce_orders')
    .select('id, vendor_id, status, produce_vendors!inner(display_name)')
    .eq('id', id)
    .single();
  if (orderErr || !order) return NextResponse.json({ error: 'order not found' }, { status: 404 });

  const vendorName = (order as { produce_vendors?: { display_name?: string } }).produce_vendors?.display_name ?? '';
  const vendorSlug = vendorDisplayToSlug(vendorName);

  const { data: lines, error: linesErr } = await admin
    .from('produce_order_lines')
    .select('id, raw_line, line_no')
    .eq('order_id', id)
    .order('line_no', { ascending: true });
  if (linesErr) return NextResponse.json({ error: linesErr.message }, { status: 500 });

  const mctx = await buildMatchContext({
    supabase: admin as unknown as Parameters<typeof buildMatchContext>[0]['supabase'],
    vendorSlug,
    vendorId: (order as { vendor_id: string }).vendor_id ?? null,
  });

  const results: Array<{ line_id: string; raw: string; matched_sku: string | null; product_name: string; decision: string; reason: string; rule_deviation: string | null }> = [];
  let updated = 0;

  for (const l of (lines ?? []) as Array<{ id: string; raw_line: string | null; line_no: number | null }>) {
    const raw = (l.raw_line ?? '').trim();
    if (!raw) continue;
    const r = await matchLine(raw, mctx);
    const updates = {
      matched_sku: r.matched_sku,
      matched_thrive_item_id: r.matched_thrive_item_id,
      product_name: r.product_name,
      variant: r.variant,
      commodity: r.commodity,
      qty: r.qty,
      pack: r.pack,
      units_per_case: r.units_per_case,
      unit_cost_cents: r.unit_cost_cents,
      line_cents: r.line_cents,
      current_oh: r.current_oh,
      velocity_30d: r.velocity_30d,
      days_of_supply: r.days_of_supply,
      reason: r.reason,
      rule_deviation: r.rule_deviation,
      is_organic: r.is_organic,
      decision: r.decision,
      features: r.features,
    };
    const { error: updErr } = await admin.from('produce_order_lines').update(updates).eq('id', l.id);
    if (!updErr) updated++;
    results.push({
      line_id: l.id,
      raw: raw,
      matched_sku: r.matched_sku,
      product_name: r.product_name,
      decision: r.decision,
      reason: r.reason,
      rule_deviation: r.rule_deviation,
    });
  }

  // recompute subtotal
  const { data: freshLines } = await admin.from('produce_order_lines').select('line_cents, decision').eq('order_id', id);
  const subtotal = ((freshLines ?? []) as Array<{ line_cents: number | null; decision: string | null }>)
    .filter((l) => l.decision === 'ORDER' && l.line_cents != null)
    .reduce((s, l) => s + Number(l.line_cents), 0);
  await admin.from('produce_orders').update({ subtotal_cents: subtotal, updated_at: new Date().toISOString() }).eq('id', id);

  return NextResponse.json({
    ok: true,
    order_id: id,
    vendor_name: vendorName,
    vendor_slug: vendorSlug,
    target_dos: mctx.targetDos,
    buffer_multiplier: mctx.bufferMultiplier,
    catalog_size: mctx.catalog.length,
    lines_total: (lines ?? []).length,
    updated,
    subtotal_cents: subtotal,
    results,
  });
}

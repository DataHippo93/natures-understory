// Line items for a produce order.
//
// POST   /api/produce-orders/[id]/lines           — replace all lines (bulk)
// PATCH  /api/produce-orders/[id]/lines           — update one line by { id, ...fields }
// DELETE /api/produce-orders/[id]/lines?line=<id> — remove a line

import { NextResponse } from 'next/server';
import { hasRole } from '@/lib/rbac';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

const ROLES = ['buying_manager', 'wholesale_manager', 'admin'] as const;

interface LineInput {
  raw_line: string;
  product_name?: string;
  variant?: string | null;
  commodity?: string | null;
  matched_sku?: string | null;
  qty?: number;
  pack?: string | null;
  units_per_case?: number | null;
  unit_cost_cents?: number | null;
  current_oh?: number | null;
  velocity_30d?: number | null;
  days_of_supply?: number | null;
  reason?: string | null;
  audience_note_supplier?: string[];
  audience_note_internal?: string[];
  audience_note_both?: string[];
  bid?: boolean;
  bid_ask_cents?: number | null;
  is_organic?: boolean | null;
  is_preorder?: boolean;
  recent_burn?: boolean;
  decision?: 'ORDER' | 'SKIP' | 'BID';
  rule_deviation?: string | null;
}

function computeLineCents(qty: number | null | undefined, unitCostCents: number | null | undefined, unitsPerCase: number | null | undefined): number | null {
  if (qty == null || unitCostCents == null) return null;
  // If we know units_per_case, line = qty (cases) * units_per_case * unit_cost. Else qty * unit_cost.
  const units = unitsPerCase && unitsPerCase > 0 ? Number(qty) * Number(unitsPerCase) : Number(qty);
  return Math.round(units * Number(unitCostCents));
}

async function refreshSubtotal(admin: ReturnType<typeof createAdminClient>, orderId: string) {
  if (!admin) return;
  const { data: lines } = await admin
    .from('produce_order_lines')
    .select('line_cents, decision')
    .eq('order_id', orderId);
  const subtotal = (lines ?? [])
    .filter((l: any) => l.decision === 'ORDER' && l.line_cents != null)
    .reduce((s: number, l: any) => s + Number(l.line_cents), 0);
  const { data: order } = await admin
    .from('produce_orders')
    .select('min_cents')
    .eq('id', orderId)
    .single();
  const minCents = order?.min_cents ?? null;
  await admin
    .from('produce_orders')
    .update({
      subtotal_cents: subtotal,
      min_hit: minCents == null ? null : subtotal >= minCents,
      updated_at: new Date().toISOString(),
    })
    .eq('id', orderId);
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await hasRole([...ROLES]);
  if (!session) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const { id } = await ctx.params;
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: 'supabase unavailable' }, { status: 500 });

  let body: { lines: LineInput[] };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }
  if (!Array.isArray(body.lines)) return NextResponse.json({ error: 'lines[] required' }, { status: 400 });

  // Wipe existing lines first (bulk replace semantics).
  await admin.from('produce_order_lines').delete().eq('order_id', id);

  const rows = body.lines.map((l, idx) => ({
    order_id: id,
    line_no: idx,
    raw_line: l.raw_line,
    product_name: l.product_name ?? l.raw_line,
    variant: l.variant ?? null,
    commodity: l.commodity ?? null,
    matched_sku: l.matched_sku ?? null,
    qty: l.qty ?? 0,
    pack: l.pack ?? null,
    units_per_case: l.units_per_case ?? null,
    unit_cost_cents: l.unit_cost_cents ?? null,
    line_cents: computeLineCents(l.qty, l.unit_cost_cents, l.units_per_case),
    current_oh: l.current_oh ?? null,
    velocity_30d: l.velocity_30d ?? null,
    days_of_supply: l.days_of_supply ?? null,
    reason: l.reason ?? null,
    audience_note_supplier: l.audience_note_supplier ?? [],
    audience_note_internal: l.audience_note_internal ?? [],
    audience_note_both: l.audience_note_both ?? [],
    bid: !!l.bid,
    bid_ask_cents: l.bid_ask_cents ?? null,
    is_organic: l.is_organic ?? null,
    is_preorder: !!l.is_preorder,
    recent_burn: !!l.recent_burn,
    decision: l.decision ?? 'ORDER',
    rule_deviation: l.rule_deviation ?? null,
  }));

  if (rows.length > 0) {
    const { error } = await admin.from('produce_order_lines').insert(rows);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  await refreshSubtotal(admin, id);
  return NextResponse.json({ ok: true, count: rows.length });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await hasRole([...ROLES]);
  if (!session) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const { id } = await ctx.params;
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: 'supabase unavailable' }, { status: 500 });

  let body: { line_id: string } & Partial<LineInput>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }
  if (!body.line_id) return NextResponse.json({ error: 'line_id required' }, { status: 400 });

  const allowed = ['product_name','variant','commodity','matched_sku','qty','pack','units_per_case','unit_cost_cents','current_oh','velocity_30d','days_of_supply','reason','audience_note_supplier','audience_note_internal','audience_note_both','bid','bid_ask_cents','is_organic','is_preorder','recent_burn','decision','rule_deviation'];
  const patch: Record<string, unknown> = {};
  for (const k of allowed) if (k in body) patch[k] = (body as any)[k];

  // Recompute line_cents if qty/unit_cost/units_per_case changed.
  if ('qty' in body || 'unit_cost_cents' in body || 'units_per_case' in body) {
    const { data: existing } = await admin
      .from('produce_order_lines')
      .select('qty, unit_cost_cents, units_per_case')
      .eq('id', body.line_id)
      .single();
    const qty = 'qty' in body ? body.qty : existing?.qty;
    const uc = 'unit_cost_cents' in body ? body.unit_cost_cents : existing?.unit_cost_cents;
    const upc = 'units_per_case' in body ? body.units_per_case : existing?.units_per_case;
    patch.line_cents = computeLineCents(qty, uc, upc);
  }

  const { error } = await admin.from('produce_order_lines').update(patch).eq('id', body.line_id).eq('order_id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await refreshSubtotal(admin, id);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await hasRole([...ROLES]);
  if (!session) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const lineId = url.searchParams.get('line');
  if (!lineId) return NextResponse.json({ error: 'line query param required' }, { status: 400 });

  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: 'supabase unavailable' }, { status: 500 });

  const { error } = await admin.from('produce_order_lines').delete().eq('id', lineId).eq('order_id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await refreshSubtotal(admin, id);
  return NextResponse.json({ ok: true });
}

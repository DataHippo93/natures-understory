import { NextResponse } from 'next/server';
import { hasRole } from '@/lib/rbac';
import { createAdminClient } from '@/lib/supabase/admin';
import { composeSupplierEmail } from '@/lib/produce/compose-email';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await hasRole(['buying_manager', 'wholesale_manager', 'admin']);
  if (!session) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const { id } = await ctx.params;
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: 'supabase unavailable' }, { status: 500 });

  const { data: order, error } = await admin
    .from('produce_orders')
    .select(`
      target_delivery_date, rvfm_piggyback, min_cents, subtotal_cents,
      produce_vendors!inner(display_name, contact_name)
    `)
    .eq('id', id)
    .single();
  if (error || !order) return NextResponse.json({ error: error?.message ?? 'not found' }, { status: 404 });

  const { data: lines, error: linesErr } = await admin
    .from('produce_order_lines')
    .select('product_name, variant, qty, pack, units_per_case, unit_cost_cents, line_cents, bid, bid_ask_cents, decision, audience_note_supplier, audience_note_internal, audience_note_both, is_preorder, matched_sku')
    .eq('order_id', id)
    .order('line_no', { ascending: true });
  if (linesErr) return NextResponse.json({ error: linesErr.message }, { status: 500 });

  const composed = composeSupplierEmail(
    { target_delivery_date: order.target_delivery_date, rvfm_piggyback: order.rvfm_piggyback, min_cents: order.min_cents, subtotal_cents: order.subtotal_cents },
    (order as any).produce_vendors,
    (lines ?? []) as any,
  );
  return NextResponse.json(composed);
}

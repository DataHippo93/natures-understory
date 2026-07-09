import { NextResponse } from 'next/server';
import { hasRole } from '@/lib/rbac';
import { createAdminClient } from '@/lib/supabase/admin';
import { composeSupplierEmail } from '@/lib/produce/compose-email';

export const dynamic = 'force-dynamic';

const CLARK_INBOX = 'cmaine@ycconsulting.biz';
const FROM_ADDR = 'no-reply@natures-storehouse.com';

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await hasRole(['wholesale_manager', 'admin']);
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

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'RESEND_API_KEY not configured' }, { status: 500 });

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM_ADDR,
      to: [CLARK_INBOX],
      subject: `[DRAFT] ${composed.subject}`,
      text: composed.textBody,
      html: composed.htmlBody,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return NextResponse.json({ error: data.message ?? `Resend HTTP ${res.status}` }, { status: 502 });

  await admin
    .from('produce_orders')
    .update({
      supplier_email_resend_id: data.id ?? null,
      supplier_email_subject: composed.subject,
      supplier_email_body: composed.textBody,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);

  return NextResponse.json({ ok: true, resend_id: data.id ?? null });
}

// Single produce order — GET (with lines) + PATCH (update fields).

import { NextResponse } from 'next/server';
import { hasRole } from '@/lib/rbac';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

const ALLOWED_ROLES = ['wholesale_manager', 'admin'] as const;

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await hasRole([...ALLOWED_ROLES]);
  if (!session) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const { id } = await ctx.params;
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: 'supabase unavailable' }, { status: 500 });

  const { data: order, error } = await admin
    .from('produce_orders')
    .select(`
      id, vendor_id, status, target_delivery_date, target_dos,
      input_photo_path, input_raw_text, input_ocr_json,
      subtotal_cents, min_cents, min_hit, rvfm_piggyback,
      supplier_email_resend_id, supplier_email_subject, supplier_email_body,
      thrive_po_id,
      created_at, updated_at, sent_at,
      produce_vendors!inner(display_name, contact_name, contact_email, order_days, delivery_days, target_buffer_multiplier, target_dos_overrides, categories)
    `)
    .eq('id', id)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 404 });

  const { data: lines, error: linesErr } = await admin
    .from('produce_order_lines')
    .select('*')
    .eq('order_id', id)
    .order('line_no', { ascending: true });

  if (linesErr) return NextResponse.json({ error: linesErr.message }, { status: 500 });

  return NextResponse.json({ order, lines: lines ?? [] });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await hasRole([...ALLOWED_ROLES]);
  if (!session) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const { id } = await ctx.params;
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: 'supabase unavailable' }, { status: 500 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const allowed = ['status', 'target_delivery_date', 'target_dos', 'input_raw_text', 'rvfm_piggyback', 'subtotal_cents', 'min_cents', 'min_hit', 'supplier_email_subject', 'supplier_email_body'];
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const k of allowed) {
    if (k in body) patch[k] = body[k];
  }

  const { error } = await admin.from('produce_orders').update(patch).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

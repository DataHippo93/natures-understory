// Produce Orders API — list + create.
//
// GET  /api/produce-orders           → list recent orders grouped by vendor
// POST /api/produce-orders           → create a draft order
//
// Auth: buying_manager or admin (produce ordering role; falls back to
// wholesale_manager for now — same folks in practice).

import { NextResponse } from 'next/server';
import { hasRole } from '@/lib/rbac';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

const ALLOWED_ROLES = ['wholesale_manager', 'admin'] as const;

export async function GET() {
  const session = await hasRole([...ALLOWED_ROLES]);
  if (!session) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: 'supabase unavailable' }, { status: 500 });

  // Recent orders + vendor display name in one round trip.
  const { data, error } = await admin
    .from('produce_orders')
    .select(`
      id, vendor_id, status, target_delivery_date, target_dos,
      subtotal_cents, min_cents, min_hit, rvfm_piggyback,
      supplier_email_resend_id, thrive_po_id,
      created_at, updated_at, sent_at,
      produce_vendors!inner(display_name)
    `)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const orders = (data ?? []).map((r: any) => ({
    id: String(r.id),
    vendor_id: String(r.vendor_id),
    vendor_name: r.produce_vendors?.display_name ?? 'Unknown',
    status: r.status,
    target_delivery_date: r.target_delivery_date,
    target_dos: r.target_dos == null ? null : Number(r.target_dos),
    subtotal_cents: r.subtotal_cents ?? 0,
    min_cents: r.min_cents,
    min_hit: r.min_hit,
    rvfm_piggyback: r.rvfm_piggyback,
    supplier_email_sent: !!r.supplier_email_resend_id,
    thrive_po_id: r.thrive_po_id,
    created_at: r.created_at,
    updated_at: r.updated_at,
    sent_at: r.sent_at,
  }));

  return NextResponse.json({ orders });
}

interface CreateBody {
  vendor_id?: string;
  target_delivery_date?: string;
  target_dos?: number | null;
  input_raw_text?: string | null;
  rvfm_piggyback?: boolean;
}

export async function POST(req: Request) {
  const session = await hasRole([...ALLOWED_ROLES]);
  if (!session) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: 'supabase unavailable' }, { status: 500 });

  let body: CreateBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  if (!body.vendor_id) return NextResponse.json({ error: 'vendor_id required' }, { status: 400 });
  if (!body.target_delivery_date) return NextResponse.json({ error: 'target_delivery_date required' }, { status: 400 });

  const insert = {
    vendor_id: body.vendor_id,
    target_delivery_date: body.target_delivery_date,
    target_dos: body.target_dos ?? null,
    input_raw_text: body.input_raw_text ?? null,
    rvfm_piggyback: !!body.rvfm_piggyback,
    status: 'draft',
    subtotal_cents: 0,
    min_cents: 100000, // $1000 default; overridden per vendor later
    min_hit: false,
    created_by: session.userId,
  };

  const { data, error } = await admin
    .from('produce_orders')
    .insert(insert)
    .select('id')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ id: data.id }, { status: 201 });
}

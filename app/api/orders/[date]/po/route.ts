// POST /api/orders/[date]/po — create a draft Thrive PO from a saved order.
//
// GATED: refuses to run until Task #2 (Thrive PO POST capture) lands and
// the operator sets THRIVE_PO_PATH_VERIFIED=1 + the working POST body
// shape in this file.
//
// Until then, returns 503 with the spec link.

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const maxDuration = 60;

const THRIVE_BASE = 'https://cloud.thrivemetrics.com';
// ⚠️ UNVERIFIED — capture from working UI Save Draft, then update
const PO_CREATE_PATH = '/api/v3/purchase-order/purchase-orders/';
const PO_LINE_PATH = (poId: string) =>
  `/api/v3/purchase-order/purchase-orders/${poId}/line-items/`;

export async function POST(req: NextRequest, ctx: { params: Promise<{ date: string }> }) {
  const { date } = await ctx.params;

  // Refuse-to-run gate
  if (process.env.THRIVE_PO_PATH_VERIFIED !== '1') {
    return NextResponse.json({
      ok: false,
      gated: true,
      reason: 'Thrive PO POST body unverified. Capture via Chrome devtools fetch hook (see docs/thrive_api_discovery.md "Next-session capture procedure" in natures-produce-buying repo). Then update PO_CREATE_PATH + the createPo() function below and set THRIVE_PO_PATH_VERIFIED=1 in Vercel.',
      target_path: PO_CREATE_PATH,
    }, { status: 503 });
  }

  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: 'Admin not configured' }, { status: 500 });

  // Load order header + lines
  const { data: order } = await admin
    .from('alberts_orders')
    .select('order_date,vendor_id,ship_loc_id,bill_loc_id,po_memo,subtotal_cents,thrive_po_id')
    .eq('order_date', date)
    .maybeSingle();
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  if (order.thrive_po_id) {
    return NextResponse.json({ ok: false, reason: 'PO already exists', thrive_po_id: order.thrive_po_id }, { status: 409 });
  }

  const { data: lines } = await admin
    .from('alberts_order_lines')
    .select('alberts_sku,description,size,qty,case_price,internal_po_text')
    .eq('order_date', date)
    .order('line_no', { ascending: true });
  if (!lines || lines.length === 0) {
    return NextResponse.json({ error: 'No lines on order' }, { status: 400 });
  }

  try {
    const sess = await thriveLogin();
    const poId = await createPo(sess, order, lines.length);
    for (const line of lines) {
      await addPoLine(sess, poId, line);
    }
    await admin.from('alberts_orders').update({ thrive_po_id: poId, status: 'sent' }).eq('order_date', date);
    return NextResponse.json({ ok: true, thrive_po_id: poId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// Thrive client (placeholder — wire post #2 capture)
// ---------------------------------------------------------------------------

interface ThriveSession {
  csrftoken: string;
  cookieHeader: string;
}

async function thriveLogin(): Promise<ThriveSession> {
  const email = process.env.THRIVE_EMAIL;
  const password = process.env.THRIVE_PASSWORD;
  if (!email || !password) throw new Error('THRIVE_EMAIL / THRIVE_PASSWORD not set');
  const r = await fetch(`${THRIVE_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!r.ok) throw new Error(`thrive login: ${r.status}`);
  const setCookie = r.headers.get('set-cookie') ?? '';
  const csrftoken = /csrftoken=([^;]+)/.exec(setCookie)?.[1] ?? '';
  const sessionid = /sessionid=([^;]+)/.exec(setCookie)?.[1] ?? '';
  if (!csrftoken || !sessionid) throw new Error('thrive login missing cookies');
  return { csrftoken, cookieHeader: `csrftoken=${csrftoken}; sessionid=${sessionid}` };
}

async function createPo(
  sess: ThriveSession,
  order: { vendor_id: string; ship_loc_id: string; bill_loc_id: string; po_memo: string | null; order_date: string },
  lineCount: number,
): Promise<string> {
  // ⚠️ SHAPE UNVERIFIED — replace with the captured POST body once #2 lands.
  const body = {
    vendor_id: order.vendor_id,
    shipping_location_id: order.ship_loc_id,
    billing_location_id: order.bill_loc_id,
    status: 'draft',
    type: 'external',
    message_to_vendor: '',
    line_item_count: lineCount,
    placed: order.order_date,
    discount_type: 'amount',
    discount_percent: 0,
    discount_cents: 0,
    purchase_order_memo: order.po_memo ?? '',
  };
  const r = await fetch(`${THRIVE_BASE}${PO_CREATE_PATH}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-CSRFToken': sess.csrftoken,
      Cookie: sess.cookieHeader,
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`PO create ${r.status}: ${text.slice(0, 400)}`);
  }
  const j = (await r.json()) as { id: string };
  return j.id;
}

async function addPoLine(
  sess: ThriveSession,
  poId: string,
  line: { alberts_sku: string; description: string; size: string | null; qty: number; case_price: number | null; internal_po_text: string | null },
): Promise<void> {
  const body = {
    sku: line.alberts_sku,
    description: line.description,
    size: line.size,
    quantity: line.qty,
    cost_per_unit: line.case_price,
    memo: line.internal_po_text ?? '',
  };
  const r = await fetch(`${THRIVE_BASE}${PO_LINE_PATH(poId)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-CSRFToken': sess.csrftoken,
      Cookie: sess.cookieHeader,
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`PO line ${r.status}: ${text.slice(0, 400)}`);
  }
}

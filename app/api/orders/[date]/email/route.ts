// GET /api/orders/[date]/email — return the cached .eml or render on demand.
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

export async function GET(_req: NextRequest, ctx: { params: Promise<{ date: string }> }) {
  const { date } = await ctx.params;
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: 'Admin not configured' }, { status: 500 });

  const { data, error } = await admin
    .from('alberts_orders')
    .select('email_eml,email_subject')
    .eq('order_date', date)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data || !data.email_eml) {
    return NextResponse.json({ error: 'No .eml stored for that order yet' }, { status: 404 });
  }

  // Supabase returns bytea as base64 string in JSON
  const raw = typeof data.email_eml === 'string'
    ? Buffer.from(data.email_eml.replace(/^\\x/, ''), 'hex')
    : Buffer.from(data.email_eml as Uint8Array);

  return new Response(raw, {
    headers: {
      'Content-Type': 'message/rfc822',
      'Content-Disposition': `attachment; filename="order_for_${date.replace(/-/g, '_')}.eml"`,
    },
  });
}

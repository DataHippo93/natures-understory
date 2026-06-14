// POST /api/orders/produce/draft-email
//   body: { notes?: string, orderDate?: string }
// Returns the canonical Albert's email draft (subject + body) so Clark
// can review then copy-paste into Gmail. SMTP send wired separately in
// v1.1 (needs nodemailer added to deps + LOBSTER_GMAIL_APP_PASSWORD on
// Vercel).

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { evaluateNextProduceOrder } from '@/lib/next-order';
import { buildOrderEmail } from '@/lib/order-email';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: 'Auth not configured' }, { status: 500 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: 'Admin client not configured' }, { status: 500 });
  const { data: profile } = await admin
    .from('user_profiles')
    .select('role')
    .eq('id', user.id)
    .single();
  if (!profile || !['admin', 'gm'].includes(profile.role)) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({} as { notes?: string; orderDate?: string }));
  const evaluation = await evaluateNextProduceOrder({ notes: body?.notes });
  const draft = buildOrderEmail(evaluation, { orderDate: body?.orderDate });

  return NextResponse.json({
    ...draft,
    evaluation_summary: evaluation.totals,
    parsed_notes: evaluation.parsed_notes,
  });
}

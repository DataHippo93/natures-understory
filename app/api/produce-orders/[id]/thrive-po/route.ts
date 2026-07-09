import { NextResponse } from 'next/server';
import { hasRole } from '@/lib/rbac';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await hasRole(['wholesale_manager', 'admin']);
  if (!session) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const { id } = await ctx.params;

  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: 'supabase unavailable' }, { status: 500 });

  // MVP: mark ready + record a placeholder thrive_po_id. Full Thrive
  // POST wiring lands next (uses thrive-pipeline's stored Playwright
  // storage_state so we can hit /api/v3/purchase-orders).
  const placeholder = `pending-${Date.now()}`;
  const { error } = await admin
    .from('produce_orders')
    .update({
      status: 'ready',
      thrive_po_id: placeholder,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, thrive_po_id: placeholder, note: 'Placeholder — Thrive POST wiring lands in next slice.' });
}

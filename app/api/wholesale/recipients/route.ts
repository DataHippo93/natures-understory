import { NextRequest, NextResponse } from 'next/server';
import { hasRole } from '@/lib/rbac';
import { loadRecipients, setRecipientTag } from '@/lib/wholesale';

// GET — customers with their wholesale-list tag membership
export async function GET() {
  const session = await hasRole(['wholesale_manager', 'admin']);
  if (!session) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });

  try {
    const recipients = await loadRecipients();
    return NextResponse.json({ recipients });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to load recipients' },
      { status: 502 }
    );
  }
}

// PATCH — toggle a customer's wholesale-list-t1 / -t2 tag
export async function PATCH(req: NextRequest) {
  const session = await hasRole(['wholesale_manager', 'admin']);
  if (!session) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });

  const body = (await req.json()) as { customerId: string; tier: 't1' | 't2'; member: boolean };
  if (!body.customerId || !['t1', 't2'].includes(body.tier) || typeof body.member !== 'boolean') {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  try {
    await setRecipientTag(body.customerId, body.tier, body.member);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Tag update failed' },
      { status: 502 }
    );
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { hasRole } from '@/lib/rbac';
import { updateRetailPrice, upsertTierPrice, clearTierPrice } from '@/lib/wholesale';

const PRICE_RE = /^\d+(\.\d{1,2})?$/;

// PATCH — update one cell: retail price or a tier fixed price (null clears tier)
export async function PATCH(req: NextRequest) {
  const session = await hasRole(['wholesale_manager', 'admin']);
  if (!session) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });

  const body = (await req.json()) as {
    kind: 'retail' | 't1' | 't2';
    productId?: string;
    variantId: string;
    amount: string | null;
  };

  if (!body.variantId || !['retail', 't1', 't2'].includes(body.kind)) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
  if (body.amount !== null && !PRICE_RE.test(body.amount)) {
    return NextResponse.json({ error: 'Invalid price' }, { status: 400 });
  }

  try {
    if (body.kind === 'retail') {
      if (!body.productId || body.amount === null) {
        return NextResponse.json({ error: 'Retail update requires productId and amount' }, { status: 400 });
      }
      await updateRetailPrice(body.productId, body.variantId, body.amount);
    } else if (body.amount === null) {
      await clearTierPrice(body.kind, body.variantId);
    } else {
      await upsertTierPrice(body.kind, body.variantId, body.amount);
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Sync failed' },
      { status: 502 }
    );
  }
}

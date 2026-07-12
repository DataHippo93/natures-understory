import { NextRequest, NextResponse } from 'next/server';
import { hasRole } from '@/lib/rbac';
import { setVariantWholesaleActive } from '@/lib/wholesale';

// POST — flip a single variant's wholesale_active flag (v7.4: variant-level).
// v7.7.12: forwards audit context so the wholesale-history audit trail
// captures who flipped the toggle and what the prior state was.
export async function POST(req: NextRequest) {
  const session = await hasRole(['wholesale_manager', 'admin']);
  if (!session) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });

  const body = (await req.json()) as {
    variantId: string;
    active: boolean;
    previousActive?: boolean;
    productId?: string;
    productTitle?: string;
    variantTitle?: string;
  };
  if (!body.variantId || typeof body.active !== 'boolean') {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const actor = {
    userId: session.userId,
    email: session.email,
    productId: body.productId ?? null,
    productTitle: body.productTitle ?? null,
    variantTitle: body.variantTitle ?? null,
    previousActive: body.previousActive,
  };

  try {
    await setVariantWholesaleActive(body.variantId, body.active, actor);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Toggle failed' },
      { status: 502 }
    );
  }
}

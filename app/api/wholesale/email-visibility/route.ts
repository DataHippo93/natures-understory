import { NextRequest, NextResponse } from 'next/server';
import { hasRole } from '@/lib/rbac';
import { setVariantEmailVisible } from '@/lib/wholesale';

// POST - flip a single variant's email_visible metafield (v7.8).
// Controls ONLY whether the variant appears in the tier pricelist email
// drafts (/api/wholesale/pricelist). Wholesale checkout / catalog
// publication is untouched - that is /api/wholesale/toggle's job.
export async function POST(req: NextRequest) {
  const session = await hasRole(['wholesale_manager', 'admin']);
  if (!session) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });

  const body = (await req.json()) as {
    variantId: string;
    visible: boolean;
    productId?: string;
    productTitle?: string;
    variantTitle?: string;
  };
  if (!body.variantId || typeof body.visible !== 'boolean') {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  try {
    await setVariantEmailVisible(body.variantId, body.visible, {
      userId: session.userId,
      email: session.email,
      productId: body.productId ?? null,
      productTitle: body.productTitle ?? null,
      variantTitle: body.variantTitle ?? null,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Update failed' },
      { status: 502 }
    );
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { hasRole } from '@/lib/rbac';
import { setWholesaleActive } from '@/lib/wholesale';

// POST — toggle a product's wholesale membership (metafield + publications + prices)
export async function POST(req: NextRequest) {
  const session = await hasRole(['wholesale_manager', 'admin']);
  if (!session) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });

  const body = (await req.json()) as {
    productId: string;
    variantIds: string[];
    active: boolean;
  };
  if (!body.productId || !Array.isArray(body.variantIds) || typeof body.active !== 'boolean') {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  try {
    await setWholesaleActive(body.productId, body.variantIds, body.active);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Toggle failed' },
      { status: 502 }
    );
  }
}

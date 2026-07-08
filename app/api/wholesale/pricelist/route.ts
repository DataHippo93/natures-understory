import { NextRequest, NextResponse } from 'next/server';
import { hasRole } from '@/lib/rbac';
import { generatePricelistDraft } from '@/lib/pricelist-email';

// GET ?tier=t1|t2 — generate a tier pricelist draft (subject, HTML body, BCC list)
export async function GET(req: NextRequest) {
  const session = await hasRole(['wholesale_manager', 'admin']);
  if (!session) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });

  const tier = req.nextUrl.searchParams.get('tier');
  if (tier !== 't1' && tier !== 't2') {
    return NextResponse.json({ error: 'tier must be t1 or t2' }, { status: 400 });
  }

  try {
    const draft = await generatePricelistDraft(tier);
    return NextResponse.json(draft);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Pricelist generation failed' },
      { status: 502 }
    );
  }
}

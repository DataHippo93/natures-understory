import { NextResponse } from 'next/server';
import { hasRole } from '@/lib/rbac';
import { loadRecipients } from '@/lib/wholesale';

// GET — B2B Company members grouped by tier catalog (auto-mirrored from Shopify).
// v7.4: read-only. Recipient list is now managed via Shopify Admin
// (Company → Location → assign Catalog + customer subscription state).
export async function GET() {
  const session = await hasRole(['wholesale_manager', 'admin']);
  if (!session) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });

  try {
    const list = await loadRecipients();
    return NextResponse.json(list);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to load recipients' },
      { status: 502 }
    );
  }
}

export async function PATCH() {
  return NextResponse.json(
    {
      error:
        'Recipients are now managed in Shopify Admin (Company → Location → Catalog assignment + customer email subscription). This endpoint is read-only as of v7.4.',
    },
    { status: 410 }
  );
}

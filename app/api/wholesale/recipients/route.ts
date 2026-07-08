import { NextResponse } from 'next/server';
import { hasRole } from '@/lib/rbac';
import { loadRecipients } from '@/lib/wholesale';

// GET — B2B Company members grouped by tier catalog (auto-mirrored from Shopify).
// v7.4: read-only. Recipient list is now managed via Shopify Admin
// (Company → Location → assign Catalog + customer subscription state).
// v7.6 (2026-07-08): on Shopify failure, return 200 with an empty recipient
// list plus an `error` string so the client can render an error state instead
// of hanging on "Loading customers…". Most likely failure modes: the LoPro
// app is missing the `read_companies` admin scope (grant it in Shopify
// Admin → Apps → LoPro → API scopes), or the store has no B2B Companies
// configured yet (empty list is fine — no error).
export async function GET() {
  const session = await hasRole(['wholesale_manager', 'admin']);
  if (!session) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });

  try {
    const list = await loadRecipients();
    return NextResponse.json(list);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed to load recipients';
    // 200 by design — the client uses the `error` field to render an inline
    // notice while still leaving the tab usable (empty recipient columns).
    return NextResponse.json(
      { recipients: [], suppressedCount: 0, error: msg },
      { status: 200 }
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

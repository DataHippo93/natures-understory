import { NextResponse } from 'next/server';
import { hasRole } from '@/lib/rbac';
import { loadRecipients } from '@/lib/wholesale';

// v7.7.9: force-dynamic + revalidate=0 so Vercel never serves a stale
// server render of the recipients JSON (v7.7.8 fallback code was already
// deployed but users were still seeing 0/0 -- the module-level
// `_recipientCache` inside loadRecipients could hold a stale zero result
// across warm invocations, and there was a chance an ISR/CDN layer was
// caching the JSON body).
export const dynamic = 'force-dynamic';
export const revalidate = 0;

// GET -- B2B Company members grouped by tier catalog (auto-mirrored from Shopify).
// v7.4: read-only. Recipient list is now managed via Shopify Admin
// (Company -> Location -> assign Catalog + customer subscription state).
// v7.6 (2026-07-08): on Shopify failure, return 200 with an empty recipient
// list plus an `error` string so the client can render an error state instead
// of hanging on "Loading customers...".
// v7.7.9 (2026-07-09): also return an empty tierBalances shape on error so
// the client's `data.tierBalances?.t1?.length` reads don't crash the tab.
export async function GET() {
  const session = await hasRole(['wholesale_manager', 'admin']);
  if (!session) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });

  try {
    const list = await loadRecipients();
    return NextResponse.json(list);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed to load recipients';
    console.error('[recipients] loadRecipients threw:', msg);
    return NextResponse.json(
      {
        recipients: [],
        suppressedCount: 0,
        tierBalances: { t1: [], t2: [] },
        error: msg,
      },
      { status: 200 }
    );
  }
}

export async function PATCH() {
  return NextResponse.json(
    {
      error:
        'Recipients are now managed in Shopify Admin (Company -> Location -> Catalog assignment + customer email subscription). This endpoint is read-only as of v7.4.',
    },
    { status: 410 }
   );
}

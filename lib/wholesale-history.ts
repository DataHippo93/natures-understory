// v7.7.12: audit trail for wholesale price + wholesale_active toggle changes.
// Companion to `logPublishAction` in `lib/wholesale.ts` — same service-role
// fetch pattern, kept in its own module so `lib/wholesale.ts` doesn't grow
// another 100 lines. Every write from the wholesale-pricing UI (via
// `app/api/wholesale/price` + `/toggle`) and the one-off backfill route
// funnels through here into Supabase `wholesale_price_history`.

export type HistoryTier = 'T1' | 'T2' | 'RETAIL' | 'WHOLESALE_ACTIVE' | 'EMAIL_VISIBLE';
export type HistoryChangeType = 'set' | 'cleared' | 'toggled_on' | 'toggled_off';
export type HistorySource = 'wholesale_ui' | 'backfill' | 'shopify_sync' | 'api';

export interface HistoryActor {
  userId?: string | null;
  email?: string | null;
  productId?: string | null;
  productTitle?: string | null;
  variantTitle?: string | null;
}

function toCents(amount: string | number | null | undefined): number | null {
  if (amount === null || amount === undefined || amount === '') return null;
  const n = typeof amount === 'number' ? amount : Number(amount);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

export async function logPriceHistory(row: {
  variantId: string;
  tier: HistoryTier;
  amount?: string | null;
  previousAmount?: string | null;
  changeType: HistoryChangeType;
  actor?: HistoryActor;
  source?: HistorySource;
}): Promise<void> {
  try {
    const url = (process.env.UNDERSTORY_SUPABASE_URL ?? '').replace(/\/+$/, '');
    const key = process.env.UNDERSTORY_SUPABASE_SERVICE_ROLE_KEY ?? '';
    if (!url || !key) return;
    await fetch(`${url}/rest/v1/wholesale_price_history`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        variant_id: row.variantId,
        product_id: row.actor?.productId ?? null,
        product_title: row.actor?.productTitle ?? null,
        variant_title: row.actor?.variantTitle ?? null,
        tier: row.tier,
        price_cents: toCents(row.amount ?? null),
        previous_price_cents: toCents(row.previousAmount ?? null),
        change_type: row.changeType,
        changed_by_user_id: row.actor?.userId ?? null,
        changed_by_email: row.actor?.email ?? null,
        source: row.source ?? 'wholesale_ui',
      }),
      cache: 'no-store',
    });
  } catch (e) {
    console.warn('[wholesale] logPriceHistory failed:', (e as Error).message);
  }
}

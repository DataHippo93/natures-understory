import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { fetchOrdersWithLineItems, localDateStr, localHour } from '@/lib/clover';

const LOCAL_TZ = 'America/New_York';

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: 'Not configured' }, { status: 500 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: 'Admin not configured' }, { status: 500 });

  const { searchParams } = new URL(req.url);
  const start = searchParams.get('start');
  const end = searchParams.get('end');

  if (!start || !end) {
    return NextResponse.json({ error: 'Missing start or end query params (YYYY-MM-DD)' }, { status: 400 });
  }

  // Parse dates
  const startDate = new Date(start + 'T00:00:00-05:00');
  const endDate = new Date(end + 'T00:00:00-05:00');
  endDate.setDate(endDate.getDate() + 1); // inclusive of end date

  const startMs = startDate.getTime();
  const endMs = endDate.getTime();

  // Log sync start
  const { data: logEntry } = await admin.from('sync_log').insert({
    sync_type: 'sales',
    date_range_start: start,
    date_range_end: end,
  }).select().single();

  const logId = logEntry?.id;

  try {
    // Fetch item→category mapping from DB
    const { data: itemRows } = await admin
      .from('sales_items')
      .select('id, category_id, category_name');

    const itemCategoryMap = new Map<string, { category_id: string | null; category_name: string | null }>();
    for (const row of (itemRows ?? [])) {
      itemCategoryMap.set(row.id, { category_id: row.category_id, category_name: row.category_name });
    }

    // Fetch orders from Clover
    const orders = await fetchOrdersWithLineItems(startMs, endMs);

    const lineItemRows: Record<string, unknown>[] = [];

    for (const order of orders) {
      const lineItems = order.lineItems?.elements ?? [];
      for (const li of lineItems) {
        if (li.refunded) continue;

        const itemId = li.item?.id ?? null;
        // Prefer category embedded in the order response (covers deleted/hidden items)
        const embeddedCats = li.item?.categories?.elements ?? [];
        const embeddedCat = embeddedCats[0] ?? null;
        const categoryInfo = embeddedCat
          ? { category_id: embeddedCat.id, category_name: embeddedCat.name }
          : itemId
            ? (itemCategoryMap.get(itemId) ?? { category_id: null, category_name: null })
            : { category_id: null, category_name: null };

        const ts = li.createdTime || order.createdTime;
        const quantity = li.unitQty ?? li.quantity ?? 1;
        const unitPrice = li.price ?? 0;
        const discount = li.discountAmount ?? 0;
        const netPrice = (unitPrice * quantity) - discount;

        lineItemRows.push({
          id: li.id,
          order_id: order.id,
          item_id: itemId,
          item_name: li.name,
          category_id: categoryInfo.category_id,
          category_name: categoryInfo.category_name,
          quantity,
          unit_price_cents: unitPrice,
          discount_cents: discount,
          net_price_cents: Math.max(0, netPrice),
          sale_date: localDateStr(ts, LOCAL_TZ),
          sale_hour: localHour(ts, LOCAL_TZ),
          sale_ts: new Date(ts).toISOString(),
          pos_source: 'clover',
        });
      }
    }

    // Upsert in batches of 500
    const BATCH = 500;
    let totalSynced = 0;
    for (let i = 0; i < lineItemRows.length; i += BATCH) {
      const batch = lineItemRows.slice(i, i + BATCH);
      const { error } = await admin
        .from('sales_line_items')
        .upsert(batch, { onConflict: 'id' });
      if (error) throw new Error(error.message);
      totalSynced += batch.length;
    }

    // Update sync log
    if (logId) {
      await admin.from('sync_log').update({
        completed_at: new Date().toISOString(),
        records_synced: totalSynced,
      }).eq('id', logId);
    }

    return NextResponse.json({
      synced: totalSynced,
      orders: orders.length,
      dateRange: { start, end },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (logId) {
      await admin.from('sync_log').update({
        completed_at: new Date().toISOString(),
        error: message,
      }).eq('id', logId);
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

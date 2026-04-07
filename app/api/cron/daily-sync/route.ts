import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  fetchCategories,
  fetchItems,
  fetchOrdersWithLineItems,
  localDateStr,
  localHour,
} from '@/lib/clover';

export const maxDuration = 300; // 5-minute max (Vercel Pro)

const LOCAL_TZ = 'America/New_York';

function verify(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  // Vercel sets this header automatically for cron jobs
  const auth = req.headers.get('authorization');
  return auth === `Bearer ${secret}`;
}

// Sync categories and items
async function syncCatalog(admin: ReturnType<typeof createAdminClient>) {
  if (!admin) throw new Error('Admin client not available');

  const [categories, items] = await Promise.all([fetchCategories(), fetchItems()]);

  const catRows = categories.map((c) => ({
    id: c.id,
    name: c.name,
    sort_order: c.sortOrder,
    pos_source: 'clover',
    updated_at: new Date().toISOString(),
  }));

  const { error: catErr } = await admin
    .from('sales_categories')
    .upsert(catRows, { onConflict: 'id' });
  if (catErr) throw new Error(`categories: ${catErr.message}`);

  // Load category map for item enrichment
  const itemCategoryMap = new Map(
    categories.map((c) => [c.id, c.name])
  );

  const itemRows = items.map((item) => {
    const primaryCategory = item.categories[0];
    return {
      id: item.id,
      name: item.name,
      category_id: primaryCategory?.id ?? null,
      category_name: primaryCategory?.name ?? itemCategoryMap.get(primaryCategory?.id ?? '') ?? null,
      price_cents: item.price,
      pos_source: 'clover',
      active: !item.hidden && !item.deleted,
      updated_at: new Date().toISOString(),
    };
  });

  const BATCH = 500;
  for (let i = 0; i < itemRows.length; i += BATCH) {
    const { error } = await admin
      .from('sales_items')
      .upsert(itemRows.slice(i, i + BATCH), { onConflict: 'id' });
    if (error) throw new Error(`items batch ${i}: ${error.message}`);
  }

  return { categories: catRows.length, items: itemRows.length };
}

// Sync sales line items for a single date (YYYY-MM-DD)
async function syncDay(
  admin: ReturnType<typeof createAdminClient>,
  dateStr: string,
  itemCategoryMap: Map<string, { category_id: string | null; category_name: string | null }>
): Promise<number> {
  if (!admin) throw new Error('Admin client not available');

  const startMs = new Date(dateStr + 'T00:00:00-05:00').getTime();
  const endMs = new Date(dateStr + 'T00:00:00-05:00').getTime() + 86_400_000;

  const orders = await fetchOrdersWithLineItems(startMs, endMs);
  const rows: Record<string, unknown>[] = [];

  for (const order of orders) {
    for (const li of order.lineItems?.elements ?? []) {
      if (li.refunded) continue;
      const itemId = li.item?.id ?? null;

      // Prefer category embedded in the order response (includes deleted/hidden items)
      const embeddedCats = li.item?.categories?.elements ?? [];
      const embeddedCat = embeddedCats[0] ?? null;

      const catInfo = embeddedCat
        ? { category_id: embeddedCat.id, category_name: embeddedCat.name }
        : itemId
          ? (itemCategoryMap.get(itemId) ?? { category_id: null, category_name: null })
          : { category_id: null, category_name: null };

      const ts = li.createdTime || order.createdTime;
      const unitPrice = li.price ?? 0;
      const discount = li.discountAmount ?? 0;

      // Clover weight-based items store unitQty in thousandths (900 = 0.900 lbs).
      // Packaged/count items have unitQty undefined; those are always quantity 1.
      const rawUnitQty = li.unitQty;
      const quantity = rawUnitQty != null
        ? Math.round((rawUnitQty / 1000) * 1000) / 1000  // e.g. 10050 → 10.050
        : (li.quantity ?? 1);
      const netPrice = Math.max(0, Math.round(unitPrice * quantity) - discount);

      rows.push({
        id: li.id,
        order_id: order.id,
        item_id: itemId,
        item_name: li.name,
        category_id: catInfo.category_id,
        category_name: catInfo.category_name,
        quantity,
        unit_price_cents: unitPrice,
        discount_cents: discount,
        net_price_cents: netPrice,
        sale_date: localDateStr(ts, LOCAL_TZ),
        sale_hour: localHour(ts, LOCAL_TZ),
        sale_ts: new Date(ts).toISOString(),
        pos_source: 'clover',
      });
    }
  }

  const BATCH = 500;
  for (let i = 0; i < rows.length; i += BATCH) {
    const { error } = await admin
      .from('sales_line_items')
      .upsert(rows.slice(i, i + BATCH), { onConflict: 'id' });
    if (error) throw new Error(`line items batch ${i}: ${error.message}`);
  }

  return rows.length;
}

export async function GET(req: NextRequest) {
  return handler(req);
}

export async function POST(req: NextRequest) {
  return handler(req);
}

async function handler(req: NextRequest) {
  if (!verify(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  // days=2 for daily, days=90 for initial backfill
  const days = Math.min(365, Math.max(1, parseInt(searchParams.get('days') ?? '2') || 2));

  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: 'Admin not configured' }, { status: 500 });

  const log: string[] = [];
  const started = Date.now();

  try {
    // 1. Sync catalog
    log.push('Syncing catalog…');
    const catalog = await syncCatalog(admin);
    log.push(`  categories: ${catalog.categories}, items: ${catalog.items}`);

    // 2. Load item→category map from DB for enriching line items
    const { data: itemRows } = await admin
      .from('sales_items')
      .select('id, category_id, category_name');

    const itemCategoryMap = new Map<string, { category_id: string | null; category_name: string | null }>();
    for (const row of itemRows ?? []) {
      itemCategoryMap.set(row.id, { category_id: row.category_id, category_name: row.category_name });
    }

    // 3. Sync sales day by day (most recent first)
    let totalLineItems = 0;
    const today = new Date();
    const dateList: string[] = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      dateList.push(d.toLocaleDateString('en-CA', { timeZone: LOCAL_TZ }));
    }

    log.push(`Syncing sales for ${days} day(s)…`);
    for (const dateStr of dateList) {
      const count = await syncDay(admin, dateStr, itemCategoryMap);
      totalLineItems += count;
      log.push(`  ${dateStr}: ${count} line items`);
    }

    // 4. Write sync log entry
    await admin.from('sync_log').insert({
      sync_type: 'cron_daily',
      date_range_start: dateList[dateList.length - 1],
      date_range_end: dateList[0],
      records_synced: totalLineItems,
      completed_at: new Date().toISOString(),
    });

    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    return NextResponse.json({
      ok: true,
      elapsed: `${elapsed}s`,
      catalog,
      lineItemsSynced: totalLineItems,
      daysProcessed: days,
      log,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.push(`ERROR: ${message}`);
    try {
      await admin.from('sync_log').insert({
        sync_type: 'cron_daily',
        error: message,
        completed_at: new Date().toISOString(),
      });
    } catch { /* ignore log failure */ }
    return NextResponse.json({ ok: false, error: message, log }, { status: 500 });
  }
}

// One-time (and safe to re-run) endpoint: updates sales_line_items.category_*
// for rows where category_id IS NULL, using the sales_items catalog.
// Protected by CRON_SECRET.

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const maxDuration = 300;

function verify(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get('authorization') === `Bearer ${secret}`;
}

export async function POST(req: NextRequest) {
  if (!verify(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: 'Admin not configured' }, { status: 500 });

  // Load item → category map — paginate through all rows (REST API caps at 1000)
  const catMap = new Map<string, { category_id: string; category_name: string }>();
  let itemOffset = 0;
  const ITEM_PAGE = 1000;
  while (true) {
    const { data: items, error: itemsErr } = await admin
      .from('sales_items')
      .select('id, category_id, category_name')
      .not('category_id', 'is', null)
      .range(itemOffset, itemOffset + ITEM_PAGE - 1);
    if (itemsErr) return NextResponse.json({ error: itemsErr.message }, { status: 500 });
    for (const item of items ?? []) {
      if (item.category_id) {
        catMap.set(item.id, { category_id: item.category_id, category_name: item.category_name ?? '' });
      }
    }
    if (!items || items.length < ITEM_PAGE) break;
    itemOffset += ITEM_PAGE;
  }

  // Fetch all line items with null category that have a known item_id
  let offset = 0;
  const PAGE = 1000;
  let totalUpdated = 0;

  while (true) {
    const { data: rows, error: fetchErr } = await admin
      .from('sales_line_items')
      .select('id, item_id')
      .is('category_id', null)
      .not('item_id', 'is', null)
      .range(offset, offset + PAGE - 1);

    if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
    if (!rows || rows.length === 0) break;

    // Group by category so we can batch-update
    const byCat = new Map<string, { ids: string[]; category_id: string; category_name: string }>();
    for (const row of rows) {
      const cat = catMap.get(row.item_id ?? '');
      if (!cat) continue;
      const key = cat.category_id;
      const existing = byCat.get(key);
      if (existing) {
        existing.ids.push(row.id);
      } else {
        byCat.set(key, { ids: [row.id], ...cat });
      }
    }

    for (const { ids, category_id, category_name } of byCat.values()) {
      // Supabase REST supports `id=in.(a,b,c)` via .in()
      const CHUNK = 200;
      for (let i = 0; i < ids.length; i += CHUNK) {
        const chunk = ids.slice(i, i + CHUNK);
        const { error: updErr } = await admin
          .from('sales_line_items')
          .update({ category_id, category_name })
          .in('id', chunk);
        if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });
        totalUpdated += chunk.length;
      }
    }

    if (rows.length < PAGE) break;
    offset += PAGE;
  }

  return NextResponse.json({ ok: true, updated: totalUpdated });
}

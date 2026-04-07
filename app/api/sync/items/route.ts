import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { fetchItems } from '@/lib/clover';

export async function POST() {
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: 'Not configured' }, { status: 500 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: 'Admin not configured' }, { status: 500 });

  try {
    const items = await fetchItems();

    const rows = items.map(item => {
      const primaryCategory = item.categories[0];
      return {
        id: item.id,
        name: item.name,
        category_id: primaryCategory?.id ?? null,
        category_name: primaryCategory?.name ?? null,
        price_cents: item.price,
        pos_source: 'clover',
        active: !item.hidden && !item.deleted,
        updated_at: new Date().toISOString(),
      };
    });

    const { error } = await admin
      .from('sales_items')
      .upsert(rows, { onConflict: 'id' });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ synced: rows.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

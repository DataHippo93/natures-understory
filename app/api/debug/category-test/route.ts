import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const MID = process.env.NATURES_STOREHOUSE_MID;
  const TOKEN = process.env.NATURES_STOREHOUSE_TOKEN;
  if (!MID || !TOKEN) return NextResponse.json({ error: 'No creds' });

  const startMs = new Date('2026-04-06T00:00:00-04:00').getTime();
  const endMs = startMs + 86400000;

  const params = new URLSearchParams();
  params.append('filter', `createdTime>=${startMs}`);
  params.append('filter', `createdTime<${endMs}`);
  params.append('expand', 'lineItems,lineItems.item,lineItems.item.categories');
  params.append('limit', '3');

  const res = await fetch(`https://api.clover.com/v3/merchants/${MID}/orders?${params}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
    cache: 'no-store',
  });

  const data = await res.json();
  const orders = data.elements ?? [];

  const preview = orders.slice(0, 2).map((order: Record<string, unknown>) => {
    const lis = (order.lineItems as { elements: Record<string, unknown>[] })?.elements ?? [];
    return {
      orderId: order.id,
      lineItems: lis.slice(0, 3).map((li: Record<string, unknown>) => {
        const item = li.item as Record<string, unknown> | undefined;
        return {
          name: li.name,
          item_id: item?.id,
          categories: (item?.categories as { elements: Array<{ name: string }> })?.elements?.map(c => c.name) ?? null,
        };
      }),
    };
  });

  return NextResponse.json({ url: `${params}`, preview });
}

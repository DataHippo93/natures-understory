// GET /api/inventory/stock-take?category=Produce&limit=50 — drift-prioritized count list.
import { NextResponse } from 'next/server';
import { generateStockTake } from '@/lib/stock-take';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const category = url.searchParams.get('category') ?? 'Produce';
  const limit = Math.min(500, Math.max(10, parseInt(url.searchParams.get('limit') ?? '50', 10) || 50));
  try {
    const result = await generateStockTake({ category, limit });
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

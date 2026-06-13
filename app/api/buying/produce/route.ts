// GET /api/buying/produce — produce next-order evaluation.
import { NextResponse } from 'next/server';
import { evaluateNextProduceOrder } from '@/lib/next-order';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const result = await evaluateNextProduceOrder();
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

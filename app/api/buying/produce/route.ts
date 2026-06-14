// GET /api/buying/produce — produce next-order evaluation (no notes).
// POST /api/buying/produce { notes: string } — same evaluation with overrides applied.
import { NextResponse } from 'next/server';
import { evaluateNextProduceOrder } from '@/lib/next-order';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json(await evaluateNextProduceOrder());
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({} as { notes?: string }));
    return NextResponse.json(await evaluateNextProduceOrder({ notes: body?.notes }));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

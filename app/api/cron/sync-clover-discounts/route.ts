// app/api/cron/sync-clover-discounts/route.ts
// Vercel cron: every 15 min. Pulls discount-tagged Clover order lines into the Loss Tally Sheet.
import { NextRequest, NextResponse } from 'next/server';
import { runLossSync } from '@/lib/loss-sync';

export const maxDuration = 300;

function verify(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.get('authorization');
  return auth === `Bearer ${secret}`;
}

async function handler(req: NextRequest) {
  if (!verify(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const result = await runLossSync();
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  } catch (e) {
    const err = e as Error;
    return NextResponse.json({ ok: false, error: err.message ?? String(e) }, { status: 500 });
  }
}

export async function GET(req: NextRequest)  { return handler(req); }
export async function POST(req: NextRequest) { return handler(req); }

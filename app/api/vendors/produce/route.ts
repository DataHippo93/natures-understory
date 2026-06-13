// GET /api/vendors/produce — list active produce vendors with computed schedule fields.
import { NextResponse } from 'next/server';
import { listProduceVendors } from '@/lib/produce-vendors';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const activeOnly = url.searchParams.get('active') !== 'false';
  try {
    const vendors = await listProduceVendors({ activeOnly });
    return NextResponse.json({ vendors, generated_at: new Date().toISOString() });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// GET /api/produce-orders/vendors  — vendor picker feed.

import { NextResponse } from 'next/server';
import { hasRole } from '@/lib/rbac';
import { listProduceVendors } from '@/lib/produce-vendors';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await hasRole(['buying_manager', 'wholesale_manager', 'admin']);
  if (!session) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  try {
    const vendors = await listProduceVendors({ activeOnly: true });
    return NextResponse.json({ vendors });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'unknown' }, { status: 500 });
  }
}

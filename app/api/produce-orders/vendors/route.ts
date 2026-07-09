// v7.7.8 (2026-07-09): produce ordering surface locked to `admin` role.
// Daniel (wholesale_manager) is scoped to /lopro/wholesale-pricing only.

// GET /api/produce-orders/vendors  — vendor picker feed.

import { NextResponse } from 'next/server';
import { hasRole } from '@/lib/rbac';
import { listProduceVendors } from '@/lib/produce-vendors';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await hasRole(['admin']);
  if (!session) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  try {
    const vendors = await listProduceVendors({ activeOnly: true });
    return NextResponse.json({ vendors });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'unknown' }, { status: 500 });
  }
}

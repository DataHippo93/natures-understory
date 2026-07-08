import { NextResponse } from 'next/server';
import { hasRole } from '@/lib/rbac';
import { loadGrid } from '@/lib/wholesale';

// GET — full wholesale grid (wholesale_manager/admin only)
export async function GET() {
  const session = await hasRole(['wholesale_manager', 'admin']);
  if (!session) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });

  try {
    const rows = await loadGrid();
    return NextResponse.json({ rows });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to load grid' },
      { status: 502 }
    );
  }
}

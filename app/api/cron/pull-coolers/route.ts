import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { syncCoolerReadings } from '@/lib/coolers';

export const maxDuration = 60;

const RETENTION_DAYS = 90;

function verify(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get('authorization') === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!verify(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: 'Admin not configured' }, { status: 500 });

  const started = Date.now();
  try {
    const result = await syncCoolerReadings();

    // Light-touch retention: prune once an hour (first poll of the hour).
    if (new Date().getMinutes() < 5) {
      const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000).toISOString();
      await admin.from('cooler_readings').delete().lt('recorded_at', cutoff);
    }

    await admin.from('sync_log').insert({
      sync_type: 'cooler_readings',
      records_synced: result.readingsWritten,
      completed_at: new Date().toISOString(),
      metadata: {
        sensors_seen: result.sensorsSeen,
        newly_discovered: result.newlyDiscovered,
      },
    });

    return NextResponse.json({
      ok: true,
      elapsedMs: Date.now() - started,
      ...result,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      await admin.from('sync_log').insert({
        sync_type: 'cooler_readings',
        error: message,
        completed_at: new Date().toISOString(),
      });
    } catch { /* ignore log failure */ }
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

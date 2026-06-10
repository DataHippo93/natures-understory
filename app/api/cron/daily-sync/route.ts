import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * DEPRECATED 2026-06-10 by Claude session local_4cc14fae.
 *
 * This cron used to sync Clover categories/items/sales line-items to
 * `sales_categories` / `sales_items` / `sales_line_items` Supabase tables.
 *
 * Those tables NEVER EXISTED in the natures-understory Supabase project, so
 * every run from 2026-05-11 onwards (the start of the observed window) errored
 * with `categories: Could not find the table 'public.sales_categories' in the
 * schema cache` — a 100% error rate for 30 consecutive days.
 *
 * PR #4 (merged 2026-06-10 03:40 UTC) pivoted /reports/categories and
 * /reports/items to read from Thrive (`thrive_product_catalog`). That removed
 * any consumer of the Clover catalog tables — the cron's outputs were no
 * longer needed by any downstream code.
 *
 * Fix: removed the schedule entry from vercel.json so it stops firing. The
 * handler stays in place as a 410 GONE stub so manual hits get a clear signal
 * instead of a 500. If Clark wants to bring back Clover catalog sync, create
 * the missing tables via a Supabase migration and replace this body.
 */

function verify(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.get('authorization');
  return auth === `Bearer ${secret}`;
}

async function handler(req: NextRequest) {
  if (!verify(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const admin = createAdminClient();
  if (admin) {
    try {
      await admin.from('sync_log').insert({
        sync_type: 'cron_daily',
        completed_at: new Date().toISOString(),
        records_synced: 0,
        error: 'DEPRECATED: route stub; cron schedule removed 2026-06-10. See route comment.',
      });
    } catch { /* ignore log failure */ }
  }
  return NextResponse.json(
    {
      ok: false,
      deprecated: true,
      message:
        'daily-sync was retired 2026-06-10. Categories/items now come from thrive_product_catalog (PR #4).',
    },
    { status: 410 },
  );
}

export async function GET(req: NextRequest)  { return handler(req); }
export async function POST(req: NextRequest) { return handler(req); }

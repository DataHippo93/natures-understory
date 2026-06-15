/**
 * POST /api/orders/produce/parse-notes
 * Body: { notes: string }
 * Returns: { lines, totals }
 *
 * Auth: caller must be signed in (matches the rest of /orders/* surface).
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { parseNotesLlm } from '@/lib/notes-parser-llm';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // up to 60s — 16-line note × ~2s/line worst case

// Soft rate-limit: 200 LLM calls / hour per user. Cache hits don't count.
const RATE_LIMIT_PER_HOUR = 200;

export async function POST(req: Request) {
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: 'supabase not configured' }, { status: 500 });
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: { notes?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const notes = (body.notes ?? '').trim();
  if (!notes) return NextResponse.json({ lines: [], totals: { cache_hits: 0, llm_calls: 0, total_cost_usd: 0 } });

  // Cheap rate-limit: count cache rows created in the last hour.
  const admin = createAdminClient();
  if (admin) {
    const { count } = await admin
      .from('notes_parse_cache')
      .select('hash', { count: 'exact', head: true })
      .gte('created_at', new Date(Date.now() - 3600_000).toISOString());
    if ((count ?? 0) > RATE_LIMIT_PER_HOUR) {
      return NextResponse.json({ error: 'rate_limit', message: 'Too many parses this hour — try again later.' }, { status: 429 });
    }
  }

  // Pull the active produce catalog for fuzzy binding.
  let catalog: { thrive_item_id: string; name: string }[] = [];
  if (admin) {
    const { data } = await admin.rpc('run_report_query', {
      query_sql: `SELECT thrive_item_id, name FROM thrive_product_catalog WHERE active = true AND department = 'Produce' ORDER BY name`,
    });
    catalog = (data ?? []) as typeof catalog;
  }

  try {
    const result = await parseNotesLlm(notes, catalog);
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: 'llm_failed', message: msg }, { status: 500 });
  }
}

// Mon/Thu 6:50 AM ET (10:50 UTC) — pull Jasmia's pricelist emails and
// ingest into alberts_price_entries / alberts_price_history /
// alberts_price_list_meta.
//
// Mirrors scripts/pull_pricelists.py from the natures-produce-buying repo.
// Idempotent: re-runs that find the same Gmail message + same content
// hash skip without writes.

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { fetchCsvAttachments } from '@/lib/gmail';
import { parsePricelist, sha256Hex, type ParsedPricelist } from '@/lib/alberts';

export const runtime = 'nodejs';
export const maxDuration = 300;

const LOCAL_TZ = 'America/New_York';

function verify(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.get('authorization');
  return auth === `Bearer ${secret}`;
}

function todayLocal(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: LOCAL_TZ });
}

export async function GET(req: NextRequest) { return handler(req); }
export async function POST(req: NextRequest) { return handler(req); }

async function handler(req: NextRequest) {
  if (!verify(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const targetDate = searchParams.get('date') ?? todayLocal();
  const dryRun = searchParams.get('dry') === '1';

  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: 'Admin not configured' }, { status: 500 });

  const log: string[] = [];
  const started = Date.now();
  const startedAt = new Date().toISOString();

  // Sync log row — start
  const { data: logEntry } = await admin.from('sync_log').insert({
    sync_type: 'alberts_pricelist',
    started_at: startedAt,
    date_range_start: targetDate,
    date_range_end: targetDate,
  }).select().single();
  const logId: string | undefined = logEntry?.id;

  try {
    // Find pricelist messages from Jasmia for the target date
    const query = `from:Jasmia.Cansler@unfi.com subject:Pricelist has:attachment after:${gmailDate(targetDate, -1)} before:${gmailDate(targetDate, 1)}`;
    log.push(`Gmail query: ${query}`);
    const attachments = await fetchCsvAttachments(query, 20);
    log.push(`Found ${attachments.length} CSV attachment(s)`);

    let totalRows = 0;
    const meta: Array<{ list_type: string; row_count: number; filename: string }> = [];

    for (const att of attachments) {
      const text = att.bytes.toString('utf-8');
      const hash = sha256Hex(att.bytes);

      // Idempotency: same (msg_id, filename, content_hash) → skip
      const { data: existing } = await admin
        .from('alberts_price_list_meta')
        .select('id')
        .eq('list_date', targetDate)
        .eq('source_filename', att.filename)
        .maybeSingle();
      if (existing) {
        log.push(`  skip (already ingested): ${att.filename}`);
        continue;
      }

      let parsed: ParsedPricelist;
      try {
        parsed = parsePricelist(text);
      } catch (e) {
        log.push(`  parse-error ${att.filename}: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }

      meta.push({ list_type: parsed.list_type, row_count: parsed.row_count, filename: att.filename });

      if (dryRun) {
        log.push(`  DRY: ${att.filename} → ${parsed.list_type}, ${parsed.row_count} rows`);
        totalRows += parsed.row_count;
        continue;
      }

      // 1) meta row
      await admin.from('alberts_price_list_meta').insert({
        list_date: targetDate,
        list_type: parsed.list_type,
        source_filename: att.filename,
        msg_id: att.msgId,
        content_hash: hash,
        row_count: parsed.row_count,
      });

      // 2) entries (current pricelist) — replace all rows for (date, list_type)
      await admin.from('alberts_price_entries')
        .delete()
        .eq('list_date', targetDate)
        .eq('list_type', parsed.list_type);

      const entries = parsed.rows.map((r) => ({
        list_date: targetDate,
        list_type: parsed.list_type,
        sku: r.sku,
        product_desc: r.product_desc,
        size: r.size,
        prod_type: r.prod_type,
        shipper_code: r.shipper_code,
        price: r.price,
        unit_cost: r.unit_cost,
        pack_size: r.pkg_size,
        pack: r.pack,
        upc_plu: r.upc_plu,
        origin: r.origin,
        availability: r.availability,
      }));
      await batchInsert(admin, 'alberts_price_entries', entries, 500);

      // 3) history (append idempotent)
      const history = parsed.rows.map((r) => ({
        list_date: targetDate,
        list_type: parsed.list_type,
        sku: r.sku,
        price: r.price,
        unit_cost: r.unit_cost,
        prod_type: r.prod_type,
      }));
      // Upsert on PK (list_date, list_type, sku)
      const BATCH = 500;
      for (let i = 0; i < history.length; i += BATCH) {
        const { error } = await admin
          .from('alberts_price_history')
          .upsert(history.slice(i, i + BATCH), { onConflict: 'list_date,list_type,sku' });
        if (error) throw new Error(`alberts_price_history batch ${i}: ${error.message}`);
      }

      totalRows += parsed.row_count;
      log.push(`  ingested ${att.filename} (${parsed.list_type}): ${parsed.row_count} rows`);
    }

    if (logId) {
      await admin.from('sync_log').update({
        completed_at: new Date().toISOString(),
        records_synced: totalRows,
      }).eq('id', logId);
    }

    return NextResponse.json({
      ok: true,
      target_date: targetDate,
      dry_run: dryRun,
      total_rows: totalRows,
      attachments: meta,
      elapsed_s: ((Date.now() - started) / 1000).toFixed(1),
      log,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.push(`ERROR: ${message}`);
    if (logId) {
      try {
        await admin.from('sync_log').update({
          completed_at: new Date().toISOString(),
          error: message,
        }).eq('id', logId);
      } catch { /* ignore */ }
    }
    return NextResponse.json({ ok: false, error: message, log }, { status: 500 });
  }
}

/** Format a YYYY-MM-DD as a Gmail-compatible date with `+offsetDays`. */
function gmailDate(date: string, offsetDays: number): string {
  const d = new Date(date + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10).replace(/-/g, '/');
}

async function batchInsert(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  table: string,
  rows: Array<Record<string, unknown>>,
  size: number,
): Promise<void> {
  for (let i = 0; i < rows.length; i += size) {
    const { error } = await admin.from(table).insert(rows.slice(i, i + size));
    if (error) throw new Error(`${table} batch ${i}: ${error.message}`);
  }
}

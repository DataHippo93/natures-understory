// Mon/Thu */20 17-23 ET — watch for Jasmia's invoice email and ingest.
//
// Subject pattern: "Invoice from Chesterfield NH AO DC - Invoice Number XXXXX"
// Mirrors scripts/pull_invoice.py from natures-produce-buying.

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { fetchCsvAttachments } from '@/lib/gmail';
import { parseInvoice } from '@/lib/alberts';

export const runtime = 'nodejs';
export const maxDuration = 120;

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

  const { data: logEntry } = await admin.from('sync_log').insert({
    sync_type: 'alberts_invoice',
    started_at: startedAt,
    date_range_start: targetDate,
    date_range_end: targetDate,
  }).select().single();
  const logId: string | undefined = logEntry?.id;

  try {
    // The invoice email subject on order day; search a 36h window
    const query = `from:Jasmia.Cansler@unfi.com OR from:Chesterfield@unfi.com subject:Invoice has:attachment newer_than:2d`;
    log.push(`Gmail query: ${query}`);
    const attachments = await fetchCsvAttachments(query, 10);
    log.push(`Found ${attachments.length} CSV attachment(s)`);

    if (!attachments.length) {
      if (logId) {
        await admin.from('sync_log').update({
          completed_at: new Date().toISOString(),
          records_synced: 0,
        }).eq('id', logId);
      }
      return NextResponse.json({ ok: true, no_invoice_yet: true, target_date: targetDate, log });
    }

    let totalRows = 0;
    const ingested: Array<{ invoice_no: string; lines: number }> = [];

    for (const att of attachments) {
      const text = att.bytes.toString('utf-8');
      const rows = parseInvoice(text);
      if (!rows.length) {
        log.push(`  empty-or-unparseable: ${att.filename}`);
        continue;
      }
      const invoiceNo = rows[0].invoice_no;
      if (!invoiceNo) {
        log.push(`  missing-invoice-no: ${att.filename}`);
        continue;
      }

      // Idempotent: skip if already ingested
      const { data: existing } = await admin
        .from('alberts_invoices').select('invoice_no').eq('invoice_no', invoiceNo).maybeSingle();
      if (existing) {
        log.push(`  skip (already ingested): inv ${invoiceNo}`);
        continue;
      }

      if (dryRun) {
        log.push(`  DRY: inv ${invoiceNo}, ${rows.length} lines`);
        totalRows += rows.length;
        ingested.push({ invoice_no: invoiceNo, lines: rows.length });
        continue;
      }

      const totalCents = rows.reduce((acc, r) => {
        const each = r.case_price ?? 0;
        const qty = r.ship_qty ?? 0;
        return acc + Math.round(each * qty * 100);
      }, 0);

      await admin.from('alberts_invoices').insert({
        invoice_no: invoiceNo,
        cust_po: rows[0].cust_po,
        order_date: targetDate,
        invoice_date: rows[0].invoice_date,
        raw_csv: att.bytes.toString('base64'),
        total_cents: totalCents,
      });

      const lineRows = rows.map((r) => ({
        invoice_no: invoiceNo,
        alberts_sku: r.alberts_sku,
        ship_qty: r.ship_qty,
        case_price: r.case_price,
        each_price: r.each_price,
        long_desc: r.long_desc,
        brand_name: r.brand_name,
        pack_count: r.pkg_count,
        pkg_size: r.pkg_size,
        upc_plu: r.upc_plu,
        variety: r.variety,
        grade: r.grade,
        commodity: r.commodity,
        uom_desc: r.uom_desc,
        uom_abbr: r.uom_abbr,
        category: r.category,
        origin: r.country_of_origin,
      }));
      const BATCH = 500;
      for (let i = 0; i < lineRows.length; i += BATCH) {
        const { error } = await admin.from('alberts_invoice_lines').insert(lineRows.slice(i, i + BATCH));
        if (error) throw new Error(`invoice_lines batch ${i}: ${error.message}`);
      }

      totalRows += rows.length;
      ingested.push({ invoice_no: invoiceNo, lines: rows.length });
      log.push(`  ingested invoice ${invoiceNo}: ${rows.length} lines, $${(totalCents / 100).toFixed(2)}`);

      // Update parent order with the invoice number
      await admin.from('alberts_orders')
        .update({ invoice_number: invoiceNo, invoice_received_at: new Date().toISOString() })
        .eq('order_date', targetDate);
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
      ingested,
      total_rows: totalRows,
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

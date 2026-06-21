// Daily 12:01 AM EDT — produce sales report for yesterday.
//
// Sends an HTML email (via Resend) summarizing the previous day's Produce
// department sales: yesterday's totals (units, gross, COGS, margin), a top-N
// item table, and a footnote describing the data sources + carve-outs.
//
// Triggered by Vercel cron (see vercel.json: "1 4 * * *" UTC = 00:01 EDT).
// Gated on Authorization: Bearer ${CRON_SECRET}.

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getInventoryCostsByVariant } from '@/lib/inventory-cost';

export const runtime = 'nodejs';
export const maxDuration = 300;

const TZ = 'America/New_York';
const FROM = `Nature's Storehouse Reports <no-reply@ycconsulting.biz>`;
const TO = ['cmaine@ycconsulting.biz'];
const CC = ['danielzmartin2024@gmail.com'];

function verify(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get('authorization') === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) { return handler(req); }
export async function POST(req: NextRequest) { return handler(req); }

interface SaleRow {
  item_name: string;
  variant_id: string;
  units: number;
  rev_cents: number;
  cogs_cents_at_sale: number;
  discount_cents: number;
  refunded_units: number;
}

interface CategoryEntry { name?: string }
interface RawSale { discount?: number; categories?: CategoryEntry[] }

async function handler(req: NextRequest) {
  if (!verify(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: 'Admin not configured' }, { status: 500 });
  }

  // Yesterday in America/New_York as ISO date (YYYY-MM-DD)
  const { iso: yesterdayIso, mdy: yesterdayMdy } = yesterdayInTz(TZ);

  const log: string[] = [];
  log.push(`Target date: ${yesterdayIso} (yesterday in ${TZ})`);

  try {
    // Pull yesterday's Produce sales aggregated by variant.
    const sql = `
      SELECT s.item_name,
             s.variant_id,
             COALESCE(SUM(s.units), 0)::float          AS units,
             COALESCE(SUM(s.revenue_cents), 0)::int    AS rev_cents,
             COALESCE(SUM(s.cost_cents), 0)::int       AS cogs_cents_at_sale,
             COALESCE(SUM((s.raw->>'discount')::numeric * 100), 0)::int AS discount_cents,
             COALESCE(SUM(s.refunded_units), 0)::float AS refunded_units
      FROM thrive_sales_history s
      JOIN thrive_product_catalog c ON c.thrive_variant_id = s.variant_id
      WHERE c.department = 'Produce'
        AND s.sale_date = '${yesterdayIso}'::date
      GROUP BY s.item_name, s.variant_id
      ORDER BY rev_cents DESC
    `;
    const { data, error } = await admin.rpc('run_report_query', { query_sql: sql });
    if (error) throw new Error(`sales pull: ${error.message}`);

    const rows: SaleRow[] = ((data as SaleRow[] | null) ?? []).map((r) => ({
      item_name: r.item_name ?? '(unnamed)',
      variant_id: String(r.variant_id ?? ''),
      units: Number(r.units ?? 0),
      rev_cents: Number(r.rev_cents ?? 0),
      cogs_cents_at_sale: Number(r.cogs_cents_at_sale ?? 0),
      discount_cents: Number(r.discount_cents ?? 0),
      refunded_units: Number(r.refunded_units ?? 0),
    }));

    log.push(`Sale rows: ${rows.length}`);

    // Recompute COGS client-side from current catalog (live inventory cost)
    const variantIds = rows.map((r) => r.variant_id).filter(Boolean);
    const costMap = await getInventoryCostsByVariant(variantIds);

    let lastReceiptCount = 0;
    let defaultCount = 0;
    let missingCount = 0;

    interface EnrichedRow extends SaleRow { recomputed_cogs_cents: number; cost_source: string }
    const enriched: EnrichedRow[] = rows.map((r) => {
      const live = costMap.get(r.variant_id);
      const source = live?.source ?? 'missing';
      if (source === 'last_receipt') lastReceiptCount++;
      else if (source === 'default') defaultCount++;
      else missingCount++;
      const liveCostCents = Math.round((live?.dollars ?? 0) * 100);
      return {
        ...r,
        recomputed_cogs_cents: Math.round(liveCostCents * r.units),
        cost_source: source,
      };
    });

    // Carve out spoilage rows: rows with refunded_units >= units AND rev_cents ≤ 0,
    // OR rows with negative revenue (i.e., comp/spoilage line items).
    const isSpoilage = (r: EnrichedRow) =>
      r.rev_cents <= 0 || (r.refunded_units > 0 && r.refunded_units >= r.units);

    const spoilage = enriched.filter(isSpoilage);
    const live = enriched.filter((r) => !isSpoilage(r));

    const spoilageDollars = spoilage.reduce((a, r) => a + r.recomputed_cogs_cents, 0) / 100;
    const spoilageCount = spoilage.length;

    // Discount 8 re-attribution: Clover Discount 8 is the produce-loss SKU
    // proxy. Re-attribution from Clover orders requires the clover_orders
    // table; if absent we record $0 and note in the footnote. (Wired through
    // env var so future plumbing can light it up without a redeploy.)
    let discount8Cents = 0;
    let discount8Note = 'no clover_orders source — $0';
    try {
      const { data: d8 } = await admin.rpc('run_report_query', {
        query_sql: `
          SELECT COALESCE(SUM(amount_cents), 0)::int AS cents
          FROM clover_discounts
          WHERE discount_id = '8'
            AND order_date = '${yesterdayIso}'::date
        `,
      });
      if (Array.isArray(d8) && d8.length) {
        discount8Cents = Number((d8[0] as { cents?: number }).cents ?? 0);
        discount8Note = `from clover_discounts: $${(discount8Cents / 100).toFixed(2)}`;
      }
    } catch {
      // table likely doesn't exist yet — stay at $0 with the default note
    }

    // Aggregates
    const grossCents = live.reduce((a, r) => a + r.rev_cents, 0);
    const cogsAtSaleCents = live.reduce((a, r) => a + r.cogs_cents_at_sale, 0);
    const cogsRecomputedCents = live.reduce((a, r) => a + r.recomputed_cogs_cents, 0);
    const discountCents = live.reduce((a, r) => a + r.discount_cents, 0);
    const totalUnits = live.reduce((a, r) => a + r.units, 0);
    const netCents = grossCents - discountCents - discount8Cents;
    const marginCents = netCents - cogsRecomputedCents;
    const marginPct = netCents > 0 ? (marginCents / netCents) * 100 : 0;

    // Build the email
    const subject = `Produce Sales — ${yesterdayMdy}`;
    const html = renderHtml({
      yesterdayIso,
      yesterdayMdy,
      live,
      totalUnits,
      grossCents,
      discountCents,
      discount8Cents,
      discount8Note,
      netCents,
      cogsAtSaleCents,
      cogsRecomputedCents,
      marginCents,
      marginPct,
      spoilageCount,
      spoilageDollars,
      costSources: { lastReceiptCount, defaultCount, missingCount },
    });

    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) {
      throw new Error('RESEND_API_KEY not configured');
    }

    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM,
        to: TO,
        cc: CC,
        subject,
        html,
      }),
    });
    const resendBody = await resendRes.text();
    if (!resendRes.ok) {
      throw new Error(`resend ${resendRes.status}: ${resendBody}`);
    }
    let resendId: string | undefined;
    try { resendId = (JSON.parse(resendBody) as { id?: string }).id; } catch { /* ignore */ }

    log.push(`Resend ok: id=${resendId ?? '(none)'}`);

    // Audit log
    try {
      await admin.from('sync_log').insert({
        sync_type: 'produce_sales_report',
        records_synced: live.length,
        completed_at: new Date().toISOString(),
        metadata: {
          target_date: yesterdayIso,
          rows_live: live.length,
          rows_spoilage: spoilageCount,
          gross_cents: grossCents,
          net_cents: netCents,
          cogs_recomputed_cents: cogsRecomputedCents,
          margin_pct: Number(marginPct.toFixed(2)),
          resend_id: resendId ?? null,
        },
      });
    } catch { /* ignore audit-log failures */ }

    return NextResponse.json({
      ok: true,
      target_date: yesterdayIso,
      rows_live: live.length,
      rows_spoilage: spoilageCount,
      gross_cents: grossCents,
      net_cents: netCents,
      cogs_recomputed_cents: cogsRecomputedCents,
      margin_pct: Number(marginPct.toFixed(2)),
      resend_id: resendId ?? null,
      log,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.push(`ERROR: ${message}`);
    return NextResponse.json({ ok: false, error: message, log }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function yesterdayInTz(tz: string): { iso: string; mdy: string } {
  const now = new Date();
  // Parts in target TZ
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const todayY = Number(parts.find((p) => p.type === 'year')?.value);
  const todayM = Number(parts.find((p) => p.type === 'month')?.value);
  const todayD = Number(parts.find((p) => p.type === 'day')?.value);
  // Construct yesterday by subtracting one day at noon UTC to avoid DST edges
  const d = new Date(Date.UTC(todayY, todayM - 1, todayD, 12, 0, 0));
  d.setUTCDate(d.getUTCDate() - 1);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    iso: `${y}-${pad(m)}-${pad(day)}`,
    mdy: `${m}/${day}/${y}`,
  };
}

function fmtMoney(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents) / 100;
  return `${sign}$${abs.toFixed(2)}`;
}

function fmtUnits(n: number): string {
  return Math.abs(n - Math.round(n)) < 1e-6 ? String(Math.round(n)) : n.toFixed(2);
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ---------------------------------------------------------------------------
// HTML render
// ---------------------------------------------------------------------------

interface RenderArgs {
  yesterdayIso: string;
  yesterdayMdy: string;
  live: Array<{ item_name: string; units: number; rev_cents: number; recomputed_cogs_cents: number; cost_source: string }>;
  totalUnits: number;
  grossCents: number;
  discountCents: number;
  discount8Cents: number;
  discount8Note: string;
  netCents: number;
  cogsAtSaleCents: number;
  cogsRecomputedCents: number;
  marginCents: number;
  marginPct: number;
  spoilageCount: number;
  spoilageDollars: number;
  costSources: { lastReceiptCount: number; defaultCount: number; missingCount: number };
}

function renderHtml(a: RenderArgs): string {
  const top = [
    `<b>Produce Sales — ${a.yesterdayMdy}</b>`,
    `Date: ${a.yesterdayIso} (${TZ})`,
    `Gross: ${fmtMoney(a.grossCents)} on ${fmtUnits(a.totalUnits)} units across ${a.live.length} items`,
    `Net (after discounts ${fmtMoney(a.discountCents + a.discount8Cents)}): ${fmtMoney(a.netCents)}`,
    `COGS (recomputed from current catalog): ${fmtMoney(a.cogsRecomputedCents)}`,
    `Margin: ${fmtMoney(a.marginCents)} (${a.marginPct.toFixed(1)}%)`,
  ];

  const tableRows = a.live.map((r) => {
    const margin = r.rev_cents - r.recomputed_cogs_cents;
    return `<tr>
      <td style="padding:4px 8px;border-bottom:1px solid #eee">${esc(r.item_name)}</td>
      <td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right">${fmtUnits(r.units)}</td>
      <td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right">${fmtMoney(r.rev_cents)}</td>
      <td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right">${fmtMoney(r.recomputed_cogs_cents)}</td>
      <td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right">${fmtMoney(margin)}</td>
    </tr>`;
  }).join('');

  const footnote = [
    `Cost source mix: ${a.costSources.lastReceiptCount} last-receipt, ${a.costSources.defaultCount} catalog-default (stale), ${a.costSources.missingCount} missing.`,
    `Spoilage carve-out: ${a.spoilageCount} rows excluded, est. ${fmtMoney(Math.round(a.spoilageDollars * 100))} cost.`,
    `Clover Discount 8 re-attributed: ${a.discount8Note}.`,
    `COGS at sale time (snapshot): ${fmtMoney(a.cogsAtSaleCents)} vs. recomputed ${fmtMoney(a.cogsRecomputedCents)}.`,
    `Generated by Vercel cron /api/cron/produce-sales-report at ${new Date().toISOString()}.`,
  ];

  return `<!doctype html>
<html><body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#222;font-size:14px;line-height:1.5">
${top.map((l) => `<div>${l}</div>`).join('\n')}
<br>
<table style="border-collapse:collapse;font-size:13px;min-width:520px">
  <thead>
    <tr style="background:#f4f4f4">
      <th style="padding:6px 8px;text-align:left;border-bottom:2px solid #ccc">Item</th>
      <th style="padding:6px 8px;text-align:right;border-bottom:2px solid #ccc">Units</th>
      <th style="padding:6px 8px;text-align:right;border-bottom:2px solid #ccc">Gross</th>
      <th style="padding:6px 8px;text-align:right;border-bottom:2px solid #ccc">COGS</th>
      <th style="padding:6px 8px;text-align:right;border-bottom:2px solid #ccc">Margin</th>
    </tr>
  </thead>
  <tbody>
    ${tableRows || '<tr><td colspan="5" style="padding:12px;color:#888;text-align:center">No Produce sales for this date.</td></tr>'}
  </tbody>
</table>
<br>
<div style="color:#666;font-size:12px">
${footnote.map((l) => `<div>${esc(l)}</div>`).join('\n')}
</div>
</body></html>`;
}

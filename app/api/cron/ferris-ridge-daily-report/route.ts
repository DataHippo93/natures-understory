/**
 * Ferris Ridge Farm — Daily Sales Report (vendor-facing)
 *
 * Emails David Ferris (with Clark CC'd) a friendly one-page summary of what sold
 * of Ferris Ridge Farm's items at Nature's Storehouse yesterday, at what price,
 * and what's still on the shelf.
 *
 * This is a VENDOR-FACING report — no cost, margin, or contribution numbers.
 * Loss-tally spoilage is combined into a single friendly "marked down" line.
 *
 * Cron: `15 5 * * *` (05:15 UTC ≈ 01:15 ET). Fires alongside produce-sales-report
 * which triggers the inventory sync; this route reads the freshest snapshot but
 * also best-effort-triggers the sync itself for safety.
 *
 * Auth: Bearer ${CRON_SECRET}
 *
 * Query params (manual runs):
 *   ?test=1          — send to Clark only with "TEST for review" subject + preamble
 *   ?date=YYYY-MM-DD — override the report date (default: yesterday ET)
 *
 * Env required:
 *   UNDERSTORY_SUPABASE_URL
 *   UNDERSTORY_SUPABASE_SERVICE_ROLE_KEY
 *   RESEND_API_KEY
 *   CRON_SECRET                     (gates this route)
 *   THRIVE_PIPELINE_CRON_SECRET     (optional; used to nudge inventory sync)
 */

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 120;
export const dynamic = 'force-dynamic';

// ---------- constants ----------
const FROM_ADDR = "Nature's Storehouse Reports <no-reply@ycconsulting.biz>";

const LIVE_RECIPIENTS = {
  to: ['Ferrisridgefarm@gmail.com'],
  cc: ['clark@natures-storehouse.com'],
};
const TEST_RECIPIENTS = {
  to: ['cmaine@ycconsulting.biz'],
  cc: [] as string[],
};

const FERRIS_RIDGE_VENDOR_ID = '2527111384937019743';
const INV_SYNC_URL = 'https://thrive-pipeline.vercel.app/api/cron/inventory';

// ---------- helpers ----------
function usd(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}$${(abs / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function esc(s: unknown): string {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function fmtQty(n: number): string {
  // Whole units → "3"; fractional → "1.25". Trim trailing zeros.
  const s = n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  return s || '0';
}

function friendlyProductName(item: string, variant: string | null | undefined): string {
  const i = (item ?? '').trim();
  const v = (variant ?? '').trim();
  if (!v || v.toLowerCase() === i.toLowerCase()) return i;
  return `${i} — ${v}`;
}

// ---------- types ----------
type Variant = {
  thrive_variant_id: string;
  thrive_item_id: string;
  sku: string | null;
  name: string;
  price_cents: number | null;
  active: boolean | null;
  raw: { item?: { name?: string } } | null;
};

type SaleRow = {
  variant_id: string;
  sale_date: string;
  item_name: string | null;
  variant_name: string | null;
  units: number | string | null;
  revenue_cents: number | string | null;
};

type InvRow = {
  thrive_item_id: string;
  sales_item_id: string | null;
  item_name: string | null;
  qty_on_hand: number | string | null;
  unit: string | null;
  stockout: boolean | null;
  snapshot_ts: string | null;
};

type LossRow = {
  item_name: string | null;
  quantity: number | string | null;
  total_cents: number | string | null;
  pulled_date: string | null;
};

type Line = {
  variant_id: string;
  item_id: string;
  parent_name: string;
  variant_name: string;
  display_name: string;
  price_cents: number;
  units_sold_yday: number;
  revenue_cents_yday: number;
  units_prev_week_same_dow: number;
  units_last_7d_avg: number;
  on_hand: number | null;
  on_hand_unit: string;
  stockout: boolean | null;
  loss_qty: number;
  trend: 'up' | 'flat' | 'down' | 'new';
};

// ---------- main ----------
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization');
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const SUPABASE_URL = (process.env.UNDERSTORY_SUPABASE_URL ?? '').replace(/\/+$/, '');
  const SUPA_KEY = process.env.UNDERSTORY_SUPABASE_SERVICE_ROLE_KEY ?? '';
  const RESEND_KEY = process.env.RESEND_API_KEY ?? '';
  const INV_CRON_SECRET = process.env.THRIVE_PIPELINE_CRON_SECRET ?? '';

  const missing: string[] = [];
  if (!SUPABASE_URL) missing.push('UNDERSTORY_SUPABASE_URL');
  if (!SUPA_KEY) missing.push('UNDERSTORY_SUPABASE_SERVICE_ROLE_KEY');
  if (!RESEND_KEY) missing.push('RESEND_API_KEY');
  if (missing.length) {
    return NextResponse.json({ error: 'missing_env', missing }, { status: 500 });
  }

  const url = new URL(req.url);
  const isTest = url.searchParams.get('test') === '1';
  const dateOverride = url.searchParams.get('date');

  // ----- date math (ET = UTC-4 summer / -5 winter; matches produce-report convention) -----
  const now_utc = new Date();
  const ny_now = new Date(now_utc.getTime() - 4 * 3600 * 1000);
  const yday_dt = dateOverride
    ? new Date(`${dateOverride}T12:00:00Z`)
    : new Date(ny_now.getTime() - 24 * 3600 * 1000);
  const Y = yday_dt.getUTCFullYear();
  const M = yday_dt.getUTCMonth() + 1;
  const D = yday_dt.getUTCDate();
  const report_date = `${Y}-${String(M).padStart(2, '0')}-${String(D).padStart(2, '0')}`;
  const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const weekday_label = `${WEEKDAY_NAMES[yday_dt.getUTCDay()]}, ${MONTH_NAMES[yday_dt.getUTCMonth()]} ${D}, ${Y}`;
  console.log(`[ferris-ridge] report_date=${report_date} (${weekday_label}) test=${isTest}`);

  // 7-day window and same-DOW-last-week for trend
  const prev_week_dt = new Date(yday_dt.getTime() - 7 * 24 * 3600 * 1000);
  const PY = prev_week_dt.getUTCFullYear();
  const PM = prev_week_dt.getUTCMonth() + 1;
  const PD = prev_week_dt.getUTCDate();
  const prev_week_date = `${PY}-${String(PM).padStart(2, '0')}-${String(PD).padStart(2, '0')}`;
  const window_start_dt = new Date(yday_dt.getTime() - 6 * 24 * 3600 * 1000);
  const WSY = window_start_dt.getUTCFullYear();
  const WSM = window_start_dt.getUTCMonth() + 1;
  const WSD = window_start_dt.getUTCDate();
  const window_start = `${WSY}-${String(WSM).padStart(2, '0')}-${String(WSD).padStart(2, '0')}`;

  // ---------- Supabase REST ----------
  async function supa_get(path: string, params: Record<string, string>, retries = 3): Promise<unknown[]> {
    const qs = '?' + new URLSearchParams(params).toString();
    const u = `${SUPABASE_URL}/rest/v1/${path}${qs}`;
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const r = await fetch(u, {
          headers: {
            apikey: SUPA_KEY,
            Authorization: `Bearer ${SUPA_KEY}`,
            Accept: 'application/json',
          },
        });
        if (!r.ok) {
          if ([500, 502, 503, 504].includes(r.status) && attempt < retries - 1) {
            await new Promise(res => setTimeout(res, 1000 * (1 + attempt)));
            continue;
          }
          const body = await r.text();
          throw new Error(`Supabase ${r.status} on ${path}: ${body.slice(0, 500)}`);
        }
        return (await r.json()) as unknown[];
      } catch (e) {
        if (attempt < retries - 1) {
          await new Promise(res => setTimeout(res, 1000 * (1 + attempt)));
          continue;
        }
        throw e;
      }
    }
    return [];
  }

  // ----- best-effort inventory sync nudge (non-blocking on failure) -----
  if (INV_CRON_SECRET) {
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 30_000);
      const r = await fetch(INV_SYNC_URL, {
        headers: { Authorization: `Bearer ${INV_CRON_SECRET}` },
        signal: ctrl.signal,
      });
      clearTimeout(to);
      const j = (await r.json().catch(() => ({}))) as { pulled?: number; inserted?: number };
      console.log(`[ferris-ridge] inv sync: pulled=${j.pulled} inserted=${j.inserted}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`[ferris-ridge] inv sync skipped: ${msg}`);
    }
  }

  // ----- 1) SKU portfolio (all active Ferris Ridge variants) -----
  const catalog = (await supa_get('thrive_product_catalog', {
    primary_vendor_id: `eq.${FERRIS_RIDGE_VENDOR_ID}`,
    active: 'eq.true',
    select: 'thrive_variant_id,thrive_item_id,sku,name,price_cents,active,raw',
    limit: '500',
  })) as Variant[];

  if (catalog.length === 0) {
    console.log('[ferris-ridge] no active SKUs found — nothing to report');
    return NextResponse.json({ ok: true, skipped: 'no_active_skus', report_date });
  }

  const variant_ix = new Map<string, Variant>();
  const item_ids = new Set<string>();
  for (const v of catalog) {
    variant_ix.set(v.thrive_variant_id, v);
    if (v.thrive_item_id) item_ids.add(v.thrive_item_id);
  }
  const vids = Array.from(variant_ix.keys());
  console.log(`[ferris-ridge] catalog: ${catalog.length} variants across ${item_ids.size} parent items`);

  // ----- 2) Sales for report_date + 7-day window + prev-week same-DOW -----
  const sales_window = (await supa_get('thrive_sales_history', {
    variant_id: 'in.(' + vids.join(',') + ')',
    sale_date: `gte.${prev_week_date}`,
    select: 'variant_id,sale_date,item_name,variant_name,units,revenue_cents',
    limit: '5000',
  })) as SaleRow[];
  console.log(`[ferris-ridge] sales rows (window from ${prev_week_date}): ${sales_window.length}`);

  // ----- 3) Inventory (parent item level) -----
  const inv_rows = (await supa_get('thrive_inventory_latest', {
    thrive_item_id: 'in.(' + Array.from(item_ids).join(',') + ')',
    select: 'thrive_item_id,sales_item_id,item_name,qty_on_hand,unit,stockout,snapshot_ts',
    limit: '500',
  })) as InvRow[];
  const inv_by_item = new Map<string, InvRow>();
  for (const r of inv_rows) inv_by_item.set(r.thrive_item_id, r);

  // ----- 4) Loss ledger for report_date — item-name join (aggregated, NOT split by tab) -----
  const loss_rows = (await supa_get('loss_ledger', {
    pulled_date: `eq.${report_date}`,
    select: 'item_name,quantity,total_cents,pulled_date',
    limit: '2000',
  })) as LossRow[];
  const loss_by_name = new Map<string, number>();
  for (const L of loss_rows) {
    const nm = String(L.item_name ?? '').trim().toLowerCase();
    if (!nm) continue;
    loss_by_name.set(nm, (loss_by_name.get(nm) ?? 0) + Number(L.quantity ?? 0));
  }

  // ----- 5) Aggregate per variant -----
  const lines: Line[] = [];
  for (const v of catalog) {
    const parent_name = v.raw?.item?.name?.trim() || v.name;
    const variant_name = v.name && v.name !== parent_name ? v.name : '';
    const display_name = friendlyProductName(parent_name, variant_name);

    let units_yday = 0;
    let rev_yday = 0;
    let units_prev_dow = 0;
    let units_7d_total = 0;
    let days_with_sales = 0;
    const days_seen = new Set<string>();

    for (const s of sales_window) {
      if (s.variant_id !== v.thrive_variant_id) continue;
      const d = s.sale_date.slice(0, 10);
      const u = Number(s.units ?? 0);
      const c = Math.trunc(Number(s.revenue_cents ?? 0));
      if (d === report_date) {
        units_yday += u;
        rev_yday += c;
      }
      if (d === prev_week_date) units_prev_dow += u;
      if (d >= window_start && d <= report_date) {
        units_7d_total += u;
        if (!days_seen.has(d)) {
          days_seen.add(d);
          days_with_sales += 1;
        }
      }
    }
    const units_7d_avg = units_7d_total / 7.0;

    // trend arrow: compare yday vs same-DOW-last-week; if that's zero, use 7-day avg
    let trend: 'up' | 'flat' | 'down' | 'new' = 'flat';
    const compare_to = units_prev_dow > 0 ? units_prev_dow : units_7d_avg;
    if (compare_to === 0 && units_yday === 0) {
      trend = 'flat';
    } else if (compare_to === 0 && units_yday > 0) {
      trend = 'up';
    } else if (units_yday > compare_to * 1.15) {
      trend = 'up';
    } else if (units_yday < compare_to * 0.85) {
      trend = 'down';
    } else {
      trend = 'flat';
    }
    if (days_with_sales === 0 && units_yday === 0) trend = 'flat';

    // inventory (parent-item level)
    const inv = v.thrive_item_id ? inv_by_item.get(v.thrive_item_id) : undefined;
    const on_hand = inv && inv.qty_on_hand !== null && inv.qty_on_hand !== undefined
      ? Number(inv.qty_on_hand)
      : null;

    // loss lookup by parent name AND variant display name
    const loss_qty_parent = loss_by_name.get(parent_name.toLowerCase()) ?? 0;
    const loss_qty_display = loss_by_name.get(display_name.toLowerCase()) ?? 0;
    const loss_qty = Math.max(loss_qty_parent, loss_qty_display);

    lines.push({
      variant_id: v.thrive_variant_id,
      item_id: v.thrive_item_id,
      parent_name,
      variant_name,
      display_name,
      price_cents: v.price_cents ?? 0,
      units_sold_yday: units_yday,
      revenue_cents_yday: rev_yday,
      units_prev_week_same_dow: units_prev_dow,
      units_last_7d_avg: units_7d_avg,
      on_hand,
      on_hand_unit: (inv?.unit ?? '') || '',
      stockout: inv?.stockout ?? null,
      loss_qty,
      trend,
    });
  }

  // Sort: yesterday's movers first, then items with stock, then rest
  lines.sort((a, b) => {
    if (b.units_sold_yday !== a.units_sold_yday) return b.units_sold_yday - a.units_sold_yday;
    if (b.revenue_cents_yday !== a.revenue_cents_yday) return b.revenue_cents_yday - a.revenue_cents_yday;
    return a.display_name.localeCompare(b.display_name);
  });

  // ----- 6) Summary numbers -----
  const total_units = lines.reduce((s, l) => s + l.units_sold_yday, 0);
  const total_revenue = lines.reduce((s, l) => s + l.revenue_cents_yday, 0);
  const products_moved = lines.filter(l => l.units_sold_yday > 0).length;
  const total_loss_qty = lines.reduce((s, l) => s + l.loss_qty, 0);

  // Highlights
  const top_mover = lines.find(l => l.units_sold_yday > 0) ?? null;
  const sold_out = lines.filter(
    l => l.on_hand !== null && l.on_hand <= 0 && l.units_sold_yday > 0
  );
  const notable_up = lines.filter(
    l =>
      l.trend === 'up' &&
      l.units_sold_yday >= 2 &&
      l.units_sold_yday > (l.units_prev_week_same_dow || l.units_last_7d_avg) * 1.5
  );

  // ----- 7) HTML build (farmer-facing, warm tone, no cost/margin) -----
  const dateHuman = `${MONTH_NAMES[yday_dt.getUTCMonth()]} ${D}, ${Y}`;

  function trendArrow(t: 'up' | 'flat' | 'down' | 'new'): string {
    if (t === 'up') return '<span style="color:#0a7;font-weight:600" title="trending up vs last week">▲</span>';
    if (t === 'down') return '<span style="color:#a55;font-weight:600" title="down vs last week">▼</span>';
    return '<span style="color:#999" title="steady">→</span>';
  }

  function ohCell(l: Line): string {
    if (l.on_hand === null) return '<span style="color:#999">—</span>';
    const s = fmtQty(l.on_hand);
    const unit = l.on_hand_unit || 'ea';
    if (l.on_hand <= 0) {
      return `<b style="color:#a55">${esc(s)}</b> <span style="color:#999">${esc(unit)}</span>`;
    }
    return `${esc(s)} <span style="color:#999">${esc(unit)}</span>`;
  }

  const rowHtml = lines.map(l => {
    const bgAttr = l.units_sold_yday > 0 ? ' bgcolor="#fbfaf6"' : '';
    const soldCell = l.units_sold_yday > 0
      ? `<b>${esc(fmtQty(l.units_sold_yday))}</b>`
      : '<span style="color:#999">0</span>';
    const priceCell = l.price_cents > 0 ? usd(l.price_cents) : '<span style="color:#999">—</span>';
    return `<tr${bgAttr}>
      <td align="left" style="padding:8px 10px;border-bottom:1px solid #eee">${esc(l.display_name)}</td>
      <td align="right" style="padding:8px 10px;border-bottom:1px solid #eee">${soldCell}</td>
      <td align="right" style="padding:8px 10px;border-bottom:1px solid #eee">${priceCell}</td>
      <td align="right" style="padding:8px 10px;border-bottom:1px solid #eee">${ohCell(l)}</td>
      <td align="center" style="padding:8px 10px;border-bottom:1px solid #eee">${trendArrow(l.trend)}</td>
    </tr>`;
  }).join('');

  // Summary line
  const summaryLine = total_units > 0
    ? `Total moved: <b>${fmtQty(total_units)}</b> units across <b>${products_moved}</b> ${products_moved === 1 ? 'product' : 'products'}, <b>${usd(total_revenue)}</b> at the register.`
    : `No Ferris Ridge items rang up on ${dateHuman} — the shelf holds ${lines.filter(l => (l.on_hand ?? 0) > 0).length} of your products.`;

  // Highlights block
  const highlightBits: string[] = [];
  if (top_mover) {
    highlightBits.push(
      `<b>Top mover:</b> ${esc(top_mover.display_name)} — ${fmtQty(top_mover.units_sold_yday)} sold${
        top_mover.revenue_cents_yday > 0 ? ` (${usd(top_mover.revenue_cents_yday)})` : ''
      }.`
    );
  }
  if (sold_out.length > 0) {
    const names = sold_out.map(l => esc(l.display_name)).join(', ');
    highlightBits.push(`<b>Sold out on the shelf:</b> ${names}.`);
  }
  if (notable_up.length > 0) {
    const names = notable_up
      .filter(l => l !== top_mover)
      .slice(0, 3)
      .map(l => esc(l.display_name))
      .join(', ');
    if (names) highlightBits.push(`<b>Moving especially well vs last week:</b> ${names}.`);
  }
  if (total_loss_qty > 0) {
    const s = fmtQty(total_loss_qty);
    highlightBits.push(`${s} ${total_loss_qty === 1 ? 'unit was' : 'units were'} marked down for quick sale.`);
  }

  const highlightsHtml = highlightBits.length
    ? `<div style="margin-top:18px;padding:14px 18px;background:#f4f7f0;border-left:3px solid #6a9a4a;border-radius:2px;line-height:1.55">
         ${highlightBits.map(b => `<div style="margin:4px 0">${b}</div>`).join('')}
       </div>`
    : '';

  // Preamble for test send
  const testPreamble = isTest
    ? `<div style="margin-bottom:20px;padding:14px 18px;background:#fff4d6;border-left:3px solid #d4a017;border-radius:2px;font-size:13px;color:#5a4a10">
         <b>Internal test — not yet sent to David.</b><br>
         This is what David Ferris will receive starting tomorrow morning. Reply with any changes to the format before we go live.
       </div>`
    : '';

  const html = `<html><body style="margin:0;padding:0;background:#fafafa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,Helvetica,sans-serif;color:#222">
<div style="max-width:640px;margin:0 auto;padding:24px 20px;background:#ffffff">
${testPreamble}
<div style="border-bottom:2px solid #e8e2d2;padding-bottom:14px;margin-bottom:18px">
  <div style="font-size:22px;font-weight:600;color:#3a5a2a;line-height:1.25">Ferris Ridge Farm</div>
  <div style="font-size:14px;color:#666;margin-top:4px">Sales at Nature's Storehouse — ${esc(dateHuman)}</div>
</div>

<div style="font-size:15px;line-height:1.55;margin-bottom:8px">
  ${summaryLine}
</div>

${highlightsHtml}

<table cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;margin-top:22px;font-size:14px">
  <thead>
    <tr>
      <th align="left"   style="padding:8px 10px;background:#f6f4ee;border-bottom:2px solid #d8d2c2;font-weight:600;font-size:13px;color:#555">Product</th>
      <th align="right"  style="padding:8px 10px;background:#f6f4ee;border-bottom:2px solid #d8d2c2;font-weight:600;font-size:13px;color:#555">Sold</th>
      <th align="right"  style="padding:8px 10px;background:#f6f4ee;border-bottom:2px solid #d8d2c2;font-weight:600;font-size:13px;color:#555">Price</th>
      <th align="right"  style="padding:8px 10px;background:#f6f4ee;border-bottom:2px solid #d8d2c2;font-weight:600;font-size:13px;color:#555">On shelf</th>
      <th align="center" style="padding:8px 10px;background:#f6f4ee;border-bottom:2px solid #d8d2c2;font-weight:600;font-size:13px;color:#555">7‑day</th>
    </tr>
  </thead>
  <tbody>
    ${rowHtml}
  </tbody>
</table>

<div style="margin-top:26px;font-size:13px;color:#666;line-height:1.6">
  Thanks for growing what you grow, David — we appreciate having Ferris Ridge on our shelves. Reply to this email or give the store a ring if anything looks off, or if you want us to change what's on this report.
</div>

<div style="margin-top:22px;padding-top:14px;border-top:1px solid #eee;font-size:11px;color:#999;line-height:1.5">
  Sent by Nature's Storehouse · 21 Main St · Numbers reflect POS sales through end-of-day ${esc(dateHuman)}. On-shelf counts are live at send-time. Trend compares yesterday's units to the same weekday last week.
</div>
</div>
</body></html>`;

  // Plain-text version
  const textLines: string[] = [];
  if (isTest) {
    textLines.push('INTERNAL TEST — not yet sent to David.');
    textLines.push('This is what David Ferris will receive starting tomorrow morning.');
    textLines.push('Reply with any changes to the format before we go live.');
    textLines.push('');
  }
  textLines.push(`FERRIS RIDGE FARM — Sales at Nature's Storehouse`);
  textLines.push(`${dateHuman}`);
  textLines.push('');
  textLines.push(total_units > 0
    ? `Total moved: ${fmtQty(total_units)} units across ${products_moved} ${products_moved === 1 ? 'product' : 'products'}, ${usd(total_revenue)} at the register.`
    : `No Ferris Ridge items rang up on ${dateHuman}.`);
  textLines.push('');
  for (const b of highlightBits) {
    textLines.push(`• ${b.replace(/<[^>]+>/g, '')}`);
  }
  if (highlightBits.length) textLines.push('');
  textLines.push('Product'.padEnd(40) + 'Sold'.padStart(6) + 'Price'.padStart(10) + 'Shelf'.padStart(10) + '  7d');
  textLines.push('-'.repeat(70));
  for (const l of lines) {
    const nm = l.display_name.length > 38 ? l.display_name.slice(0, 37) + '…' : l.display_name;
    const sold = l.units_sold_yday > 0 ? fmtQty(l.units_sold_yday) : '0';
    const price = l.price_cents > 0 ? usd(l.price_cents) : '—';
    const shelf = l.on_hand === null ? '—' : `${fmtQty(l.on_hand)} ${l.on_hand_unit || 'ea'}`.trim();
    const arrow = l.trend === 'up' ? '↑' : l.trend === 'down' ? '↓' : '→';
    textLines.push(nm.padEnd(40) + sold.padStart(6) + price.padStart(10) + shelf.padStart(10) + '  ' + arrow);
  }
  textLines.push('');
  textLines.push(`Thanks for growing what you grow, David.`);
  textLines.push(`Reply to this email or ring the store if anything looks off.`);
  const text = textLines.join('\n');

  const subject = isTest
    ? `Ferris Ridge daily — TEST for review before David gets it`
    : `Ferris Ridge — Sales at Nature's Storehouse (${MONTH_NAMES[yday_dt.getUTCMonth()].slice(0, 3)} ${D})`;

  const recipients = isTest ? TEST_RECIPIENTS : LIVE_RECIPIENTS;
  const payload: Record<string, unknown> = {
    from: FROM_ADDR,
    to: recipients.to,
    subject,
    html,
    text,
  };
  if (recipients.cc && recipients.cc.length) payload.cc = recipients.cc;
  if (!isTest) payload.reply_to = 'clark@natures-storehouse.com';

  console.log(`[ferris-ridge] sending → to=${recipients.to.join(',')} cc=${recipients.cc.join(',') || '(none)'}`);
  const sendResp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_KEY}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': 'natures-storehouse-ferris-ridge-report/1.0',
    },
    body: JSON.stringify(payload),
  });
  if (!sendResp.ok) {
    const errText = await sendResp.text();
    console.log(`[ferris-ridge] resend error ${sendResp.status}: ${errText.slice(0, 500)}`);
    return NextResponse.json(
      { error: 'resend_failed', status: sendResp.status, body: errText.slice(0, 1000) },
      { status: 500 }
    );
  }
  const send_result = (await sendResp.json()) as { id?: string };
  console.log(`[ferris-ridge] resend id=${send_result.id}`);

  return NextResponse.json({
    ok: true,
    resend_email_id: send_result.id,
    report_date,
    is_test: isTest,
    from: FROM_ADDR,
    to: recipients.to,
    cc: recipients.cc,
    subject,
    catalog_variants: catalog.length,
    parent_items: item_ids.size,
    total_units_sold: total_units,
    total_revenue_cents: total_revenue,
    products_moved,
    top_mover: top_mover
      ? {
          name: top_mover.display_name,
          units: top_mover.units_sold_yday,
          revenue_cents: top_mover.revenue_cents_yday,
        }
      : null,
    sold_out_count: sold_out.length,
    loss_units: total_loss_qty,
  });
}

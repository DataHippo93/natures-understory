/**
 * Daily Produce Sales Report - v7
 *
 * v7 additions on top of v6:
 *   1. Preflight gates G1..G9 (computed before email build)
 *   2. Data-health strip (small colored badges under headline)
 *   3. Profit-first headline (big yesterday profit number + Do today list)
 *   4. Actionable-only SKU table (with ACTION pills)
 *   5. Count Drift and Spoilage panels below actionable table
 *   6. 7-day sparklines (unicode block chars) for revenue + contribution
 *   7. Full audit CSV linked (if hosted) or attached (fallback)
 *   8. Preview mode via ?preview=1&to=<yc-email> (no CC, [v7 PREVIEW] prefix)
 *   9. Date override via ?date=YYYY-MM-DD (for backfill / preview)
 *
 * Preserved from v6:
 *   - sold_qty = max(0, qty - loss_qty) so ring-then-loss doesn't double-count
 *   - COGS recompute from thrive_product_catalog.default_cost_cents
 *   - Clover Discount 8 re-attribution to full retail
 *   - Parent . Variant name display
 *   - Variant-level inventory (fallback to item-level)
 *
 * Cron: driven by vercel.json.
 * Auth: Bearer ${CRON_SECRET}. Preview bypass: ?preview=1&to=@ycconsulting.biz.
 *
 * Env required:
 *   UNDERSTORY_SUPABASE_URL
 *   UNDERSTORY_SUPABASE_SERVICE_ROLE_KEY
 *   RESEND_API_KEY
 *   NATURES_STOREHOUSE_TOKEN
 *   NATURES_STOREHOUSE_MID
 *   THRIVE_PIPELINE_CRON_SECRET     (triggers live inventory sync at cron start)
 *   CRON_SECRET                     (gates this route)
 */

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const FROM_ADDR = "Nature's Storehouse Reports <no-reply@ycconsulting.biz>";

// Recipient list - single source of truth (cron / non-preview mode).
const RECIPIENTS = {
  to: ['cmaine@ycconsulting.biz'],
  cc: ['danielzmartin2024@gmail.com'],
};
const OWNER_DISCOUNT_NAME = 'Discount 8';
const INV_SYNC_URL = 'https://thrive-pipeline.vercel.app/api/cron/inventory';

// CSV hosting probe (v7): if the report is mirrored to public /reports/produce/YYYY-MM-DD.csv
// we link to it; otherwise we attach inline.
const CSV_MIRROR_BASE = 'https://natures-understory.vercel.app/reports/produce';
const STOCKTAKE_ROUTE = 'https://natures-understory.vercel.app/stocktake?priority=produce';
const OPS_INBOX = 'cmaine@ycconsulting.biz';

function usd(c: number): string {
  return `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function esc(s: unknown): string {
  if (s === null || s === undefined) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function csvEsc(s: unknown): string {
  if (s === null || s === undefined) return '';
  const str = String(s);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function fmtPctSigned(x: number): string {
  return `${x >= 0 ? '+' : ''}${x.toFixed(1)}%`;
}

// v7.1: SVG sparkline (replaces unicode block chars for reliable email rendering).
function svgSpark(values: number[], color: string): string {
  if (values.length === 0) return '';
  const w = 60, h = 16;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const step = values.length > 1 ? w / (values.length - 1) : w;
  const pts = values.map((v, i) => `${(i * step).toFixed(2)},${(h - ((v - min) / range) * h).toFixed(2)}`).join(' ');
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg"><polyline fill="none" stroke="${color}" stroke-width="1.5" points="${pts}"/></svg>`;
}

// v7: gate types
type GateColor = 'green' | 'yellow' | 'red';
type GateOutcome = 'send' | 'send_yellow' | 'hold';
type GateResult = {
  id: string;
  label: string;
  color: GateColor;
  outcome: GateOutcome;
  detail: string;
};

type Variant = {
  thrive_variant_id: string;
  thrive_item_id: string;
  sku: string;
  name: string;
  department: string | null;
  category_path: string | null;
  default_cost_cents: number | null;
  price_cents: number | null;
};

type SaleRow = {
  variant_id: string;
  item_name: string | null;
  variant_name: string | null;
  sku: string | null;
  barcode: string | null;
  units: number | string | null;
  gross_units: number | string | null;
  revenue_cents: number | string | null;
  gross_revenue_cents: number | string | null;
  cost_cents: number | string | null;
  profit_cents: number | string | null;
  sale_date?: string | null;
};

type LossRow = {
  upc: string | null;
  item_name: string | null;
  brand_produce: unknown;
  quantity: number | string | null;
  total_cents: number | string | null;
};

type InvRow = {
  thrive_item_id: string;
  sales_item_id: string;
  qty_on_hand: number | string | null;
  unit: string | null;
  stockout: boolean | null;
  snapshot_ts: string | null;
};

type Agg = {
  variant_id: string;
  sku: string;
  name: string;
  variant: string;
  barcode: string;
  thrive_item_id: string | null | undefined;
  cat_price_cents: number;
  cat_cost_cents: number;
  qty: number;
  gross_units: number;
  revenue_cents_ingested: number;
  cost_cents_ingested: number;
  loss_qty: number;
  loss_cents: number;
  on_hand_source: 'variant' | 'item' | 'none';
  on_hand: number | null;
  on_hand_unit: string;
  stockout: boolean | null;
  cost_cents_recomputed: number;
  cost_delta_cents: number;
  owner_consumption: boolean;
  revenue_cents: number;
  revenue_source: 'reattributed_retail' | 'ingested';
  cost_cents: number;
  net_qty: number;
  net_revenue_cents: number;
  contribution_cents: number;
  contribution_pct: number;
  is_spoilage: boolean;
  cost_outlier: boolean;
  // v7 action flags
  needs_count: boolean;
  needs_investigate: boolean;
  needs_catalog_fix: boolean;
  needs_reprice: boolean;
};

// v7: action pill definition for the actionable table.
type ActionPill = { label: string; color: string; severity: number };
function actionsForRow(a: Agg): ActionPill[] {
  const out: ActionPill[] = [];
  if (a.contribution_cents < 0 && a.qty > 0) {
    out.push({ label: 'Investigate', color: '#a00', severity: 100 });
    a.needs_investigate = true;
  }
  if (a.on_hand !== null && a.on_hand < 0) {
    out.push({ label: 'Count', color: '#c60', severity: 80 });
    a.needs_count = true;
  }
  if (!a.cat_cost_cents) {
    out.push({ label: 'Fix catalog', color: '#c60', severity: 70 });
    a.needs_catalog_fix = true;
  }
  if (a.qty > 0 && a.net_revenue_cents > 0) {
    const margin_pct = a.net_revenue_cents ? (a.contribution_cents / a.net_revenue_cents) * 100 : 0;
    if (margin_pct >= 0 && margin_pct < 15) {
      out.push({ label: 'Reprice', color: '#c60', severity: 50 });
      a.needs_reprice = true;
    }
  }
  if (a.revenue_cents === 0 && a.qty > 0 && a.loss_qty > 0) {
    out.push({ label: 'Watch', color: '#666', severity: 20 });
  }
  return out;
}

// v7: badge HTML for the data-health strip.
function badgeHtml(g: GateResult): string {
  const bg = g.color === 'green' ? '#eaf7ea' : g.color === 'yellow' ? '#fffbe5' : '#fff5f5';
  const dot = g.color === 'green' ? '#0a7' : g.color === 'yellow' ? '#c60' : '#a00';
  return (
    `<td valign="middle" style="padding:0 6px 6px 0">` +
    `<span title="${esc(g.detail)}" style="display:inline-block;background:${bg};border:1px solid #ddd;border-radius:12px;padding:3px 9px;font-size:11px;color:#333;line-height:14px;white-space:nowrap">` +
    `<span style="display:inline-block;width:8px;height:8px;border-radius:4px;background:${dot};margin-right:5px;vertical-align:middle"></span>` +
    `${esc(g.id)} ${esc(g.label)}</span></td>`
  );
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const isPreview = url.searchParams.get('preview') === '1';
  const toOverride = url.searchParams.get('to');
  const dateOverride = url.searchParams.get('date');

  // ----- auth gate -----
  const auth = req.headers.get('authorization');
  if (!isPreview) {
    if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  } else {
    // Preview mode: require ?to= and restrict to @ycconsulting.biz for safety.
    if (!toOverride || !/@ycconsulting\.biz$/i.test(toOverride.trim())) {
      return NextResponse.json(
        { error: 'preview_requires_ycc_email', hint: 'add ?to=<name>@ycconsulting.biz' },
        { status: 400 }
      );
    }
  }

  const SUPABASE_URL = (process.env.UNDERSTORY_SUPABASE_URL ?? '').replace(/\/+$/, '');
  const SUPA_KEY = process.env.UNDERSTORY_SUPABASE_SERVICE_ROLE_KEY ?? '';
  const RESEND_KEY = process.env.RESEND_API_KEY ?? '';
  const CLOVER_TOK = process.env.NATURES_STOREHOUSE_TOKEN ?? '';
  const CLOVER_MID = process.env.NATURES_STOREHOUSE_MID ?? '';
  const INV_CRON_SECRET = process.env.THRIVE_PIPELINE_CRON_SECRET ?? '';

  // v7 G7 = RESEND_API_KEY presence. Hard fail if missing.
  if (!RESEND_KEY) {
    console.log('[!] G7 HARD FAIL: RESEND_API_KEY missing. Not sending.');
    return NextResponse.json({ error: 'resend_not_configured' }, { status: 500 });
  }

  const missing: string[] = [];
  if (!SUPABASE_URL) missing.push('UNDERSTORY_SUPABASE_URL');
  if (!SUPA_KEY) missing.push('UNDERSTORY_SUPABASE_SERVICE_ROLE_KEY');
  if (missing.length) {
    return NextResponse.json({ error: 'missing_env', missing }, { status: 500 });
  }

  // v7: G4 flag - if Clover creds missing, mark YELLOW rather than fail.
  const cloverConfigured = !!(CLOVER_TOK && CLOVER_MID);
  const invSyncConfigured = !!INV_CRON_SECRET;

  // ----- date math -----
  let Y: number, M: number, D: number, yday_dt: Date;
  if (dateOverride && /^\d{4}-\d{2}-\d{2}$/.test(dateOverride)) {
    const [ys, ms, ds] = dateOverride.split('-').map(Number);
    yday_dt = new Date(Date.UTC(ys, ms - 1, ds));
    Y = ys; M = ms; D = ds;
  } else {
    const now_utc = new Date();
    const ny_now = new Date(now_utc.getTime() - 4 * 3600 * 1000);
    yday_dt = new Date(ny_now.getTime() - 24 * 3600 * 1000);
    Y = yday_dt.getUTCFullYear();
    M = yday_dt.getUTCMonth() + 1;
    D = yday_dt.getUTCDate();
  }
  const yesterday = `${Y}-${String(M).padStart(2, '0')}-${String(D).padStart(2, '0')}`;
  const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const weekday_label = `${WEEKDAY_NAMES[yday_dt.getUTCDay()]}, ${MONTH_NAMES[yday_dt.getUTCMonth()]} ${D}, ${Y}`;
  const date_us = `${M}/${D}/${Y}`;
  console.log(`[+] v7 Report date: ${yesterday} (${weekday_label}) preview=${isPreview}`);

  // 7-day baseline range (yesterday-6 .. yesterday)
  const baselineFrom = new Date(yday_dt.getTime() - 6 * 86400 * 1000);
  const bY = baselineFrom.getUTCFullYear();
  const bM = baselineFrom.getUTCMonth() + 1;
  const bD = baselineFrom.getUTCDate();
  const baselineStartStr = `${bY}-${String(bM).padStart(2, '0')}-${String(bD).padStart(2, '0')}`;

  // ===== STEP 0: Trigger LIVE inventory sync (best-effort) =====
  const t0 = Date.now();
  let syncResp: { pulled?: number; inserted?: number } = {};
  let sync_dur = 0;
  if (invSyncConfigured) {
    console.log(`[+] Triggering inventory sync: ${INV_SYNC_URL}`);
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 180_000);
      const r = await fetch(INV_SYNC_URL, {
        headers: { Authorization: `Bearer ${INV_CRON_SECRET}` },
        signal: ctrl.signal,
      });
      clearTimeout(to);
      syncResp = (await r.json()) as { pulled?: number; inserted?: number };
      sync_dur = (Date.now() - t0) / 1000;
      console.log(`[+] Inventory sync OK in ${sync_dur.toFixed(1)}s: pulled=${syncResp.pulled} inserted=${syncResp.inserted}`);
    } catch (e) {
      sync_dur = (Date.now() - t0) / 1000;
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`[!] Inventory sync failed after ${sync_dur.toFixed(1)}s: ${msg}. Continuing with cached snapshot.`);
      syncResp = {};
    }
  } else {
    console.log('[!] THRIVE_PIPELINE_CRON_SECRET missing - skipping inventory sync.');
  }

  // ---------- Supabase REST ----------
  async function supa_get(path: string, params: Record<string, string>, retries = 3): Promise<unknown[]> {
    const qs = '?' + new URLSearchParams(params).toString();
    const supaUrl = `${SUPABASE_URL}/rest/v1/${path}${qs}`;
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const r = await fetch(supaUrl, {
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

  // ===== v7: PREFLIGHT GATES =====
  const gates: GateResult[] = [];
  function pushGate(g: GateResult) {
    gates.push(g);
    console.log(`[gate] ${g.id} ${g.color.toUpperCase()} - ${g.label}: ${g.detail}`);
  }

  // G8 date-sanity
  const today_utc = new Date();
  if (yday_dt.getTime() > today_utc.getTime()) {
    pushGate({ id: 'G8', label: 'date-sanity', color: 'red', outcome: 'hold', detail: `reportDate ${yesterday} is in the future` });
  } else {
    pushGate({ id: 'G8', label: 'date-sanity', color: 'green', outcome: 'send', detail: `reportDate ${yesterday} <= today` });
  }

  // G1 sales-data-present
  let g1_count = 0;
  try {
    const g1res = (await supa_get('thrive_sales_history', {
      sale_date: `eq.${yesterday}`,
      select: 'variant_id',
      limit: '1',
    })) as SaleRow[];
    if (g1res.length > 0) {
      // count more accurately with head-request-style probe
      const g1count = (await supa_get('thrive_sales_history', {
        sale_date: `eq.${yesterday}`,
        select: 'variant_id',
        limit: '10000',
      })) as SaleRow[];
      g1_count = g1count.length;
    }
    if (g1_count > 0) {
      pushGate({ id: 'G1', label: 'sales-data', color: 'green', outcome: 'send', detail: `${g1_count} sales rows` });
    } else {
      pushGate({ id: 'G1', label: 'sales-data', color: 'red', outcome: 'hold', detail: 'no sales rows for date' });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    pushGate({ id: 'G1', label: 'sales-data', color: 'red', outcome: 'hold', detail: `query failed: ${msg.slice(0, 120)}` });
  }

  // G2 inventory-freshness
  let inv_stale = false;
  let inv_max_snap: string | null = null;
  try {
    const g2res = (await supa_get('thrive_inventory_latest', {
      select: 'snapshot_ts',
      order: 'snapshot_ts.desc',
      limit: '1',
    })) as { snapshot_ts: string }[];
    if (g2res.length > 0) {
      inv_max_snap = g2res[0].snapshot_ts;
      const snap_ms = new Date(inv_max_snap).getTime();
      const age_h = (Date.now() - snap_ms) / 3600000;
      if (age_h <= 6) {
        pushGate({ id: 'G2', label: 'inv-fresh', color: 'green', outcome: 'send', detail: `snapshot ${age_h.toFixed(1)}h old` });
      } else {
        inv_stale = true;
        pushGate({ id: 'G2', label: 'inv-fresh', color: 'yellow', outcome: 'send_yellow', detail: `snapshot ${age_h.toFixed(1)}h old (>6h)` });
      }
    } else {
      inv_stale = true;
      pushGate({ id: 'G2', label: 'inv-fresh', color: 'yellow', outcome: 'send_yellow', detail: 'no inventory rows' });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    inv_stale = true;
    pushGate({ id: 'G2', label: 'inv-fresh', color: 'yellow', outcome: 'send_yellow', detail: `query failed: ${msg.slice(0, 120)}` });
  }

  // G4 clover-discount8 (probe order endpoint)
  if (cloverConfigured) {
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 15_000);
      const r = await fetch(`https://api.clover.com/v3/merchants/${CLOVER_MID}/orders?limit=1`, {
        method: 'HEAD',
        headers: { Authorization: `Bearer ${CLOVER_TOK}` },
        signal: ctrl.signal,
      });
      clearTimeout(to);
      if (r.ok || r.status === 405) {
        // Clover may reject HEAD with 405 but that still means auth is fine.
        pushGate({ id: 'G4', label: 'clover', color: 'green', outcome: 'send', detail: `HEAD ${r.status}` });
      } else {
        pushGate({ id: 'G4', label: 'clover', color: 'yellow', outcome: 'send_yellow', detail: `HEAD ${r.status} - Discount 8 may not be counted` });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      pushGate({ id: 'G4', label: 'clover', color: 'yellow', outcome: 'send_yellow', detail: `probe failed: ${msg.slice(0, 80)}` });
    }
  } else {
    pushGate({ id: 'G4', label: 'clover', color: 'yellow', outcome: 'send_yellow', detail: 'Clover creds missing - Discount 8 not counted' });
  }

  // G5 loss-ledger reachable
  try {
    const g5res = (await supa_get('loss_ledger', {
      pulled_date: `eq.${yesterday}`,
      select: 'upc',
      limit: '1',
    })) as unknown[];
    void g5res;
    pushGate({ id: 'G5', label: 'loss-ledger', color: 'green', outcome: 'send', detail: 'reachable' });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    pushGate({ id: 'G5', label: 'loss-ledger', color: 'yellow', outcome: 'send_yellow', detail: `query failed: ${msg.slice(0, 80)}` });
  }

  // G6 baseline-7d (distinct days with sales in last 7)
  let baselineDays = 0;
  let baselineRows7d: SaleRow[] = [];
  try {
    baselineRows7d = (await supa_get('thrive_sales_history', {
      sale_date: `gte.${baselineStartStr}`,
      and: `(sale_date.lte.${yesterday})`,
      select: 'sale_date,revenue_cents,cost_cents',
      limit: '30000',
    })) as SaleRow[];
    const dset = new Set(baselineRows7d.map(r => String(r.sale_date ?? '').slice(0, 10)));
    baselineDays = dset.size;
    if (baselineDays >= 5) {
      pushGate({ id: 'G6', label: 'baseline-7d', color: 'green', outcome: 'send', detail: `${baselineDays} distinct days` });
    } else {
      pushGate({ id: 'G6', label: 'baseline-7d', color: 'yellow', outcome: 'send_yellow', detail: `only ${baselineDays} distinct days - skipping trend arrows` });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    pushGate({ id: 'G6', label: 'baseline-7d', color: 'yellow', outcome: 'send_yellow', detail: `query failed: ${msg.slice(0, 80)}` });
  }

  // G7 resend-config: already checked above (would have hard-failed)
  pushGate({ id: 'G7', label: 'resend-cfg', color: 'green', outcome: 'send', detail: 'RESEND_API_KEY present' });

  // G3 and G9 are computed after catalog + sales are loaded (need column info).
  // Fetch catalog + sales now.
  const produce_variants = (await supa_get('thrive_product_catalog', {
    category_path: 'ilike.*produce*',
    select: 'thrive_variant_id,thrive_item_id,sku,name,department,category_path,default_cost_cents,price_cents',
    limit: '5000',
  })) as Variant[];
  const variant_ix = new Map<string, Variant>();
  for (const v of produce_variants) variant_ix.set(v.thrive_variant_id, v);
  const distinctSkus = new Set(produce_variants.map(v => v.sku));
  const distinctItems = new Set(produce_variants.map(v => v.thrive_item_id));
  console.log(`[+] Catalog: ${variant_ix.size} produce variants (${distinctSkus.size} distinct SKUs, ${distinctItems.size} distinct parent items)`);

  const all_sales: SaleRow[] = [];
  const ids = Array.from(variant_ix.keys());
  for (let i = 0; i < ids.length; i += 60) {
    const slice = ids.slice(i, i + 60);
    const rows = (await supa_get('thrive_sales_history', {
      sale_date: `eq.${yesterday}`,
      variant_id: 'in.(' + slice.join(',') + ')',
      select: 'variant_id,item_name,variant_name,sku,barcode,units,gross_units,revenue_cents,gross_revenue_cents,cost_cents,profit_cents',
      limit: '1000',
    })) as SaleRow[];
    all_sales.push(...rows);
  }
  console.log(`[+] Sales rows: ${all_sales.length}`);

  // G3 cost-coverage: % of yesterday's produce SKUs with default_cost_cents null or 0
  const sold_variants_for_g3 = Array.from(new Set(all_sales.map(s => s.variant_id)));
  let missing_cost_count = 0;
  const missing_cost_variants: string[] = [];
  for (const vid of sold_variants_for_g3) {
    const cat = variant_ix.get(vid);
    if (!cat || cat.default_cost_cents === null || cat.default_cost_cents === 0) {
      missing_cost_count++;
      missing_cost_variants.push(vid);
    }
  }
  const cost_missing_pct = sold_variants_for_g3.length
    ? (missing_cost_count / sold_variants_for_g3.length) * 100
    : 0;
  if (cost_missing_pct < 5) {
    pushGate({ id: 'G3', label: 'cost-cov', color: 'green', outcome: 'send', detail: `${cost_missing_pct.toFixed(1)}% missing cost` });
  } else {
    pushGate({ id: 'G3', label: 'cost-cov', color: 'yellow', outcome: 'send_yellow', detail: `${cost_missing_pct.toFixed(1)}% missing cost - flagged individually` });
  }

  // G9 any-sales: G1 count > 0 AND at least 1 produce SKU sold.
  if (all_sales.length > 0 && sold_variants_for_g3.length > 0) {
    pushGate({ id: 'G9', label: 'any-produce', color: 'green', outcome: 'send', detail: `${sold_variants_for_g3.length} distinct SKUs` });
  } else {
    pushGate({ id: 'G9', label: 'any-produce', color: 'yellow', outcome: 'send_yellow', detail: 'zero produce SKUs sold - verify not a store-closed day' });
  }

  // Determine overall outcome.
  const hasHold = gates.some(g => g.outcome === 'hold');
  const hasYellow = gates.some(g => g.color === 'yellow');
  const overallColor: GateColor = hasHold ? 'red' : hasYellow ? 'yellow' : 'green';

  // ---- HOLD short-circuit: send alert email, do not build report ----
  if (hasHold) {
    const failed = gates.filter(g => g.outcome === 'hold');
    const failedIds = failed.map(g => g.id).join(', ');
    const alertHtml = `<html><head><meta charset="utf-8"></head><body style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#111">
<h2 style="margin:0 0 8px 0;color:#a00">Produce report SKIPPED &mdash; ${esc(date_us)}</h2>
<div style="color:#666;margin-bottom:14px">${esc(weekday_label)}</div>
<p><b>Failed gates:</b> ${esc(failedIds)}</p>
<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;border-color:#ccc">
<thead><tr bgcolor="#f4f4f4"><th>Gate</th><th>Label</th><th>Detail</th></tr></thead>
<tbody>
${gates.map(g => `<tr${g.outcome === 'hold' ? ' bgcolor="#fff5f5"' : ''}><td>${esc(g.id)}</td><td>${esc(g.label)}</td><td>${esc(g.detail)}</td></tr>`).join('')}
</tbody></table>
<p style="color:#666;margin-top:20px;font-size:11px">Report generation was halted by a preflight gate. Investigate the failed gate, then re-run manually via <code>?preview=1&amp;to=${OPS_INBOX}</code>.</p>
</body></html>`;
    const alertText = `PRODUCE REPORT SKIPPED - ${date_us}\n${weekday_label}\n\nFailed gates: ${failedIds}\n\n` +
      gates.map(g => `[${g.id}] ${g.color.toUpperCase()} ${g.label}: ${g.detail}`).join('\n');
    const alertSubject = `${isPreview ? '[v7 PREVIEW] ' : ''}[ALERT] Produce report skipped - ${date_us} (${failedIds})`;
    const alertTo = isPreview && toOverride ? [toOverride] : RECIPIENTS.to;
    const alertCc = isPreview ? undefined : RECIPIENTS.cc;
    const alertPayload: Record<string, unknown> = {
      from: FROM_ADDR,
      to: alertTo,
      subject: alertSubject,
      html: alertHtml,
      text: alertText,
    };
    if (alertCc) alertPayload.cc = alertCc;
    const ar = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_KEY}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(alertPayload),
    });
    const arJson = await ar.json().catch(() => ({}));
    return NextResponse.json({
      ok: false,
      halted: true,
      overall: overallColor,
      failed_gates: failed.map(g => g.id),
      gates,
      alert_email: arJson,
    });
  }

  // ---- Full data path ----

  // 3) Loss ledger
  const loss_rows = (await supa_get('loss_ledger', {
    pulled_date: `eq.${yesterday}`,
    is_produce: 'eq.true',
    select: 'upc,item_name,brand_produce,quantity,total_cents',
    limit: '5000',
  })) as LossRow[];
  console.log(`[+] Loss rows: ${loss_rows.length}`);

  // 4) INVENTORY
  console.log('[+] Fetching inventory (sold variants + tomato spot-check only)...');
  let inv_by_variant: Record<string, InvRow> = {};
  let inv_by_item: Record<string, InvRow> = {};
  const sold_variant_ids = Array.from(new Set(all_sales.map(s => s.variant_id))).sort();
  const spot_check_skus = new Set(['94064', '74064', '84064']);
  const spot_check_vids = Array.from(
    new Set(produce_variants.filter(v => spot_check_skus.has(v.sku)).map(v => v.thrive_variant_id))
  ).sort();
  const all_target_vids = Array.from(new Set([...sold_variant_ids, ...spot_check_vids])).sort();
  console.log(`  scope: ${sold_variant_ids.length} sold + ${spot_check_vids.length} tomato spot-check = ${all_target_vids.length} variants`);

  async function fetch_inv(key: 'sales_item_id' | 'thrive_item_id', vids: string[], label: string): Promise<Record<string, InvRow>> {
    const out: Record<string, InvRow> = {};
    const CHUNK = 8;
    for (let i = 0; i < vids.length; i += CHUNK) {
      const chunk = vids.slice(i, i + CHUNK);
      try {
        const invRows = (await supa_get('thrive_inventory_latest', {
          [key]: 'in.(' + chunk.join(',') + ')',
          select: 'thrive_item_id,sales_item_id,qty_on_hand,unit,stockout,snapshot_ts',
          limit: '1000',
        }, 1)) as InvRow[];
        for (const r of invRows) {
          const kv = (r as unknown as Record<string, string | undefined>)[key];
          if (kv) out[kv] = r;
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.log(`  [!] ${label} chunk @${i} failed: ${msg}`);
      }
    }
    return out;
  }

  inv_by_variant = await fetch_inv('sales_item_id', all_target_vids, 'variant');
  console.log(`  variant-level matches: ${Object.keys(inv_by_variant).length}/${all_target_vids.length}`);
  const missing_vids = all_target_vids.filter(v => !(v in inv_by_variant));
  const missing_iids = Array.from(
    new Set(
      missing_vids
        .map(v => variant_ix.get(v)?.thrive_item_id)
        .filter((x): x is string => !!x)
    )
  ).sort();
  if (missing_iids.length > 0) {
    inv_by_item = await fetch_inv('thrive_item_id', missing_iids, 'item-fallback');
    console.log(`  item-level fallback matches: ${Object.keys(inv_by_item).length}/${missing_iids.length}`);
  }
  console.log(`[+] Inventory: ${Object.keys(inv_by_variant).length} variant rows + ${Object.keys(inv_by_item).length} item rows`);

  // 5) Clover orders -> Discount 8 lines
  const yday_utc_midnight = Date.UTC(Y, M - 1, D, 0, 0, 0);
  const yday_local_midnight_ms = yday_utc_midnight + 4 * 3600 * 1000;
  const start_ms = yday_local_midnight_ms;
  const end_ms = yday_local_midnight_ms + 24 * 3600 * 1000;

  async function clover_get(path: string, params: Array<[string, string]>): Promise<{ elements?: unknown[] }> {
    const usp = new URLSearchParams();
    for (const [k, v] of params) usp.append(k, v);
    const cloverUrl = `https://api.clover.com/v3/merchants/${CLOVER_MID}/${path}?${usp.toString()}`;
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 30_000);
    try {
      const r = await fetch(cloverUrl, {
        headers: {
          Authorization: `Bearer ${CLOVER_TOK}`,
          Accept: 'application/json',
        },
        signal: ctrl.signal,
      });
      if (!r.ok) {
        const body = await r.text();
        throw new Error(`Clover ${r.status}: ${body.slice(0, 500)}`);
      }
      return (await r.json()) as { elements?: unknown[] };
    } finally {
      clearTimeout(to);
    }
  }

  const discount8_lines: { item_name: string; line_price_cents: number }[] = [];
  const clover_disc_summary: Record<string, number> = {};
  let total_orders = 0;
  let offset = 0;
  if (cloverConfigured) {
    try {
      while (true) {
        const params: Array<[string, string]> = [
          ['filter', `createdTime>=${start_ms}`],
          ['filter', `createdTime<=${end_ms}`],
          ['expand', 'lineItems.discounts'],
          ['limit', '200'],
          ['offset', String(offset)],
        ];
        const data = await clover_get('orders', params);
        const orders = (data.elements ?? []) as Array<Record<string, any>>;
        if (orders.length === 0) break;
        total_orders += orders.length;
        for (const o of orders) {
          const lineItems = ((o.lineItems ?? {}) as { elements?: Array<Record<string, any>> }).elements ?? [];
          for (const ln of lineItems) {
            const discounts = ((ln.discounts ?? {}) as { elements?: Array<Record<string, any>> }).elements ?? [];
            for (const d of discounts) {
              const nm = String(d.name ?? '').trim();
              clover_disc_summary[nm] = (clover_disc_summary[nm] ?? 0) + 1;
              if (nm === OWNER_DISCOUNT_NAME) {
                discount8_lines.push({
                  item_name: String(ln.name ?? '').trim(),
                  line_price_cents: Math.trunc(Number(ln.price ?? 0)) || 0,
                });
              }
            }
          }
        }
        if (orders.length < 200) break;
        offset += 200;
      }
      console.log(`[+] Clover orders: ${total_orders}, Discount 8 lines: ${discount8_lines.length}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`[!] Clover fetch failed mid-flight: ${msg}`);
    }
  }
  const owner_name_set = new Set(discount8_lines.map(ln => ln.item_name));
  const owner_name_set_lower = new Set(Array.from(owner_name_set).map(n => n.toLowerCase()));

  // ---------- aggregate sales ----------
  const loss_by_upc: Record<string, { qty: number; cents: number }> = {};
  const loss_by_name: Record<string, { qty: number; cents: number }> = {};
  for (const L of loss_rows) {
    const upc = String(L.upc ?? '').trim();
    const nm = String(L.item_name ?? '').trim().toLowerCase();
    const q = Number(L.quantity ?? 0);
    const c = Math.trunc(Number(L.total_cents ?? 0));
    if (upc) {
      if (!loss_by_upc[upc]) loss_by_upc[upc] = { qty: 0, cents: 0 };
      loss_by_upc[upc].qty += q;
      loss_by_upc[upc].cents += c;
    }
    if (nm) {
      if (!loss_by_name[nm]) loss_by_name[nm] = { qty: 0, cents: 0 };
      loss_by_name[nm].qty += q;
      loss_by_name[nm].cents += c;
    }
  }

  function name_key(item_name: string, variant_name: string): string {
    const i = (item_name ?? '').trim();
    const v = (variant_name ?? '').trim();
    if (v && v.toLowerCase() !== i.toLowerCase()) {
      return (i + ' ' + v).trim();
    }
    return i;
  }

  const agg: Record<string, Agg> = {};
  for (const s of all_sales) {
    const vid = s.variant_id;
    const cat = variant_ix.get(vid);
    if (!agg[vid]) {
      agg[vid] = {
        variant_id: vid,
        sku: (s.sku ?? cat?.sku ?? '') as string,
        name: (s.item_name ?? cat?.name ?? '(unknown)') as string,
        variant: String(s.variant_name ?? '').trim(),
        barcode: String(s.barcode ?? '').trim(),
        thrive_item_id: cat?.thrive_item_id,
        cat_price_cents: cat?.price_cents ?? 0,
        cat_cost_cents: cat?.default_cost_cents ?? 0,
        qty: 0,
        gross_units: 0,
        revenue_cents_ingested: 0,
        cost_cents_ingested: 0,
        loss_qty: 0,
        loss_cents: 0,
        on_hand_source: 'none',
        on_hand: null,
        on_hand_unit: '',
        stockout: null,
        cost_cents_recomputed: 0,
        cost_delta_cents: 0,
        owner_consumption: false,
        revenue_cents: 0,
        revenue_source: 'ingested',
        cost_cents: 0,
        net_qty: 0,
        net_revenue_cents: 0,
        contribution_cents: 0,
        contribution_pct: 0,
        is_spoilage: false,
        cost_outlier: false,
        needs_count: false,
        needs_investigate: false,
        needs_catalog_fix: false,
        needs_reprice: false,
      };
    }
    const a = agg[vid];
    a.qty += Number(s.units ?? 0);
    a.gross_units += Number(s.gross_units ?? 0);
    a.revenue_cents_ingested += Math.trunc(Number(s.revenue_cents ?? 0));
    a.cost_cents_ingested += Math.trunc(Number(s.cost_cents ?? 0));
  }

  for (const vid of Object.keys(agg)) {
    const a = agg[vid];
    const bc = a.barcode;
    const nm_lower = a.name.trim().toLowerCase();
    let lqty = 0;
    let lcents = 0;
    if (bc && loss_by_upc[bc]) {
      lqty = loss_by_upc[bc].qty;
      lcents = loss_by_upc[bc].cents;
    } else if (nm_lower && loss_by_name[nm_lower]) {
      lqty = loss_by_name[nm_lower].qty;
      lcents = loss_by_name[nm_lower].cents;
    }
    a.loss_qty = lqty;
    a.loss_cents = lcents;

    const vrow = inv_by_variant[vid];
    const irow = a.thrive_item_id ? inv_by_item[a.thrive_item_id] : undefined;
    const src_row = vrow ?? irow;
    a.on_hand_source = vrow ? 'variant' : (irow ? 'item' : 'none');
    a.on_hand = src_row && src_row.qty_on_hand !== null && src_row.qty_on_hand !== undefined
      ? Number(src_row.qty_on_hand)
      : null;
    a.on_hand_unit = (src_row?.unit ?? '') || '';
    a.stockout = src_row && src_row.stockout !== null && src_row.stockout !== undefined
      ? Boolean(src_row.stockout)
      : null;

    // Preserved v6 fix: sold_qty = max(0, qty - loss_qty).
    const sold_qty = Math.max(0, a.qty - lqty);

    a.cost_cents_recomputed = a.cat_cost_cents
      ? Math.round(sold_qty * a.cat_cost_cents)
      : a.cost_cents_ingested;
    a.cost_delta_cents = a.cost_cents_ingested - a.cost_cents_recomputed;

    const nk = name_key(a.name, a.variant);
    a.owner_consumption = owner_name_set.has(nk) || owner_name_set_lower.has(nk.toLowerCase());
    if (a.owner_consumption && a.revenue_cents_ingested === 0 && a.qty > 0) {
      a.revenue_cents = a.cat_price_cents ? Math.round(a.qty * a.cat_price_cents) : 0;
      a.revenue_source = 'reattributed_retail';
    } else {
      a.revenue_cents = a.revenue_cents_ingested;
      a.revenue_source = 'ingested';
    }

    a.cost_cents = a.cost_cents_recomputed;
    a.net_qty = sold_qty;
    a.net_revenue_cents = a.revenue_cents;
    a.contribution_cents = a.net_revenue_cents - a.cost_cents;
    a.contribution_pct = a.net_revenue_cents ? (a.contribution_cents / a.net_revenue_cents) * 100 : 0;

    a.is_spoilage = a.revenue_cents === 0 && a.qty > 0 && !a.owner_consumption;
    const avg_unit_rev = a.qty ? a.revenue_cents / a.qty : 0;
    const cost_per_unit = sold_qty ? a.cost_cents / sold_qty : 0;
    a.cost_outlier = cost_per_unit > 3 * avg_unit_rev && a.cost_cents > 500 && a.revenue_cents > 0;
  }

  const rows = Object.values(agg);
  rows.sort((x, y) => y.net_revenue_cents - x.net_revenue_cents);

  // ---------- METRICS ----------
  const gross_rev_raw = rows.reduce((s, r) => s + r.revenue_cents_ingested, 0) / 100;
  const gross_rev = rows.reduce((s, r) => s + r.revenue_cents, 0) / 100;
  const cogs_ingested = rows.reduce((s, r) => s + r.cost_cents_ingested, 0) / 100;
  const cogs_recomp = rows.reduce((s, r) => s + r.cost_cents, 0) / 100;
  const cogs_delta = cogs_ingested - cogs_recomp;
  const margin_all = gross_rev - cogs_recomp;
  const mall_pct = gross_rev ? (margin_all / gross_rev) * 100 : 0;
  const net_rev = rows.reduce((s, r) => s + r.net_revenue_cents, 0) / 100;
  const contrib_total = rows.reduce((s, r) => s + r.contribution_cents, 0) / 100;
  const contrib_pct = net_rev ? (contrib_total / net_rev) * 100 : 0;
  const neg_contrib_rows = rows.filter(r => r.contribution_cents < 0);
  const spoilage_rows = rows.filter(r => r.is_spoilage);
  const spoilage_cogs = spoilage_rows.reduce((s, r) => s + r.cost_cents, 0) / 100;
  const outlier_rows = rows.filter(r => r.cost_outlier);
  const owner_rows = rows.filter(r => r.owner_consumption);
  const owner_revenue_reattributed =
    owner_rows
      .filter(r => r.revenue_source === 'reattributed_retail')
      .reduce((s, r) => s + r.revenue_cents, 0) / 100;
  const loss_total_qty = rows.reduce((s, r) => s + r.loss_qty, 0);
  const loss_total_cents = rows.reduce((s, r) => s + r.loss_cents, 0);
  const skus_sold = rows.length;
  const zero_stock_rows = rows.filter(r => r.on_hand !== null && r.on_hand <= 0);
  const zero_stock_n = zero_stock_rows.length;
  const neg_stock_rows = rows.filter(r => r.on_hand !== null && r.on_hand < 0);
  const inv_via_variant_count = rows.filter(r => r.on_hand_source === 'variant').length;
  const inv_via_item_count = rows.filter(r => r.on_hand_source === 'item').length;

  console.log(`[+] contribution: $${contrib_total >= 0 ? '+' : ''}${contrib_total.toFixed(2)} (${fmtPctSigned(contrib_pct)}); negative lines: ${neg_contrib_rows.length}`);
  console.log(`[+] margin all-in: $${margin_all >= 0 ? '+' : ''}${margin_all.toFixed(2)} (${fmtPctSigned(mall_pct)})`);

  // v7: 7-day sparkline series from baselineRows7d.
  const daily_rev: Record<string, number> = {};
  const daily_cost: Record<string, number> = {};
  for (const r of baselineRows7d) {
    const d = String(r.sale_date ?? '').slice(0, 10);
    if (!d) continue;
    daily_rev[d] = (daily_rev[d] ?? 0) + Number(r.revenue_cents ?? 0);
    daily_cost[d] = (daily_cost[d] ?? 0) + Number(r.cost_cents ?? 0);
  }
  const spark_dates: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const dt = new Date(yday_dt.getTime() - i * 86400 * 1000);
    const dy = dt.getUTCFullYear();
    const dm = dt.getUTCMonth() + 1;
    const dd = dt.getUTCDate();
    spark_dates.push(`${dy}-${String(dm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`);
  }
  const rev_series = spark_dates.map(d => (daily_rev[d] ?? 0) / 100);
  const contrib_series = spark_dates.map(d => ((daily_rev[d] ?? 0) - (daily_cost[d] ?? 0)) / 100);
  const showSparks = baselineDays >= 5;
  const rev_spark = showSparks ? svgSpark(rev_series, '#0F7A4E') : '';
  const contrib_spark = showSparks ? svgSpark(contrib_series, '#B8860B') : '';

  // ---------- ACTIONS: compute per-row pills ----------
  const rowActions = new Map<string, ActionPill[]>();
  for (const r of rows) {
    const pills = actionsForRow(r);
    if (pills.length > 0) rowActions.set(r.variant_id, pills);
  }
  const actionable_rows = rows.filter(r => rowActions.has(r.variant_id));
  actionable_rows.sort((a, b) => {
    const sa = Math.max(...(rowActions.get(a.variant_id) ?? []).map(p => p.severity));
    const sb = Math.max(...(rowActions.get(b.variant_id) ?? []).map(p => p.severity));
    return sb - sa;
  });

  // "Do today" - top 3 by severity, as short imperative strings.
  function actionSentence(r: Agg): string {
    const nm = r.variant ? `${r.name} - ${r.variant}` : r.name;
    if (r.contribution_cents < 0 && r.qty > 0) return `Investigate negative-contribution: ${nm} (lost ${usd(-r.contribution_cents)})`;
    if (r.on_hand !== null && r.on_hand < 0) return `Physical count: ${nm} (on-hand ${r.on_hand.toFixed(2)})`;
    if (!r.cat_cost_cents) return `Add default cost in Thrive: ${nm}`;
    if (r.qty > 0 && r.net_revenue_cents > 0) {
      const m = (r.contribution_cents / r.net_revenue_cents) * 100;
      if (m >= 0 && m < 15) return `Reprice or renegotiate: ${nm} (margin ${m.toFixed(1)}%)`;
    }
    if (r.revenue_cents === 0 && r.qty > 0 && r.loss_qty > 0) return `Watch spoilage: ${nm} (loss qty ${r.loss_qty.toFixed(2)})`;
    return `Review: ${nm}`;
  }
  const do_today = actionable_rows.slice(0, 3).map(actionSentence);

  // Count-drift rows: negative on-hand.
  const drift_rows = rows.filter(r => r.on_hand !== null && r.on_hand < 0);

  // ---------- Route existence probes (best-effort) ----------
  async function probeUrl(u: string): Promise<boolean> {
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 5000);
      const r = await fetch(u, { method: 'GET', signal: ctrl.signal });
      clearTimeout(to);
      return r.status >= 200 && r.status < 400;
    } catch {
      return false;
    }
  }
  const csvMirrorUrl = `${CSV_MIRROR_BASE}/${yesterday}.csv`;
  const csvHosted = await probeUrl(csvMirrorUrl);
  const stocktakeExists = await probeUrl(STOCKTAKE_ROUTE);

  // ---------- CSV ----------
  const csvHeaders = [
    'sku', 'item', 'variant', 'on_hand', 'on_hand_unit', 'on_hand_source', 'barcode',
    'qty_sold', 'gross_units', 'revenue_ingested', 'revenue_used', 'cost_ingested', 'cost_recomputed',
    'contribution', 'contribution_margin_pct', 'loss_qty', 'loss_dollars', 'net_qty', 'net_revenue',
    'flag_spoilage', 'flag_owner_consumption', 'flag_cost_outlier',
    'flag_needs_count', 'flag_needs_investigate', 'flag_needs_catalog_fix', 'flag_needs_reprice',
  ];
  const csvLines: string[] = [csvHeaders.join(',')];
  for (const r of rows) {
    const on_hand_str = r.on_hand !== null ? r.on_hand.toFixed(2) : '';
    const row: Array<string | number> = [
      r.sku, r.name, r.variant, on_hand_str, r.on_hand_unit, r.on_hand_source, r.barcode,
      r.qty.toFixed(2), r.gross_units.toFixed(2),
      (r.revenue_cents_ingested / 100).toFixed(2), (r.revenue_cents / 100).toFixed(2),
      (r.cost_cents_ingested / 100).toFixed(2), (r.cost_cents / 100).toFixed(2),
      (r.contribution_cents / 100).toFixed(2), r.contribution_pct.toFixed(1),
      r.loss_qty.toFixed(2), (r.loss_cents / 100).toFixed(2),
      r.net_qty.toFixed(2), (r.net_revenue_cents / 100).toFixed(2),
      r.is_spoilage ? 'Y' : '',
      r.owner_consumption ? 'Y' : '',
      r.cost_outlier ? 'Y' : '',
      r.needs_count ? 'Y' : '',
      r.needs_investigate ? 'Y' : '',
      r.needs_catalog_fix ? 'Y' : '',
      r.needs_reprice ? 'Y' : '',
    ];
    csvLines.push(row.map(csvEsc).join(','));
  }
  const csv_str = csvLines.join('\r\n') + '\r\n';
  const csv_bytes = Buffer.from(csv_str, 'utf-8');
  const csv_name = `produce_sales_${yesterday}.csv`;

  // ---------- HTML build ----------
  function on_hand_cell(r: Agg): string {
    if (r.on_hand === null) return '&mdash;';
    let s = r.on_hand.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
    if (!s) s = '0';
    let unit = (r.on_hand_unit ?? '').trim();
    if (!unit) unit = r.qty && Math.abs(r.qty - Math.round(r.qty)) > 0.01 ? 'lb' : 'ea';
    if (inv_stale) return `${s} ${esc(unit)} <span style='color:#c60;font-size:10px'>(stale as of ${esc((inv_max_snap ?? '').slice(0, 16).replace('T', ' '))})</span>`;
    return `${s} ${esc(unit)}`;
  }
  function item_cell(r: Agg): string {
    let base = esc(r.name);
    if (r.variant && !r.name.toLowerCase().includes(r.variant.toLowerCase())) {
      base = `${base} <span style='color:#666'>&middot; ${esc(r.variant)}</span>`;
    }
    return base;
  }
  function contrib_cell(r: Agg): string {
    const c = r.contribution_cents;
    const color = c < 0 ? '#a00' : '#111';
    return `<span style="color:${color}">${usd(c)}</span>`;
  }
  function pills_html(vid: string): string {
    const pills = rowActions.get(vid) ?? [];
    return pills.map(p =>
      `<span style="display:inline-block;background:#fff;border:1px solid ${p.color};color:${p.color};border-radius:10px;padding:1px 7px;font-size:10px;margin-right:3px">${esc(p.label)}</span>`
    ).join('');
  }
  function actionable_row_html(r: Agg): string {
    return (
      `<tr>` +
      `<td align="left">${esc(r.sku)}</td>` +
      `<td align="left">${item_cell(r)}</td>` +
      `<td align="right">${on_hand_cell(r)}</td>` +
      `<td align="right">${r.qty.toFixed(2)}</td>` +
      `<td align="right">${usd(r.net_revenue_cents)}</td>` +
      `<td align="right">${contrib_cell(r)}</td>` +
      `<td align="left">${pills_html(r.variant_id)}</td>` +
      `</tr>`
    );
  }
  const actionable_table_rows = actionable_rows.map(actionable_row_html).join('');

  // Data-health strip
  const strip_html =
    `<table border="0" cellpadding="0" cellspacing="0" style="margin:4px 0 14px 0"><tr>` +
    gates.map(badgeHtml).join('') +
    `</tr></table>`;

  // Profit-first headline
  const profit_cents_total = Math.round(contrib_total * 100);
  const profit_color = profit_cents_total >= 0 ? '#0a7' : '#a00';
  const spark_line_html = showSparks
    ? `<div style="font-size:14px;color:#555;margin-top:6px;line-height:16px">rev ${rev_spark} &nbsp; contrib ${contrib_spark} <span style="color:#888;font-size:11px">(7d)</span></div>`
    : `<div style="color:#888;font-size:11px;margin-top:6px">7-day trend suppressed (only ${baselineDays} distinct days in baseline)</div>`;

  const do_today_html = do_today.length
    ? `<div style="margin-top:16px"><b>Do today:</b><ul style="margin:4px 0 0 20px;padding:0">${do_today.map(s => `<li style="margin:2px 0">${esc(s)}</li>`).join('')}</ul></div>`
    : `<div style="margin-top:16px;color:#0a7"><b>Do today:</b> nothing flagged &mdash; produce is clean.</div>`;

  const headline_html =
    `<div style="margin:16px 0 4px 0;font-size:13px;color:#555">Yesterday's Produce Sales</div>` +
    `<div style="font-size:34px;font-weight:bold;color:#111;line-height:1.1">${usd(Math.round(net_rev * 100))}</div>` +
    `<div style="color:#666;font-size:12px;margin-top:4px">Profit <span style="color:${profit_color}">${usd(profit_cents_total)}</span> &middot; Margin ${fmtPctSigned(contrib_pct)} &middot; ${skus_sold} SKUs sold</div>` +
    spark_line_html +
    do_today_html;

  // Panels
  const csv_link_or_note = csvHosted
    ? `<div style="margin-top:6px;font-size:12px"><a href="${csvMirrorUrl}">View full audit CSV &raquo;</a></div>`
    : `<div style="margin-top:6px;font-size:11px;color:#666">Full audit CSV attached (mirror route not hosted).</div>`;

  const stocktakeHref = stocktakeExists
    ? STOCKTAKE_ROUTE
    : `mailto:${OPS_INBOX}?subject=${encodeURIComponent(`Add to produce stocktake - ${yesterday}`)}&body=${encodeURIComponent(drift_rows.map(r => `${r.sku} ${r.name} ${r.variant}`).join('\n'))}`;
  const stocktakeCtaLabel = stocktakeExists ? 'Batch &rarr; Stocktake' : 'Email me the drift list';

  const drift_panel_html = drift_rows.length
    ? `<h3 style="margin:22px 0 6px 0;font-size:14px;color:#333">Count Drift <span style="color:#888;font-size:12px">(${drift_rows.length} SKUs)</span></h3>` +
      `<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;border-color:#e5e5e5"><thead><tr bgcolor="#f9f9f9"><th align="left">SKU</th><th align="left">Item</th><th align="right">On Hand</th></tr></thead><tbody>` +
      drift_rows.map(r => `<tr><td>${esc(r.sku)}</td><td>${item_cell(r)}</td><td align="right" style="color:#a00">${r.on_hand?.toFixed(2)}</td></tr>`).join('') +
      `</tbody></table>` +
      `<div style="margin-top:8px"><a href="${stocktakeHref}" style="display:inline-block;background:#c60;color:#fff;padding:6px 12px;border-radius:4px;text-decoration:none;font-size:12px">${stocktakeCtaLabel}</a></div>`
    : '';

  const spoilage_lines: string[] = [];
  if (discount8_lines.length) {
    const disc8_total = discount8_lines.reduce((s, ln) => s + ln.line_price_cents, 0);
    spoilage_lines.push(`Discount 8 (owner consumption): ${discount8_lines.length} lines &middot; retail value ${usd(disc8_total)}`);
  }
  if (loss_total_qty > 0) {
    spoilage_lines.push(`BB Tally (markdown clearance): qty ${loss_total_qty.toFixed(2)} &middot; retail value ${usd(loss_total_cents)}`);
  }
  const spoilage_panel_html = spoilage_lines.length
    ? `<h3 style="margin:22px 0 6px 0;font-size:14px;color:#333">Spoilage</h3>` +
      `<ul style="margin:0;padding-left:20px;color:#444;font-size:12px">${spoilage_lines.map(l => `<li>${l}</li>`).join('')}</ul>`
    : '';

  // If actionable table is empty, show a green all-clear line.
  const actionable_table_html = actionable_rows.length
    ? `<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;border-color:#ccc;margin-top:14px">
<thead><tr bgcolor="#f4f4f4">
<th align="left">SKU</th><th align="left">Item &middot; Variant</th>
<th align="right">On Hand</th><th align="right">Qty Sold</th>
<th align="right">Net Rev</th><th align="right">Contribution</th><th align="left">Action</th>
</tr></thead>
<tbody>${actionable_table_rows}</tbody>
</table>`
    : `<div style="margin-top:14px;padding:10px;background:#eaf7ea;color:#0a7;border-radius:4px">No SKUs required action yesterday. Full detail in the audit CSV.</div>`;

  // v7.1: Top 10 by revenue ("What sold yesterday")
  const top_movers = rows.slice().sort((a, b) => b.net_revenue_cents - a.net_revenue_cents).slice(0, 10);
  const day_total_cents_all = rows.reduce((s, r) => s + r.net_revenue_cents, 0);
  const top_movers_total_cents = top_movers.reduce((s, r) => s + r.net_revenue_cents, 0);
  const top_movers_pct = day_total_cents_all ? (top_movers_total_cents / day_total_cents_all) * 100 : 0;
  const top_movers_rows_html = top_movers.map(r => {
    const pct = day_total_cents_all ? (r.net_revenue_cents / day_total_cents_all) * 100 : 0;
    return `<tr>` +
      `<td align="left">${item_cell(r)}</td>` +
      `<td align="right">${r.qty.toFixed(2)}</td>` +
      `<td align="right">${usd(r.net_revenue_cents)}</td>` +
      `<td align="right">${pct.toFixed(1)}%</td>` +
      `</tr>`;
  }).join('');
  const top_movers_html = top_movers.length
    ? `<h3 style="margin:22px 0 6px 0;font-size:14px;color:#333">What sold yesterday <span style="color:#888;font-size:12px">(top 10 by revenue)</span></h3>` +
      `<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;border-color:#ccc">` +
      `<thead><tr bgcolor="#f4f4f4">` +
      `<th align="left">Product &middot; Variant</th>` +
      `<th align="right">Qty</th>` +
      `<th align="right">Revenue</th>` +
      `<th align="right">% of day</th>` +
      `</tr></thead>` +
      `<tbody>${top_movers_rows_html}</tbody>` +
      `<tfoot><tr bgcolor="#f9f9f9"><td align="left"><b>Total of top 10:</b></td><td></td><td align="right"><b>${usd(top_movers_total_cents)}</b></td><td align="right"><b>${top_movers_pct.toFixed(1)}%</b></td></tr></tfoot>` +
      `</table>`
    : '';

  const preview_banner_html = isPreview
    ? `<div style="margin:0 0 12px 0;padding:6px 10px;background:#fffbe5;border-left:4px solid #c60;font-size:12px;color:#555">[v7 PREVIEW] Report generated on demand &mdash; recipient overridden to ${esc(toOverride ?? '')}.</div>`
    : '';

  const html_body = `<html><head><meta charset="utf-8"></head><body style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#111;max-width:820px">
${preview_banner_html}
<h2 style="margin:0 0 4px 0">PRODUCE SALES &mdash; ${esc(date_us)}</h2>
<div style="color:#666;margin-bottom:6px">${esc(weekday_label)}</div>

${strip_html}

${headline_html}

${top_movers_html}

<h3 style="margin:22px 0 6px 0;font-size:14px;color:#333">Actionable SKUs <span style="color:#888;font-size:12px">(${actionable_rows.length} of ${skus_sold})</span></h3>
${actionable_table_html}

${drift_panel_html}

${spoilage_panel_html}

${csv_link_or_note}

<div style="margin-top:24px;color:#666;font-size:11px;line-height:1.5">
<b>Methodology</b><br>
&middot; Sales: Thrive POS. Inventory: live at email-send. Loss-tally: <code>loss_ledger</code>.<br>
&middot; Net revenue excludes loss-tally spoilage; Discount 8 (owner consumption) re-attributed to full retail.<br>
&middot; Contribution = net revenue &minus; COGS (COGS recomputed from catalog default cost).<br>
&middot; Preflight gates run before build; a yellow strip indicator means partial-degradation.<br>
&middot; Delivery: Resend. Report engine: v7.
</div>
</body></html>`;

  const _do_today_lines = do_today.length ? do_today.map(s => `  - ${s}`).join('\n') : '  (nothing flagged)';
  const plain_body =
    `${isPreview ? '[v7 PREVIEW] ' : ''}PRODUCE SALES - ${date_us}\n${weekday_label}\n\n` +
    `Yesterday's Produce Sales: ${usd(Math.round(net_rev * 100))}\n` +
    `Profit: ${usd(profit_cents_total)}   Margin: ${fmtPctSigned(contrib_pct)}   SKUs sold: ${skus_sold}\n` +
    (showSparks ? `Trend (7d) - see HTML view for chart\n` : '') +
    `\nDo today:\n${_do_today_lines}\n` +
    `\nActionable SKUs: ${actionable_rows.length} of ${skus_sold}\n` +
    (drift_rows.length ? `Count drift: ${drift_rows.length} SKUs\n` : '') +
    `\nFull audit CSV ${csvHosted ? `at ${csvMirrorUrl}` : 'attached to this email.'}\n`;

  // ---------- SEND ----------
  const subjectDate = date_us;
  const subject = `${isPreview ? '[v7 PREVIEW] ' : ''}Produce Sales - ${subjectDate}${overallColor === 'yellow' ? ' (yellow health)' : ''}`;

  const finalTo = isPreview && toOverride ? [toOverride] : RECIPIENTS.to;
  const finalCc = isPreview ? undefined : RECIPIENTS.cc;

  const payload: Record<string, unknown> = {
    from: FROM_ADDR,
    to: finalTo,
    subject,
    html: html_body,
    text: plain_body,
  };
  if (finalCc) payload.cc = finalCc;
  if (!csvHosted) {
    payload.attachments = [{
      filename: csv_name,
      content: csv_bytes.toString('base64'),
    }];
  }

  console.log('[+] Sending via Resend...');
  const sendResp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_KEY}`,
      'Content-Type': 'application/json',
      'User-Agent': 'natures-storehouse-produce-report/7.1 (Node fetch)',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!sendResp.ok) {
    const errText = await sendResp.text();
    console.log(`[!] Resend HTTP error: ${sendResp.status} ${errText.slice(0, 500)}`);
    return NextResponse.json(
      { error: 'resend_failed', status: sendResp.status, body: errText.slice(0, 1000), gates },
      { status: 500 }
    );
  }
  const send_result = (await sendResp.json()) as { id?: string };
  console.log(`[+] Resend response: ${JSON.stringify(send_result)}`);
  const resend_id = send_result.id;

  const summary = {
    version: 'v7.1',
    preview: isPreview,
    resend_email_id: resend_id,
    from: FROM_ADDR,
    to: finalTo,
    cc: finalCc ?? null,
    subject,
    report_date: yesterday,
    overall_gate_color: overallColor,
    gates: gates.map(g => ({ id: g.id, color: g.color, label: g.label, detail: g.detail })),
    inventory_sync_duration_s: Math.round(sync_dur * 10) / 10,
    inventory_sync_result: { pulled: syncResp.pulled, inserted: syncResp.inserted },
    inv_via_variant_for_sold_skus: inv_via_variant_count,
    inv_via_item_fallback_for_sold_skus: inv_via_item_count,
    zero_on_hand_count: zero_stock_n,
    neg_on_hand_count: neg_stock_rows.length,
    contribution_total: Math.round(contrib_total * 100) / 100,
    contribution_pct: Math.round(contrib_pct * 10) / 10,
    revenue_total: Math.round(net_rev * 100) / 100,
    skus_sold,
    actionable_sku_count: actionable_rows.length,
    drift_sku_count: drift_rows.length,
    do_today,
    spoilage_lines_shown: spoilage_lines.length,
    csv_hosted: csvHosted,
    csv_url: csvHosted ? csvMirrorUrl : null,
    stocktake_route_exists: stocktakeExists,
    sparklines_shown: showSparks,
  };
  console.log('=== SUMMARY v7 ===');
  console.log(JSON.stringify(summary, null, 2));

  return NextResponse.json({ ok: true, ...summary });
}

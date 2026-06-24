/**
 * Daily Produce Sales Report — production format (v6 port from Python)
 *
 * Pulls yesterday's produce sales from Supabase, re-attributes Clover "Discount 8"
 * (owner consumption) to full retail, recomputes COGS from current catalog, and emails
 * the result via Resend.
 *
 * Cron: `1 4 * * *` (04:01 UTC daily ≈ 00:01 ET in summer / 23:01 ET prev day in winter).
 * Auth: Bearer ${CRON_SECRET}
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

// Recipient list — single source of truth.
const RECIPIENTS = {
  to: ['cmaine@ycconsulting.biz'],
  cc: ['danielzmartin2024@gmail.com'],
};
const OWNER_DISCOUNT_NAME = 'Discount 8';
const INV_SYNC_URL = 'https://thrive-pipeline.vercel.app/api/cron/inventory';

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
};

export async function GET(req: NextRequest) {
  // ----- auth gate -----
  const auth = req.headers.get('authorization');
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const SUPABASE_URL = (process.env.UNDERSTORY_SUPABASE_URL ?? '').replace(/\/+$/, '');
  const SUPA_KEY = process.env.UNDERSTORY_SUPABASE_SERVICE_ROLE_KEY ?? '';
  const RESEND_KEY = process.env.RESEND_API_KEY ?? '';
  const CLOVER_TOK = process.env.NATURES_STOREHOUSE_TOKEN ?? '';
  const CLOVER_MID = process.env.NATURES_STOREHOUSE_MID ?? '';
  const INV_CRON_SECRET = process.env.THRIVE_PIPELINE_CRON_SECRET ?? '';
  const TO_ADDR = RECIPIENTS.to[0];

  const missing: string[] = [];
  if (!SUPABASE_URL) missing.push('UNDERSTORY_SUPABASE_URL');
  if (!SUPA_KEY) missing.push('UNDERSTORY_SUPABASE_SERVICE_ROLE_KEY');
  if (!RESEND_KEY) missing.push('RESEND_API_KEY');
  if (!CLOVER_TOK) missing.push('NATURES_STOREHOUSE_TOKEN');
  if (!CLOVER_MID) missing.push('NATURES_STOREHOUSE_MID');
  if (!INV_CRON_SECRET) missing.push('THRIVE_PIPELINE_CRON_SECRET');
  if (missing.length) {
    return NextResponse.json({ error: 'missing_env', missing }, { status: 500 });
  }

  // ----- date math (ET ≈ UTC-4 in summer; matches Python verbatim) -----
  const now_utc = new Date();
  const ny_now = new Date(now_utc.getTime() - 4 * 3600 * 1000);
  const yday_dt = new Date(ny_now.getTime() - 24 * 3600 * 1000);
  const Y = yday_dt.getUTCFullYear();
  const M = yday_dt.getUTCMonth() + 1;
  const D = yday_dt.getUTCDate();
  const yesterday = `${Y}-${String(M).padStart(2, '0')}-${String(D).padStart(2, '0')}`;
  const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const weekday_label = `${WEEKDAY_NAMES[yday_dt.getUTCDay()]}, ${MONTH_NAMES[yday_dt.getUTCMonth()]} ${D}, ${Y}`;
  const date_us = `${M}/${D}/${Y}`;
  console.log(`[+] Report date: ${yesterday} (${weekday_label})`);

  // ===== STEP 0: Trigger LIVE inventory sync =====
  console.log(`[+] Triggering inventory sync: ${INV_SYNC_URL}`);
  const t0 = Date.now();
  let resp: { pulled?: number; inserted?: number } = {};
  let sync_dur = 0;
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 180_000);
    const r = await fetch(INV_SYNC_URL, {
      headers: { Authorization: `Bearer ${INV_CRON_SECRET}` },
      signal: ctrl.signal,
    });
    clearTimeout(to);
    resp = (await r.json()) as { pulled?: number; inserted?: number };
    sync_dur = (Date.now() - t0) / 1000;
    console.log(`[+] Inventory sync OK in ${sync_dur.toFixed(1)}s: pulled=${resp.pulled} inserted=${resp.inserted}`);
  } catch (e) {
    sync_dur = (Date.now() - t0) / 1000;
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`[!] Inventory sync failed after ${sync_dur.toFixed(1)}s: ${msg}. Continuing with cached snapshot.`);
    resp = {};
  }

  // ---------- Supabase REST ----------
  async function supa_get(path: string, params: Record<string, string>, retries = 3): Promise<unknown[]> {
    const qs = '?' + new URLSearchParams(params).toString();
    const url = `${SUPABASE_URL}/rest/v1/${path}${qs}`;
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const r = await fetch(url, {
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

  // 1) Produce catalog (per-variant rows)
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

  // 2) Sales
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

  // 3) Loss ledger
  const loss_rows = (await supa_get('loss_ledger', {
    pulled_date: `eq.${yesterday}`,
    is_produce: 'eq.true',
    select: 'upc,item_name,brand_produce,quantity,total_cents',
    limit: '5000',
  })) as LossRow[];
  console.log(`[+] Loss rows: ${loss_rows.length}`);

  // 4) INVENTORY — scope to ONLY the variants that sold yesterday + Tomato spot-check SKUs.
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
        const rows = (await supa_get('thrive_inventory_latest', {
          [key]: 'in.(' + chunk.join(',') + ')',
          select: 'thrive_item_id,sales_item_id,qty_on_hand,unit,stockout,snapshot_ts',
          limit: '1000',
        }, 1)) as InvRow[];
        for (const r of rows) {
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

  // --- VARIANT JOIN SPOT-CHECK: Clark's 3-variant Tomato SKUs (94064/74064/84064) ---
  console.log('[+] Spot-check: Tomato variants (94064/74064/84064)');
  for (const v of produce_variants) {
    if (['94064', '74064', '84064'].includes(v.sku)) {
      const vrow = inv_by_variant[v.thrive_variant_id];
      const irow = inv_by_item[v.thrive_item_id];
      const oh = vrow ? vrow.qty_on_hand : (irow ? irow.qty_on_hand : null);
      const src = vrow ? 'VARIANT' : (irow ? 'item-fallback' : 'none');
      console.log(`  sku=${v.sku.padEnd(8)} vid=${v.thrive_variant_id.slice(-6)} iid=${v.thrive_item_id.slice(-6)} name=${JSON.stringify(v.name)} oh=${oh} via=${src}`);
    }
  }

  // 5) Clover orders → Discount 8 lines
  // yday_local_midnight = midnight UTC for yday + 4h = midnight ET = 4am UTC on yday's calendar date
  const yday_utc_midnight = Date.UTC(Y, M - 1, D, 0, 0, 0);
  const yday_local_midnight_ms = yday_utc_midnight + 4 * 3600 * 1000;
  const start_ms = yday_local_midnight_ms;
  const end_ms = yday_local_midnight_ms + 24 * 3600 * 1000;

  async function clover_get(path: string, params: Array<[string, string]>): Promise<{ elements?: unknown[] }> {
    const usp = new URLSearchParams();
    for (const [k, v] of params) usp.append(k, v);
    const url = `https://api.clover.com/v3/merchants/${CLOVER_MID}/${path}?${usp.toString()}`;
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 30_000);
    try {
      const r = await fetch(url, {
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
        // placeholders, filled below
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

    // inventory: variant-level FIRST, then item-level fallback
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

    // Loss-tally rings are counted in a.qty but produce /bin/bash revenue at register.
    // Units that actually produced cash revenue:
    const sold_qty = Math.max(0, a.qty - lqty);

    // cost recompute — only the units that actually sold incur COGS here;
    // loss-tally cost is tracked separately via loss_ledger.
    a.cost_cents_recomputed = a.cat_cost_cents
      ? Math.round(sold_qty * a.cat_cost_cents)
      : a.cost_cents_ingested;
    a.cost_delta_cents = a.cost_cents_ingested - a.cost_cents_recomputed;

    // Discount 8 re-attribution
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

    // Revenue from sold units only. Loss-tally rings already ring at /bin/bash, so
    // a.revenue_cents excludes them naturally — do NOT subtract again
    // (previous bug: net_rev double-counted loss via lqty * avg_unit_rev).
    a.net_qty = sold_qty;
    a.net_revenue_cents = a.revenue_cents;

    // CONTRIBUTION per line = revenue from sold units − cost of sold units
    a.contribution_cents = a.net_revenue_cents - a.cost_cents;
    a.contribution_pct = a.net_revenue_cents ? (a.contribution_cents / a.net_revenue_cents) * 100 : 0;

    // flags — spoilage = had ring activity but no revenue (incl. loss-only rows)
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
  const flagged_ids = new Set<string>([
    ...spoilage_rows.map(r => r.variant_id),
    ...outlier_rows.map(r => r.variant_id),
  ]);
  const sellable = rows.filter(r => !flagged_ids.has(r.variant_id));
  const sell_rev = sellable.reduce((s, r) => s + r.revenue_cents, 0) / 100;
  const sell_cost = sellable.reduce((s, r) => s + r.cost_cents, 0) / 100;
  const sell_marg = sell_rev - sell_cost;
  const sm_pct = sell_rev ? (sell_marg / sell_rev) * 100 : 0;

  const loss_total_qty = rows.reduce((s, r) => s + r.loss_qty, 0);
  const loss_total_cents = rows.reduce((s, r) => s + r.loss_cents, 0);
  const skus_sold = rows.length;
  const zero_stock_rows = rows.filter(r => r.on_hand !== null && r.on_hand <= 0);
  const zero_stock_n = zero_stock_rows.length;
  const top_mover: Agg | null = rows.length > 0 ? rows[0] : null;
  const any_loss = rows.some(r => r.loss_cents > 0);
  let biggest_loss: Agg | null = null;
  if (any_loss) {
    biggest_loss = rows.reduce<Agg>((best, r) => (r.loss_cents > best.loss_cents ? r : best), rows[0]);
  }
  const inv_via_variant_count = rows.filter(r => r.on_hand_source === 'variant').length;
  const inv_via_item_count = rows.filter(r => r.on_hand_source === 'item').length;

  console.log(`[+] contribution: $${contrib_total >= 0 ? '+' : ''}${contrib_total.toFixed(2)} (${fmtPctSigned(contrib_pct)}); negative lines: ${neg_contrib_rows.length}`);
  console.log(`[+] margin all-in: $${margin_all >= 0 ? '+' : ''}${margin_all.toFixed(2)} (${fmtPctSigned(mall_pct)}); sellable: $${sell_marg >= 0 ? '+' : ''}${sell_marg.toFixed(2)} (${fmtPctSigned(sm_pct)})`);
  console.log(`[+] inv-source: variant=${inv_via_variant_count} item-fallback=${inv_via_item_count} (of ${skus_sold} sold)`);
  console.log(`[+] zero on-hand SKUs: ${zero_stock_n}`);

  // ---------- CSV ----------
  const csvHeaders = [
    'sku', 'item', 'variant', 'on_hand', 'on_hand_unit', 'on_hand_source', 'barcode',
    'qty_sold', 'gross_units', 'revenue_ingested', 'revenue_used', 'cost_ingested', 'cost_recomputed',
    'contribution', 'contribution_margin_pct', 'loss_qty', 'loss_dollars', 'net_qty', 'net_revenue',
    'flag_spoilage', 'flag_owner_consumption', 'flag_cost_outlier',
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
    ];
    csvLines.push(row.map(csvEsc).join(','));
  }
  // Match Python csv.writer default (\r\n line terminator)
  const csv_str = csvLines.join('\r\n') + '\r\n';
  const csv_bytes = Buffer.from(csv_str, 'utf-8');
  const csv_name = `produce_sales_${yesterday}.csv`;

  // ---------- HTML ----------
  function on_hand_cell(r: Agg): string {
    if (r.on_hand === null) return '&mdash;';
    let s = r.on_hand.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
    if (!s) s = '0';
    let unit = (r.on_hand_unit ?? '').trim();
    if (!unit) unit = r.qty && Math.abs(r.qty - Math.round(r.qty)) > 0.01 ? 'lb' : 'ea';
    return `${s} ${esc(unit)}`;
  }

  // Collapse Variant into Item to keep table at 7 columns (Gmail-friendly on phone width)
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

  const TOP_N = 50;
  const shown = rows.slice(0, TOP_N);
  const more = Math.max(0, rows.length - TOP_N);

  function row_html(r: Agg): string {
    let bg = '';
    if (r.is_spoilage) bg = ' bgcolor="#fff5f5"';
    else if (r.owner_consumption) bg = ' bgcolor="#eaf7ea"';
    else if (r.cost_outlier) bg = ' bgcolor="#fffbe5"';
    else if (r.on_hand !== null && r.on_hand <= 0) bg = ' bgcolor="#f0f9ff"';
    const flags: string[] = [];
    if (r.owner_consumption) flags.push('owner');
    if (r.is_spoilage) flags.push('spoilage');
    if (r.cost_outlier) flags.push('cost?');
    if (r.on_hand !== null && r.on_hand <= 0) flags.push('ZERO');
    const flag_str = flags.length
      ? ` <span style='color:#555;font-size:11px'>(${flags.join(', ')})</span>`
      : '';
    return (
      `<tr${bg}>` +
      `<td align="left">${esc(r.sku)}</td>` +
      `<td align="left">${item_cell(r)}${flag_str}</td>` +
      `<td align="right">${on_hand_cell(r)}</td>` +
      `<td align="right">${r.qty.toFixed(2)}</td>` +
      `<td align="right">${usd(r.net_revenue_cents)}</td>` +
      `<td align="right">${contrib_cell(r)}</td>` +
      `<td align="right">${r.loss_qty.toFixed(2)}</td>` +
      `</tr>`
    );
  }
  const table_rows_html = shown.map(row_html).join('');
  const more_row = more > 0
    ? `<tr><td colspan="7" align="left"><i>&hellip; and ${more} more SKUs (see attached CSV)</i></td></tr>`
    : '';

  function top_mover_str(): string {
    if (!top_mover) return '&mdash;';
    const v = top_mover.variant ? ` &middot; ${esc(top_mover.variant)}` : '';
    return `${esc(top_mover.name)}${v} &mdash; qty ${top_mover.qty.toFixed(2)}, ${usd(top_mover.net_revenue_cents)}`;
  }
  function biggest_loss_str(): string {
    if (!biggest_loss || biggest_loss.loss_cents <= 0) return '&mdash;';
    const v = biggest_loss.variant ? ` &middot; ${esc(biggest_loss.variant)}` : '';
    return `${esc(biggest_loss.name)}${v} &mdash; qty ${biggest_loss.loss_qty.toFixed(2)}, ${usd(biggest_loss.loss_cents)}`;
  }

  const top_line =
    `<table border="0" cellpadding="4" cellspacing="0">` +
    `<tr><td><b>Net revenue:</b></td><td>${usd(Math.round(net_rev * 100))}</td></tr>` +
    `<tr><td><b>Contribution:</b></td><td><b style="color:${contrib_total >= 0 ? '#0a7' : '#a00'}">${usd(Math.round(contrib_total * 100))} (${fmtPctSigned(contrib_pct)})</b></td></tr>` +
    `<tr><td><b>SKUs sold:</b></td><td>${skus_sold}</td></tr>` +
    `<tr><td><b>Items at zero:</b></td><td>${zero_stock_n}</td></tr>` +
    `<tr><td><b>Top mover:</b></td><td>${top_mover_str()}</td></tr>` +
    `<tr><td><b>Biggest loss:</b></td><td>${biggest_loss_str()}</td></tr>` +
    `</table>`;

  const html_body = `<html><body style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#111">
<h2 style="margin:0 0 4px 0">PRODUCE SALES &mdash; ${esc(date_us)}</h2>
<div style="color:#666;margin-bottom:14px">${esc(weekday_label)}</div>

${top_line}

<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;border-color:#ccc;margin-top:18px">
<thead><tr bgcolor="#f4f4f4">
<th align="left">SKU</th><th align="left">Item &middot; Variant</th>
<th align="right">On Hand</th><th align="right">Qty Sold</th>
<th align="right">Net Revenue</th><th align="right">Contribution</th><th align="right">Loss qty</th>
</tr></thead>
<tbody>
${table_rows_html}
${more_row}
</tbody>
</table>

<div style="margin-top:24px;color:#666;font-size:11px;line-height:1.5">
<b>Methodology</b><br>
&middot; Sales: Thrive POS. Inventory: live at email-send. Loss-tally: <code>loss_ledger</code>.<br>
&middot; Net revenue excludes loss-tally spoilage; Discount 8 (owner consumption) is re-attributed to full retail.<br>
&middot; Contribution = net revenue &minus; COGS. Negative = sold under cost.<br>
&middot; On Hand: parent-item level (variant-level pending a pipeline fix).<br>
&middot; Delivery: Resend.
</div>
</body></html>`;

  const _tm = top_mover
    ? `${top_mover.name}${top_mover.variant ? ` - ${top_mover.variant}` : ''} - qty ${top_mover.qty.toFixed(2)}, ${usd(top_mover.net_revenue_cents)}`
    : '-';
  const _bl = biggest_loss && biggest_loss.loss_cents > 0
    ? `${biggest_loss.name}${biggest_loss.variant ? ` - ${biggest_loss.variant}` : ''} - qty ${biggest_loss.loss_qty.toFixed(2)}, ${usd(biggest_loss.loss_cents)}`
    : '-';
  const plain_body =
    `PRODUCE SALES - ${date_us}\n${weekday_label}\n\n` +
    `Net revenue:    ${usd(Math.round(net_rev * 100))}\n` +
    `Contribution:   ${usd(Math.round(contrib_total * 100))}  (${fmtPctSigned(contrib_pct)})\n` +
    `SKUs sold:      ${skus_sold}\n` +
    `Items at zero:  ${zero_stock_n}\n` +
    `Top mover:      ${_tm}\n` +
    `Biggest loss:   ${_bl}\n` +
    `\nFull detail in attached CSV.\n`;

  const subject = `Produce Sales — ${date_us}`;
  const payload: Record<string, unknown> = {
    from: FROM_ADDR,
    to: RECIPIENTS.to,
    subject,
    html: html_body,
    text: plain_body,
    attachments: [{
      filename: csv_name,
      content: csv_bytes.toString('base64'),
    }],
  };
  if (RECIPIENTS.cc) payload.cc = RECIPIENTS.cc;

  console.log('[+] Sending via Resend...');
  const sendResp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_KEY}`,
      'Content-Type': 'application/json',
      'User-Agent': 'natures-storehouse-produce-report/1.0 (Node fetch)',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!sendResp.ok) {
    const errText = await sendResp.text();
    console.log(`[!] Resend HTTP error: ${sendResp.status} ${errText.slice(0, 500)}`);
    return NextResponse.json(
      { error: 'resend_failed', status: sendResp.status, body: errText.slice(0, 1000) },
      { status: 500 }
    );
  }
  const send_result = (await sendResp.json()) as { id?: string };
  console.log(`[+] Resend response: ${JSON.stringify(send_result)}`);
  const resend_id = send_result.id;

  const summary = {
    resend_email_id: resend_id,
    from: FROM_ADDR,
    to: TO_ADDR,
    subject,
    inventory_sync_duration_s: Math.round(sync_dur * 10) / 10,
    inventory_sync_result: { pulled: resp.pulled, inserted: resp.inserted },
    inv_via_variant_for_sold_skus: inv_via_variant_count,
    inv_via_item_fallback_for_sold_skus: inv_via_item_count,
    zero_on_hand_count: zero_stock_n,
    contribution_total: Math.round(contrib_total * 100) / 100,
    contribution_pct: Math.round(contrib_pct * 10) / 10,
    negative_contribution_rows: neg_contrib_rows.length,
    negative_contribution_skus: neg_contrib_rows.map(r => ({
      sku: r.sku,
      name: r.name,
      variant: r.variant,
      contribution: r.contribution_cents / 100,
    })),
    margin_all_in: Math.round(margin_all * 100) / 100,
    margin_sellable: Math.round(sell_marg * 100) / 100,
  };
  console.log('=== SUMMARY ===');
  console.log(JSON.stringify(summary, null, 2));

  return NextResponse.json({ ok: true, ...summary });
}

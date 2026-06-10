// lib/loss-sync.ts
// Clover discount-line sync to the Loss Tally Google Sheet.
// One file by design so it's easy to read end-to-end. See PR description for architecture.

import crypto from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { fetchOrdersByModifiedTime, type CloverOrder, type CloverLineItem } from '@/lib/clover';

// ===== Discount routing =====

export type LossDiscountConfig = { name: string; tab: string };
export const LOSS_DISCOUNT_ROUTING: LossDiscountConfig[] = [
  { name: 'Loss Tally',         tab: 'Loss Tally' },
  { name: 'Bonus Bin Loss',     tab: 'BB Tally'   },
  { name: 'Kitchen Loss Tally', tab: 'Deli Tally' },
];

// ===== Google service-account auth (no googleapis npm dep) =====

let tokenCache: { token: string; exp: number } | null = null;

async function getGoogleToken(): Promise<string> {
  if (tokenCache && tokenCache.exp > Date.now() + 60_000) return tokenCache.token;
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON env var not set');
  const sa = JSON.parse(raw);
  if (!sa.client_email || !sa.private_key) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON missing client_email or private_key');
  const b64u = (s: string | Buffer) => Buffer.from(s).toString('base64url').replace(/=+$/, '');
  const header = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: sa.private_key_id }));
  const now = Math.floor(Date.now() / 1000);
  const claim = b64u(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }));
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${header}.${claim}`);
  const sig = signer.sign(sa.private_key, 'base64url').replace(/=+$/, '');
  const jwt = `${header}.${claim}.${sig}`;
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  if (!resp.ok) throw new Error(`Google OAuth ${resp.status}: ${await resp.text()}`);
  const j = await resp.json() as { access_token: string; expires_in: number };
  tokenCache = { token: j.access_token, exp: Date.now() + (j.expires_in - 300) * 1000 };
  return j.access_token;
}

async function gapi<T = unknown>(method: string, url: string, body?: unknown): Promise<T> {
  const tok = await getGoogleToken();
  const headers: Record<string, string> = { Authorization: `Bearer ${tok}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const resp = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`Google ${method} ${url.split('?')[0]} -> ${resp.status}: ${txt.slice(0, 400)}`);
  }
  if (resp.status === 204) return undefined as T;
  return resp.json() as Promise<T>;
}

// ===== Sheet resolver (xlsx -> native conversion w/ caching) =====

export interface ResolvedSheet {
  sheetId: string;
  isNative: boolean;
  sourceFileId: string;
  blockedReason?: string;
}

export async function resolveSheet(year: number): Promise<ResolvedSheet> {
  const admin = createAdminClient();
  if (!admin) throw new Error('Supabase admin client unavailable');

  const { data: pin } = await admin
    .from('clover_loss_year_sheet_pin')
    .select('source_file_id')
    .eq('year', year)
    .maybeSingle();
  const sourceId: string | undefined = (pin as { source_file_id?: string } | null)?.source_file_id;
  if (!sourceId) throw new Error(`No clover_loss_year_sheet_pin row for year ${year}. Insert one with the Drive file ID.`);

  const { data: cached } = await admin
    .from('clover_loss_workbook_cache')
    .select('native_sheet_id')
    .eq('source_xlsx_id', sourceId)
    .maybeSingle();
  const cachedRow = cached as { native_sheet_id?: string } | null;
  if (cachedRow?.native_sheet_id) {
    return { sheetId: cachedRow.native_sheet_id, isNative: true, sourceFileId: sourceId };
  }

  type DriveMeta = { id: string; name: string; mimeType: string; parents?: string[] };
  const meta = await gapi<DriveMeta>('GET',
    `https://www.googleapis.com/drive/v3/files/${sourceId}?fields=id,name,mimeType,parents&supportsAllDrives=true`,
  );

  if (meta.mimeType === 'application/vnd.google-apps.spreadsheet') {
    await admin.from('clover_loss_workbook_cache').upsert({ source_xlsx_id: sourceId, native_sheet_id: sourceId });
    return { sheetId: sourceId, isNative: true, sourceFileId: sourceId };
  }

  const parents = meta.parents || [];
  const attempts: Array<{ label: string; parent?: string }> = [
    ...parents.map(p => ({ label: `parent=${p}`, parent: p })),
    { label: 'no-parent', parent: undefined },
  ];
  const errors: string[] = [];
  for (const a of attempts) {
    try {
      type CopyOut = { id: string };
      const copy = await gapi<CopyOut>('POST',
        `https://www.googleapis.com/drive/v3/files/${sourceId}/copy?supportsAllDrives=true&fields=id`,
        {
          name: `${meta.name.replace(/\.xlsx$/i, '')} (auto-native)`,
          mimeType: 'application/vnd.google-apps.spreadsheet',
          ...(a.parent ? { parents: [a.parent] } : {}),
        },
      );
      try {
        await gapi('POST',
          `https://www.googleapis.com/drive/v3/files/${copy.id}/permissions?supportsAllDrives=true&sendNotificationEmail=false`,
          { type: 'user', role: 'writer', emailAddress: 'naturesstorehouse@gmail.com' },
        );
      } catch { /* non-fatal */ }
      await admin.from('clover_loss_workbook_cache').upsert({ source_xlsx_id: sourceId, native_sheet_id: copy.id });
      return { sheetId: copy.id, isNative: true, sourceFileId: sourceId };
    } catch (e) {
      errors.push(`${a.label}: ${(e as Error).message.slice(0, 180)}`);
    }
  }

  const saEmail = (() => { try { return JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}').client_email || '(unknown)'; } catch { return '(unknown)'; } })();
  return {
    sheetId: sourceId,
    isNative: false,
    sourceFileId: sourceId,
    blockedReason:
      `Sheet ${sourceId} is .xlsx and the service account cannot auto-convert. ` +
      `FIX (pick one): (A) Share this file with ${saEmail} as Editor (single-file share is enough); ` +
      `OR (B) manually do File > Save as Google Sheets in Drive and update ` +
      `clover_loss_year_sheet_pin.source_file_id to the new ID. Errors: ${errors.join(' | ')}`,
  };
}

// ===== Header map + hidden bookkeeping columns =====

const REQUIRED_HEADERS = ['Date Pulled', 'Item Description', 'Quantity', 'lb or ea', 'SRP/item or /lb', 'total'];
const HIDDEN_BOOKKEEPING = ['Clover Line ID', 'Clover Order ID', 'Synced At (UTC)', 'Source'];

export interface TabHeader {
  gid: number;
  tabName: string;
  headerRowIdx: number;
  headerToCol: Map<string, number>;
  totalCols: number;
  cloverLineIds: Set<string>;
}

function colIdxToLetter(idx: number): string {
  let s = '';
  let n = idx + 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function findHeader(map: Map<string, number>, name: string): number | undefined {
  for (const [k, v] of map) if (k.toLowerCase().trim() === name.toLowerCase()) return v;
  return undefined;
}

export async function ensureTabHeader(sheetId: string, tabName: string, gid: number): Promise<TabHeader> {
  type GetVals = { values?: string[][] };
  const rng = await gapi<GetVals>('GET',
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(tabName)}!A1:AZ6`,
  );
  const rows = rng.values || [];
  let headerRowIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].some(c => (c ?? '').toString().trim().toLowerCase() === 'date pulled')) { headerRowIdx = i; break; }
  }
  if (headerRowIdx === -1) {
    throw new Error(`Tab '${tabName}': no 'Date Pulled' header in rows 1-6`);
  }
  const headers = rows[headerRowIdx].map(h => (h ?? '').toString().trim());
  const headerToCol = new Map<string, number>();
  headers.forEach((h, i) => { if (h) headerToCol.set(h, i); });

  for (const req of REQUIRED_HEADERS) {
    if (findHeader(headerToCol, req) === undefined) {
      throw new Error(`Tab '${tabName}': missing required header '${req}'. Found: [${headers.join(', ')}]`);
    }
  }

  const missing = HIDDEN_BOOKKEEPING.filter(h => findHeader(headerToCol, h) === undefined);
  let totalCols = headers.length;
  if (missing.length > 0) {
    const startCol = headers.length;
    const range = `${tabName}!${colIdxToLetter(startCol)}${headerRowIdx + 1}`;
    await gapi('PUT',
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
      { values: [missing], majorDimension: 'ROWS' },
    );
    missing.forEach((h, i) => headerToCol.set(h, startCol + i));
    totalCols += missing.length;
    await gapi('POST', `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`, {
      requests: missing.map((_, i) => ({
        updateDimensionProperties: {
          range: { sheetId: gid, dimension: 'COLUMNS', startIndex: startCol + i, endIndex: startCol + i + 1 },
          properties: { hiddenByUser: true },
          fields: 'hiddenByUser',
        },
      })),
    });
  }

  const idCol = findHeader(headerToCol, 'Clover Line ID');
  if (idCol === undefined) throw new Error(`Tab '${tabName}': failed to ensure Clover Line ID column`);
  const idLetter = colIdxToLetter(idCol);
  const idRange = `${tabName}!${idLetter}${headerRowIdx + 2}:${idLetter}`;
  const idRes = await gapi<GetVals>('GET',
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(idRange)}`,
  );
  const cloverLineIds = new Set<string>();
  for (const row of (idRes.values || [])) {
    const id = (row[0] ?? '').toString().trim();
    if (id) cloverLineIds.add(id);
  }

  return { gid, tabName, headerRowIdx, headerToCol, totalCols, cloverLineIds };
}

// ===== Brand/Produce resolver =====

export async function loadBrandLookup(barcodes: string[]): Promise<Map<string, string>> {
  const admin = createAdminClient();
  const out = new Map<string, string>();
  if (!admin || barcodes.length === 0) return out;
  type ProdRow = { barcode: string; category_path: string | null; primary_vendor_id: string | null; brand: string | null };
  const { data: prods } = await admin
    .from('thrive_product_catalog')
    .select('barcode, category_path, primary_vendor_id, brand')
    .in('barcode', barcodes);
  const products = (prods || []) as ProdRow[];
  const vendorIds = Array.from(new Set(products.map(p => p.primary_vendor_id).filter((v): v is string => !!v)));
  let vendorMap = new Map<string, string>();
  if (vendorIds.length > 0) {
    type VendorRow = { thrive_vendor_id: string; name: string };
    const { data: vendors } = await admin
      .from('thrive_vendors')
      .select('thrive_vendor_id, name')
      .in('thrive_vendor_id', vendorIds);
    vendorMap = new Map<string, string>(((vendors || []) as VendorRow[]).map(v => [v.thrive_vendor_id, v.name]));
  }
  for (const p of products) {
    let resolved = '';
    const cat = (p.category_path || '').toString().toLowerCase();
    if (cat.includes('produce')) resolved = 'Produce';
    else if (p.primary_vendor_id && vendorMap.has(p.primary_vendor_id)) resolved = vendorMap.get(p.primary_vendor_id) || '';
    else if (p.brand) resolved = p.brand;
    if (resolved) out.set(p.barcode, resolved);
  }
  return out;
}

// ===== Clover Item code (UPC) lookup =====

async function fetchCloverItemCodes(itemIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (itemIds.length === 0) return out;
  const mid = process.env.NATURES_STOREHOUSE_MID;
  const token = process.env.NATURES_STOREHOUSE_TOKEN;
  if (!mid || !token) return out;
  for (const id of itemIds) {
    try {
      const r = await fetch(`https://api.clover.com/v3/merchants/${mid}/items/${id}?fields=id,code`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) continue;
      const d = await r.json() as { code?: string };
      if (d.code) out.set(id, d.code);
    } catch { /* skip */ }
  }
  return out;
}

// ===== Helpers =====

function fmtUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
function localDate(epochMs: number): string {
  return new Date(epochMs).toLocaleDateString('en-US', {
    timeZone: 'America/New_York', month: 'numeric', day: 'numeric', year: 'numeric',
  });
}
function localMonth(epochMs: number): string {
  return new Date(epochMs).toLocaleString('en-US', { timeZone: 'America/New_York', month: '2-digit' });
}

// ===== Runner =====

const LOCK_TIMEOUT_MS = 9 * 60 * 1000;
const CURSOR_OVERLAP_MS = 5 * 60 * 1000;
const BACKFILL_FALLBACK_MS = 24 * 60 * 60 * 1000;

export interface RunResult {
  ok: boolean;
  startedAt: string;
  finishedAt: string;
  elapsedMs: number;
  sheetId: string;
  ordersScanned: number;
  lineItemsSeen: number;
  rowsAppended: number;
  rowsSkippedDup: number;
  perTab: Record<string, number>;
  errors: string[];
  blocked?: string;
}

export async function runLossSync(): Promise<RunResult> {
  const startedAt = new Date();
  const startMs = startedAt.getTime();
  const errors: string[] = [];
  const perTab: Record<string, number> = {};
  let ordersScanned = 0, lineItemsSeen = 0, rowsAppended = 0, rowsSkippedDup = 0;
  let sheetIdResolved = '';
  let blocked: string | undefined;

  const admin = createAdminClient();
  if (!admin) throw new Error('Supabase admin client unavailable');

  type RunRow = { run_id: string };
  const { data: runRow } = await admin
    .from('clover_loss_run_log')
    .insert({ status: 'running', started_at: startedAt.toISOString() })
    .select('run_id')
    .maybeSingle();
  const runId: string | null = (runRow as RunRow | null)?.run_id ?? null;

  try {
    const { data: cursor } = await admin.from('clover_loss_cursor').select('*').eq('id', 1).maybeSingle();
    const cur = cursor as { last_processed_at_ms?: number; locked_until?: string | null } | null;
    if (cur?.locked_until && new Date(cur.locked_until) > new Date()) {
      throw new Error(`Another run holds the lock until ${cur.locked_until}`);
    }
    const lockUntil = new Date(Date.now() + LOCK_TIMEOUT_MS).toISOString();
    await admin.from('clover_loss_cursor').update({ locked_until: lockUntil }).eq('id', 1);

    const year = parseInt(new Date().toLocaleString('en-US', { timeZone: 'America/New_York', year: 'numeric' }), 10);
    const sheet = await resolveSheet(year);
    sheetIdResolved = sheet.sheetId;
    if (!sheet.isNative) {
      blocked = sheet.blockedReason;
      throw new Error(`SHEET_BLOCKED: ${blocked}`);
    }

    type SheetMeta = { sheets: Array<{ properties: { sheetId: number; title: string } }> };
    const sheetMeta = await gapi<SheetMeta>('GET',
      `https://sheets.googleapis.com/v4/spreadsheets/${sheet.sheetId}?fields=sheets.properties`,
    );
    const tabGidMap = new Map<string, number>();
    for (const s of sheetMeta.sheets || []) tabGidMap.set(s.properties.title, s.properties.sheetId);

    const tabHeaders = new Map<string, TabHeader>();
    for (const rt of LOSS_DISCOUNT_ROUTING) {
      const gid = tabGidMap.get(rt.tab);
      if (gid === undefined) throw new Error(`Tab '${rt.tab}' not found in sheet ${sheet.sheetId}`);
      const th = await ensureTabHeader(sheet.sheetId, rt.tab, gid);
      tabHeaders.set(rt.tab, th);
      perTab[rt.tab] = 0;
    }

    const cursorMs = cur?.last_processed_at_ms || (Date.now() - BACKFILL_FALLBACK_MS);
    const sinceMs = cursorMs - CURSOR_OVERLAP_MS;
    const untilMs = Date.now();

    const orders = await fetchOrdersByModifiedTime(sinceMs, untilMs);
    ordersScanned = orders.length;

    interface Cand { order: CloverOrder; li: CloverLineItem; routing: LossDiscountConfig; discIdx: number }
    const candidates: Cand[] = [];
    const itemIdSet = new Set<string>();
    for (const o of orders) {
      for (const li of (o.lineItems?.elements || [])) {
        lineItemsSeen++;
        const discs = (li.discounts?.elements ?? []);
        for (let d = 0; d < discs.length; d++) {
          const name = discs[d]?.name || '';
          const rt = LOSS_DISCOUNT_ROUTING.find(r => r.name === name);
          if (rt) {
            if (li.item?.id) itemIdSet.add(li.item.id);
            candidates.push({ order: o, li, routing: rt, discIdx: d });
          }
        }
      }
    }

    const upcByItemId = await fetchCloverItemCodes(Array.from(itemIdSet));
    const barcodes = Array.from(new Set(Array.from(upcByItemId.values()).filter((u): u is string => !!u)));
    const brandLookup = await loadBrandLookup(barcodes);

    const appendBatches = new Map<string, unknown[][]>();
    for (const t of tabHeaders.keys()) appendBatches.set(t, []);
    const supabaseDedupRows: Record<string, unknown>[] = [];

    for (const cand of candidates) {
      const th = tabHeaders.get(cand.routing.tab)!;
      const lineId = cand.li.id;
      if (th.cloverLineIds.has(lineId)) { rowsSkippedDup++; continue; }

      const { data: existing } = await admin
        .from('clover_loss_processed_lines')
        .select('line_item_id')
        .eq('order_id', cand.order.id)
        .eq('line_item_id', lineId)
        .eq('discount_idx', cand.discIdx)
        .maybeSingle();
      if (existing) { rowsSkippedDup++; continue; }

      const unitQty = cand.li.unitQty;
      const qty = unitQty != null ? Number((unitQty / 1000).toFixed(3)) : (cand.li.quantity ?? 1);
      const lbOrEa = unitQty != null ? 'lb' : 'ea';
      const price = cand.li.price ?? 0;
      const totalCents = Math.round(price * qty);
      const itemId = cand.li.item?.id;
      const upc = itemId ? (upcByItemId.get(itemId) || '') : '';
      const brandProduce = upc ? (brandLookup.get(upc) || '') : '';
      const dateMs = cand.order.modifiedTime || cand.order.createdTime || Date.now();
      const row: Record<string, unknown> = {
        'Date Pulled': localDate(dateMs),
        'Brand/Produce': brandProduce,
        'Item Description': cand.li.name || '',
        'UPC Code': upc,
        'Quantity': qty,
        'lb or ea': lbOrEa,
        'SRP/item or /lb': fmtUsd(price),
        'total': fmtUsd(totalCents),
        'Comments/Notes': cand.routing.name,
        '(For Dan)': '',
        'Month': localMonth(dateMs),
        'Inventory Adjustment': fmtUsd(totalCents),
        'Clover Line ID': lineId,
        'Clover Order ID': cand.order.id,
        'Synced At (UTC)': new Date().toISOString(),
        'Source': 'clover-cron',
      };
      const cols: unknown[] = new Array(th.totalCols).fill('');
      for (const [k, v] of Object.entries(row)) {
        const idx = findHeader(th.headerToCol, k);
        if (idx !== undefined) cols[idx] = v;
      }
      appendBatches.get(cand.routing.tab)!.push(cols);
      th.cloverLineIds.add(lineId);
      supabaseDedupRows.push({
        order_id: cand.order.id,
        line_item_id: lineId,
        discount_idx: cand.discIdx,
        discount_name: cand.routing.name,
        target_tab: cand.routing.tab,
        sheet_id: sheet.sheetId,
        appended_at: new Date().toISOString(),
      });
    }

    for (const [tab, batch] of appendBatches) {
      if (batch.length === 0) continue;
      const range = `${tab}!A:Z`;
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheet.sheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
      await gapi('POST', url, { values: batch, majorDimension: 'ROWS' });
      perTab[tab] = batch.length;
      rowsAppended += batch.length;
    }

    if (supabaseDedupRows.length > 0) {
      await admin.from('clover_loss_processed_lines').upsert(supabaseDedupRows, { onConflict: 'order_id,line_item_id,discount_idx' });
    }
    const orderMaxModified = orders.reduce((max, o) => Math.max(max, o.modifiedTime || 0), 0);
    const newCursor = Math.max(orderMaxModified, cursorMs);
    await admin
      .from('clover_loss_cursor')
      .update({ last_processed_at_ms: newCursor, locked_until: null, updated_at: new Date().toISOString() })
      .eq('id', 1);
  } catch (e) {
    errors.push((e as Error).message || String(e));
    try { await admin.from('clover_loss_cursor').update({ locked_until: null }).eq('id', 1); } catch { /* ignore */ }
  }

  const finishedAt = new Date();
  const result: RunResult = {
    ok: errors.length === 0,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    elapsedMs: finishedAt.getTime() - startMs,
    sheetId: sheetIdResolved,
    ordersScanned, lineItemsSeen, rowsAppended, rowsSkippedDup, perTab, errors,
    blocked,
  };
  if (runId) {
    try {
      await admin.from('clover_loss_run_log').update({
        finished_at: finishedAt.toISOString(),
        status: result.ok ? 'ok' : 'failed',
        orders_scanned: ordersScanned,
        line_items_seen: lineItemsSeen,
        rows_appended: rowsAppended,
        rows_skipped_dup: rowsSkippedDup,
        errors_json: errors.length > 0 ? errors : null,
        sheet_id: sheetIdResolved,
      }).eq('run_id', runId);
    } catch { /* ignore log failure */ }
  }
  return result;
}

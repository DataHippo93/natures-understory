// Mon/Thu 6:55 AM ET (10:55 UTC) — pull current Thrive inventory snapshot
// and append to thrive_inventory_snapshot.
//
// GATED: refuses to run until Task #5 (Thrive inventory endpoint discovery)
// completes and the operator sets THRIVE_INVENTORY_PATH_VERIFIED=1 + the
// real INVENTORY_LIST_PATH below. See:
//   docs/specs/thrive_inventory_endpoint.md (in natures-produce-buying repo)
//
// TS twin of natures-produce-buying/scripts/pull_inventory.py

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const maxDuration = 300;

const THRIVE_BASE = 'https://cloud.thrivemetrics.com';
// ⚠️ UNVERIFIED — replace once Task #5 captures the real endpoint
const INVENTORY_LIST_PATH = '/api/v3/inventory/';
const CONFIDENCE_TAU_HOURS = 168; // 7 days

function verify(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.get('authorization');
  return auth === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) { return handler(req); }
export async function POST(req: NextRequest) { return handler(req); }

async function handler(req: NextRequest) {
  if (!verify(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Refuse-to-run gate
  if (process.env.THRIVE_INVENTORY_PATH_VERIFIED !== '1') {
    return NextResponse.json({
      ok: false,
      gated: true,
      reason: 'Thrive inventory endpoint not yet verified. See docs/specs/thrive_inventory_endpoint.md (Task #5). After capture, update INVENTORY_LIST_PATH in this file and set env var THRIVE_INVENTORY_PATH_VERIFIED=1 in Vercel.',
      target_path: INVENTORY_LIST_PATH,
    }, { status: 503 });
  }

  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: 'Admin not configured' }, { status: 500 });

  const startedAt = new Date().toISOString();
  const { data: logEntry } = await admin.from('sync_log').insert({
    sync_type: 'thrive_inventory',
    started_at: startedAt,
  }).select().single();
  const logId: string | undefined = logEntry?.id;

  try {
    const sess = await thriveLogin();
    const rows = await fetchAllInventory(sess);

    const snapshotTs = new Date().toISOString();
    const payload = rows.map((r) => ({
      thrive_item_id: r.thrive_item_id,
      item_name: r.item_name,
      qty_on_hand: r.qty_on_hand,
      unit: r.unit,
      last_counted_at: r.last_counted_at,
      snapshot_ts: snapshotTs,
      source: 'thrive_api',
      api_endpoint: INVENTORY_LIST_PATH,
      raw_response: r.raw,
      confidence: computeConfidence(r.last_counted_at),
      stockout: r.qty_on_hand <= 0,
    }));

    const BATCH = 500;
    for (let i = 0; i < payload.length; i += BATCH) {
      const { error } = await admin.from('thrive_inventory_snapshot').insert(payload.slice(i, i + BATCH));
      if (error) throw new Error(`thrive_inventory_snapshot batch ${i}: ${error.message}`);
    }

    if (logId) {
      await admin.from('sync_log').update({
        completed_at: new Date().toISOString(),
        records_synced: payload.length,
      }).eq('id', logId);
    }

    return NextResponse.json({ ok: true, rows: payload.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (logId) {
      try {
        await admin.from('sync_log').update({
          completed_at: new Date().toISOString(),
          error: message,
        }).eq('id', logId);
      } catch { /* ignore */ }
    }
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// Thrive auth + pull (replace shape once #5 verifies)
// ---------------------------------------------------------------------------

interface ThriveSession {
  csrftoken: string;
  cookieHeader: string;
}

async function thriveLogin(): Promise<ThriveSession> {
  const email = process.env.THRIVE_EMAIL;
  const password = process.env.THRIVE_PASSWORD;
  if (!email || !password) throw new Error('THRIVE_EMAIL / THRIVE_PASSWORD not set');
  const r = await fetch(`${THRIVE_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!r.ok) throw new Error(`thrive login: ${r.status}`);
  const setCookie = r.headers.get('set-cookie') ?? '';
  const csrftoken = matchCookie(setCookie, 'csrftoken');
  const sessionid = matchCookie(setCookie, 'sessionid');
  if (!csrftoken || !sessionid) throw new Error('thrive login missing cookies');
  return {
    csrftoken,
    cookieHeader: `csrftoken=${csrftoken}; sessionid=${sessionid}`,
  };
}

function matchCookie(setCookie: string, name: string): string {
  const m = new RegExp(`${name}=([^;]+)`).exec(setCookie);
  return m ? m[1] : '';
}

interface InventoryRow {
  thrive_item_id: string;
  item_name: string;
  qty_on_hand: number;
  unit: string;
  last_counted_at: string | null;
  raw: Record<string, unknown>;
}

async function fetchAllInventory(sess: ThriveSession): Promise<InventoryRow[]> {
  const out: InventoryRow[] = [];
  let url: string | null = `${THRIVE_BASE}${INVENTORY_LIST_PATH}`;
  while (url) {
    const r = await fetch(url, {
      headers: { Accept: 'application/json', Cookie: sess.cookieHeader },
      signal: AbortSignal.timeout(20_000),
    });
    if (!r.ok) throw new Error(`inventory GET ${url}: ${r.status}`);
    const j = (await r.json()) as { results?: Array<Record<string, unknown>>; next?: string | null };
    for (const row of j.results ?? []) {
      out.push({
        thrive_item_id: String(row.id ?? row.item_id ?? ''),
        item_name: String(row.name ?? row.item_name ?? ''),
        qty_on_hand: Number(row.qty_on_hand ?? row.quantity ?? 0),
        unit: String(row.unit ?? ''),
        last_counted_at: (row.last_counted_at as string | null) ?? (row.counted_at as string | null) ?? null,
        raw: row,
      });
    }
    url = j.next ?? null;
  }
  return out;
}

function computeConfidence(lastCountedIso: string | null): number {
  if (!lastCountedIso) return 0;
  const ts = new Date(lastCountedIso).getTime();
  if (!Number.isFinite(ts)) return 0;
  const hours = (Date.now() - ts) / 3_600_000;
  if (hours < 0) return 1.0;
  return Math.round(Math.exp(-hours / CONFIDENCE_TAU_HOURS) * 1000) / 1000;
}

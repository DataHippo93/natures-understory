// app/api/cron/thrive-sync-health/route.ts
// Vercel cron: daily 0 8 * * *. Audits every thrive_* table for freshness and
// recent cron failures; writes one summary row to thrive_sync_health and
// optionally pings Dispatch when overall status is RED.
//
// Created 2026-06-10 by Claude session local_4cc14fae as Phase 3 of the
// Thrive/Supabase data integrity audit (`outputs/thrive_supabase_data_integrity_audit.md`).
// Purpose: catch the silent failure class that this audit had to find by hand —
// crons that stop firing without raising any error. Compares actual freshness
// + row growth against per-table expectations.

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const maxDuration = 60;

type Status = 'green' | 'yellow' | 'red';

interface TableCheck {
  table: string;
  rows: number | null;
  latest_fetch: string | null;
  hours_since_fetch: number | null;
  fresh_threshold_hours: number;
  status: Status;
  reason: string;
}

interface CronCheck {
  sync_type: string;
  runs_24h: number;
  errors_24h: number;
  error_pct: number;
  last_run_at: string | null;
  status: Status;
  reason: string;
}

// Per-table freshness contracts. If `latest_fetch_at` is older than the
// threshold, the table goes RED.
const TABLE_CONTRACTS: Array<{
  table: string;
  freshness_col: string;
  freshness_threshold_hours: number;
  expected_cron: string;
}> = [
  { table: 'thrive_sales_history',     freshness_col: 'fetched_at',      freshness_threshold_hours: 28, expected_cron: 'thrive_sales' },
  { table: 'thrive_inventory_history', freshness_col: 'snapshot_ts',     freshness_threshold_hours: 8,  expected_cron: 'thrive_inventory' },
  { table: 'thrive_product_catalog',   freshness_col: 'fetched_at',      freshness_threshold_hours: 28, expected_cron: 'thrive_catalog' },
  { table: 'thrive_vendors',           freshness_col: 'fetched_at',      freshness_threshold_hours: 28, expected_cron: 'thrive_vendors' },
  { table: 'thrive_po_status',         freshness_col: 'fetched_at',      freshness_threshold_hours: 8,  expected_cron: 'thrive_po_status' },
  { table: 'thrive_session_state',     freshness_col: 'last_used_at',    freshness_threshold_hours: 48, expected_cron: '(playwright login)' },
];

// Crons we audit for error-rate / non-execution.
const CRON_CONTRACTS: Array<{
  sync_type: string;
  expected_runs_24h: number;
  max_error_pct: number;
}> = [
  { sync_type: 'thrive_sales',          expected_runs_24h: 1, max_error_pct: 0  },
  { sync_type: 'thrive_inventory',      expected_runs_24h: 4, max_error_pct: 20 },
  { sync_type: 'thrive_catalog',        expected_runs_24h: 1, max_error_pct: 0  },
  { sync_type: 'thrive_vendors',        expected_runs_24h: 1, max_error_pct: 0  },
  { sync_type: 'thrive_po_status',      expected_runs_24h: 4, max_error_pct: 20 },
];

function verify(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.get('authorization');
  return auth === `Bearer ${secret}`;
}

async function checkTable(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  contract: typeof TABLE_CONTRACTS[number],
): Promise<TableCheck> {
  const { count, error: cntErr } = await admin
    .from(contract.table)
    .select('*', { count: 'exact', head: true });

  const { data: latestRow, error: freshErr } = await admin
    .from(contract.table)
    .select(contract.freshness_col)
    .order(contract.freshness_col, { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  if (cntErr || freshErr) {
    return {
      table: contract.table,
      rows: null,
      latest_fetch: null,
      hours_since_fetch: null,
      fresh_threshold_hours: contract.freshness_threshold_hours,
      status: 'red',
      reason: `query failed: ${(cntErr?.message ?? '') + (freshErr?.message ?? '')}`,
    };
  }

  const latestFetchStr = (latestRow as Record<string, unknown> | null)?.[contract.freshness_col] as string | undefined;
  const latestFetchMs = latestFetchStr ? new Date(latestFetchStr).getTime() : null;
  const hoursSince = latestFetchMs ? (Date.now() - latestFetchMs) / 3_600_000 : null;

  let status: Status = 'green';
  let reason = 'fresh';
  if (hoursSince === null) {
    status = 'red';
    reason = 'no rows or no fresh column';
  } else if (hoursSince > contract.freshness_threshold_hours) {
    status = 'red';
    reason = `stale ${hoursSince.toFixed(1)}h (threshold ${contract.freshness_threshold_hours}h)`;
  } else if (hoursSince > contract.freshness_threshold_hours * 0.8) {
    status = 'yellow';
    reason = `approaching threshold (${hoursSince.toFixed(1)}h / ${contract.freshness_threshold_hours}h)`;
  }

  return {
    table: contract.table,
    rows: count ?? null,
    latest_fetch: latestFetchStr ?? null,
    hours_since_fetch: hoursSince === null ? null : Number(hoursSince.toFixed(2)),
    fresh_threshold_hours: contract.freshness_threshold_hours,
    status,
    reason,
  };
}

async function checkCron(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  contract: typeof CRON_CONTRACTS[number],
): Promise<CronCheck> {
  const since = new Date(Date.now() - 24 * 3_600_000).toISOString();
  const { data, error } = await admin
    .from('sync_log')
    .select('error, started_at')
    .eq('sync_type', contract.sync_type)
    .gte('started_at', since)
    .order('started_at', { ascending: false });

  if (error) {
    return {
      sync_type: contract.sync_type,
      runs_24h: 0,
      errors_24h: 0,
      error_pct: 0,
      last_run_at: null,
      status: 'red',
      reason: `sync_log query failed: ${error.message}`,
    };
  }

  const rows = data ?? [];
  const errors = rows.filter((r) => r.error !== null).length;
  const errPct = rows.length ? (100 * errors) / rows.length : 0;
  const lastRunAt = rows[0]?.started_at ?? null;

  let status: Status = 'green';
  let reason = 'ok';
  if (rows.length < contract.expected_runs_24h) {
    status = 'red';
    reason = `only ${rows.length}/${contract.expected_runs_24h} expected runs in last 24h`;
  } else if (errPct > contract.max_error_pct) {
    status = 'red';
    reason = `${errPct.toFixed(0)}% errors (threshold ${contract.max_error_pct}%)`;
  } else if (errPct > 0) {
    status = 'yellow';
    reason = `${errPct.toFixed(0)}% errors`;
  }

  return {
    sync_type: contract.sync_type,
    runs_24h: rows.length,
    errors_24h: errors,
    error_pct: Number(errPct.toFixed(2)),
    last_run_at: lastRunAt,
    status,
    reason,
  };
}

function rollup(...statuses: Status[]): Status {
  if (statuses.includes('red')) return 'red';
  if (statuses.includes('yellow')) return 'yellow';
  return 'green';
}

async function postDispatch(payload: { overall_status: Status; summary: string }): Promise<{ ok: boolean; status?: number; error?: string }> {
  const url = process.env.DISPATCH_WEBHOOK_URL;
  if (!url) return { ok: false, error: 'DISPATCH_WEBHOOK_URL not configured (skipping)' };
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        source: 'thrive-sync-health',
        severity: payload.overall_status,
        message: payload.summary,
        sent_at: new Date().toISOString(),
      }),
    });
    return { ok: res.ok, status: res.status };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

async function handler(req: NextRequest) {
  if (!verify(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: 'Admin client not configured' }, { status: 500 });
  }

  const tableChecks = await Promise.all(TABLE_CONTRACTS.map((c) => checkTable(admin, c)));
  const cronChecks = await Promise.all(CRON_CONTRACTS.map((c) => checkCron(admin, c)));

  const overall = rollup(...tableChecks.map((t) => t.status), ...cronChecks.map((c) => c.status));
  const redCount = [...tableChecks, ...cronChecks].filter((x) => x.status === 'red').length;
  const yellowCount = [...tableChecks, ...cronChecks].filter((x) => x.status === 'yellow').length;

  const summary = overall === 'green'
    ? `All ${tableChecks.length} thrive tables + ${cronChecks.length} thrive crons GREEN.`
    : `THRIVE HEALTH ${overall.toUpperCase()}: ${redCount} red, ${yellowCount} yellow. ` +
      [...tableChecks, ...cronChecks]
        .filter((x) => x.status !== 'green')
        .map((x) => `${'table' in x ? x.table : (x as CronCheck).sync_type}=${x.reason}`)
        .join(' | ');

  const { error: insErr } = await admin.from('thrive_sync_health').insert({
    overall_status: overall,
    red_count: redCount,
    yellow_count: yellowCount,
    table_checks: tableChecks,
    cron_checks: cronChecks,
    summary,
  });

  let dispatch: { ok: boolean; status?: number; error?: string } = { ok: false, error: 'not attempted (green)' };
  if (overall === 'red') {
    dispatch = await postDispatch({ overall_status: overall, summary });
  }

  return NextResponse.json({
    ok: true,
    overall_status: overall,
    red_count: redCount,
    yellow_count: yellowCount,
    summary,
    table_checks: tableChecks,
    cron_checks: cronChecks,
    insert_error: insErr?.message ?? null,
    dispatch,
  });
}

export async function GET(req: NextRequest)  { return handler(req); }
export async function POST(req: NextRequest) { return handler(req); }

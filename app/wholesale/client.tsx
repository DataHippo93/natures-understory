'use client';

// Wholesale Pricing Manager — spreadsheet-fast grid + auto-populated recipients + pricelists.
// Optimistic edits with per-cell sync badges; commits are debounced 500ms and
// hit /api/wholesale/* which enforce the wholesale_manager/admin role.
//
// v7.4 (2026-07-07): variant-level checkbox + read-only Recipients tab.
// v7.5 (2026-07-07): pricelist modal shows Copy plain text button; draft
//   includes both htmlBody and textBody (backend renders symmetric Retail /
//   Your price / Save% columns in both formats).
// v7.6 (2026-07-08):
//   - Recipients tab surfaces API errors instead of hanging on "Loading customers…"
//     (backend now returns 200 with an `error` field on Shopify failure).
//   - Pricelist generate button surfaces errors instead of silently doing
//     nothing on a 502.
//   - Export CSV button (item · variant · retail · tier1 · tier2 · wholesale_active)
//     triggers a client-side download via <a download> — no server round-trip,
//     no popup-blocked window.open.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type Tier = 't1' | 't2';

interface GridRow {
  productId: string;
  productTitle: string;
  variantId: string;
  variantTitle: string;
  retail: string;
  tier1: string | null;
  tier2: string | null;
  wholesaleActive: boolean;
}

interface Recipient {
  customerId: string;
  email: string;
  displayName: string;
  companyName: string;
  t1: boolean;
  t2: boolean;
  optedOut: boolean;
}

interface PricelistDraft {
  subject: string;
  htmlBody: string;
  textBody: string; // v7.5
  bcc: string[];
  itemCount: number;
}

type CellField = 'retail' | 't1' | 't2';
type SyncState = 'idle' | 'syncing' | 'synced' | 'error';

const DEBOUNCE_MS = 500;
const PRICE_RE = /^\d+(\.\d{1,2})?$/;

const fmt = (v: string | null) => (v === null || v === '' ? '' : Number(v).toFixed(2));

export default function WholesaleClient() {
  const [tab, setTab] = useState<'pricing' | 'recipients'>('pricing');
  const [rows, setRows] = useState<GridRow[] | null>(null);
  const [recipients, setRecipients] = useState<Recipient[] | null>(null);
  const [suppressedCount, setSuppressedCount] = useState<number>(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [recipientsError, setRecipientsError] = useState<string | null>(null);
  const [sync, setSync] = useState<Record<string, SyncState>>({});
  const [filter, setFilter] = useState<'active' | 'all'>('active');
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState<(PricelistDraft & { tier: Tier }) | null>(null);
  const [generating, setGenerating] = useState<Tier | null>(null);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const loadGrid = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch('/api/wholesale/grid');
      const data = await res.json();
      if (!res.ok) setLoadError(data.error ?? `Failed to load (HTTP ${res.status})`);
      else setRows(data.rows);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load');
    }
  }, []);

  const loadRecipients = useCallback(async () => {
    setRecipientsError(null);
    try {
      const res = await fetch('/api/wholesale/recipients');
      const data = await res.json();
      // v7.6: route returns 200 with { recipients, suppressedCount, error? }
      // even on Shopify failure. Populate what we can and surface the error.
      setRecipients(data.recipients ?? []);
      setSuppressedCount(data.suppressedCount ?? 0);
      if (data.error) setRecipientsError(data.error);
      else if (!res.ok) setRecipientsError(`Failed to load (HTTP ${res.status})`);
    } catch (e) {
      // Network / JSON error — still exit the loading state so we don't spin forever.
      setRecipients([]);
      setRecipientsError(e instanceof Error ? e.message : 'Failed to load recipients');
    }
  }, []);

  useEffect(() => {
    loadGrid();
  }, [loadGrid]);

  useEffect(() => {
    if (tab === 'recipients' && recipients === null) loadRecipients();
  }, [tab, recipients, loadRecipients]);

  const visible = useMemo(() => {
    if (!rows) return [];
    const q = search.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (filter === 'all' || r.wholesaleActive) &&
        (q === '' ||
          r.productTitle.toLowerCase().includes(q) ||
          r.variantTitle.toLowerCase().includes(q))
    );
  }, [rows, filter, search]);

  const setCell = useCallback((key: string, state: SyncState) => {
    setSync((s) => ({ ...s, [key]: state }));
    if (state === 'synced') {
      setTimeout(() => setSync((s) => ({ ...s, [key]: 'idle' })), 1500);
    }
  }, []);

  const commit = useCallback(
    (row: GridRow, field: CellField, raw: string) => {
      const key = `${row.variantId}:${field}`;
      const value = raw.trim();
      if (value !== '' && !PRICE_RE.test(value)) {
        setCell(key, 'error');
        return;
      }
      if (field === 'retail' && value === '') return; // retail can't be cleared

      setRows((rs) =>
        rs!.map((r) =>
          r.variantId !== row.variantId
            ? r
            : field === 'retail'
              ? { ...r, retail: value }
              : field === 't1'
                ? { ...r, tier1: value || null }
                : { ...r, tier2: value || null }
        )
      );

      clearTimeout(timers.current[key]);
      timers.current[key] = setTimeout(async () => {
        setCell(key, 'syncing');
        const res = await fetch('/api/wholesale/price', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            kind: field,
            productId: row.productId,
            variantId: row.variantId,
            amount: value === '' ? null : value,
          }),
        });
        setCell(key, res.ok ? 'synced' : 'error');
      }, DEBOUNCE_MS);
    },
    [setCell]
  );

  // v7.4: variant-level toggle. Only the current row flips.
  const toggle = useCallback(async (row: GridRow) => {
    const next = !row.wholesaleActive;
    setRows((rs) =>
      rs!.map((r) => (r.variantId === row.variantId ? { ...r, wholesaleActive: next } : r))
    );
    const res = await fetch('/api/wholesale/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ variantId: row.variantId, active: next }),
    });
    if (!res.ok) {
      setRows((rs) =>
        rs!.map((r) => (r.variantId === row.variantId ? { ...r, wholesaleActive: !next } : r))
      );
    } else if (!next) {
      // cleared tier prices server-side; reflect locally on THIS variant only
      setRows((rs) =>
        rs!.map((r) =>
          r.variantId === row.variantId ? { ...r, tier1: null, tier2: null } : r
        )
      );
    }
  }, []);

  const generate = useCallback(async (tier: Tier) => {
    setGenerating(tier);
    setLoadError(null);
    try {
      const res = await fetch(`/api/wholesale/pricelist?tier=${tier}`);
      const data = await res.json();
      setGenerating(null);
      if (res.ok) setDraft({ ...data, tier });
      else setLoadError(data.error ?? `Pricelist generation failed (HTTP ${res.status})`);
    } catch (e) {
      setGenerating(null);
      setLoadError(e instanceof Error ? e.message : 'Pricelist generation failed');
    }
  }, []);

  // v7.6: client-side CSV export — no server round-trip, no popup-blocked
  // window.open. Uses a synthetic <a download> anchor so the browser routes
  // the file straight to the user's Downloads folder.
  const exportCsv = useCallback(() => {
    if (!rows || rows.length === 0) return;
    const header = ['item', 'variant', 'retail', 'tier1', 'tier2', 'wholesale_active'];
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const lines = [
      header.join(','),
      ...rows.map((r) =>
        [
          esc(r.productTitle),
          esc(r.variantTitle === 'Default Title' ? '' : r.variantTitle),
          r.retail,
          r.tier1 ?? '',
          r.tier2 ?? '',
          r.wholesaleActive ? 'true' : 'false',
        ].join(',')
      ),
    ];
    // Prepend UTF-8 BOM so Excel opens accented characters correctly.
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wholesale-pricelist-${new Date().toISOString().slice(0, 10)}.csv`;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [rows]);

  const badge = (key: string) => {
    const s = sync[key] ?? 'idle';
    if (s === 'syncing') return <span className="ml-1 text-xs" style={{ color: 'var(--gold)' }}>⟳</span>;
    if (s === 'synced') return <span className="ml-1 text-xs" style={{ color: 'var(--sage)' }}>✓</span>;
    if (s === 'error')
      return (
        <span className="ml-1 text-xs" title="Sync failed — re-enter to retry" style={{ color: '#b06060' }}>
          !
        </span>
      );
    return null;
  };

  const inputStyle: React.CSSProperties = {
    background: 'var(--forest-dark)',
    border: '1px solid var(--forest-mid)',
    borderRadius: 6,
    color: 'var(--cream)',
    padding: '4px 8px',
    width: '6rem',
    textAlign: 'right',
  };

  const cell = (row: GridRow, field: CellField, value: string, disabled: boolean) => (
    <td className="whitespace-nowrap px-2 py-1">
      <input
        key={`${row.variantId}:${field}:${value}`}
        defaultValue={value}
        inputMode="decimal"
        disabled={disabled}
        aria-label={`${row.productTitle} ${row.variantTitle} ${field}`}
        onBlur={(e) => e.target.value !== value && commit(row, field, e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
        style={{ ...inputStyle, opacity: disabled ? 0.35 : 1 }}
      />
      {badge(`${row.variantId}:${field}`)}
    </td>
  );

  const tabButton = (id: 'pricing' | 'recipients', label: string) => (
    <button
      type="button"
      onClick={() => setTab(id)}
      className="rounded-md px-3 py-1.5 text-sm font-medium"
      style={
        tab === id
          ? { background: 'var(--forest-hover)', color: 'var(--cream)', border: '1px solid var(--gold)' }
          : { color: 'var(--sage)', border: '1px solid var(--forest-mid)' }
      }
    >
      {label}
    </button>
  );

  const tierList = (tier: Tier) => {
    const label = tier === 't1' ? 'Tier 1' : 'Tier 2';
    const filtered = (recipients ?? []).filter((r) => !r.optedOut && (tier === 't1' ? r.t1 : r.t2));
    return (
      <div className="flex-1 min-w-[280px]">
        <h3 className="mb-2 text-sm font-semibold" style={{ color: 'var(--cream)' }}>
          {label} recipients ({filtered.length})
        </h3>
        {filtered.length === 0 ? (
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            No subscribed customers on {label} catalog yet.
          </p>
        ) : (
          <ul className="space-y-1 text-sm">
            {filtered.map((r) => (
              <li key={r.customerId} style={{ color: 'var(--cream)' }}>
                <span>{r.displayName}</span>
                <span style={{ color: 'var(--text-muted)' }}> — {r.email}</span>
                <span style={{ color: 'var(--sage)' }}> — {r.companyName}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--cream)', fontFamily: 'var(--font-josefin)' }}>
            Wholesale Pricing
          </h1>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Edits sync straight to Shopify — retail, Tier 1, Tier 2
          </p>
        </div>
        <div className="flex gap-2">
          {tabButton('pricing', 'Pricing')}
          {tabButton('recipients', 'Recipients')}
        </div>
      </div>

      {loadError && (
        <div className="rounded-md px-4 py-3 text-sm" style={{ background: 'rgba(176,96,96,0.12)', color: '#b06060', border: '1px solid rgba(176,96,96,0.25)' }}>
          {loadError} — <button type="button" className="underline" onClick={loadGrid}>retry</button>
        </div>
      )}

      {tab === 'pricing' && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <input
              placeholder="Search items…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ ...inputStyle, width: '16rem', textAlign: 'left' }}
            />
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as 'active' | 'all')}
              style={{ ...inputStyle, width: 'auto', textAlign: 'left' }}
            >
              <option value="active">Wholesale items</option>
              <option value="all">All items</option>
            </select>
            <div className="ml-auto flex gap-2">
              <button
                type="button"
                onClick={exportCsv}
                disabled={!rows || rows.length === 0}
                className="rounded-md px-3 py-1.5 text-sm font-medium"
                style={{
                  background: 'var(--sage)',
                  color: '#082a1b',
                  opacity: !rows || rows.length === 0 ? 0.5 : 1,
                }}
                title="Download all items as CSV (item, variant, retail, tier1, tier2, wholesale_active)"
              >
                Export CSV
              </button>
              <button
                type="button"
                onClick={() => generate('t1')}
                disabled={generating !== null}
                className="rounded-md px-3 py-1.5 text-sm font-medium"
                style={{ background: 'var(--gold)', color: '#082a1b' }}
              >
                {generating === 't1' ? 'Generating…' : 'Tier 1 Pricelist'}
              </button>
              <button
                type="button"
                onClick={() => generate('t2')}
                disabled={generating !== null}
                className="rounded-md px-3 py-1.5 text-sm font-medium"
                style={{ background: 'var(--gold)', color: '#082a1b' }}
              >
                {generating === 't2' ? 'Generating…' : 'Tier 2 Pricelist'}
              </button>
            </div>
          </div>

          {rows === null && !loadError ? (
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading grid…</p>
          ) : (
            <div className="overflow-x-auto rounded-lg" style={{ border: '1px solid var(--forest-mid)' }}>
              <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'var(--forest-darkest)', color: 'var(--sage)' }}>
                    <th className="px-3 py-2 text-center font-medium">Wholesale?</th>
                    <th className="px-3 py-2 text-left font-medium">Item</th>
                    <th className="px-3 py-2 text-left font-medium">Variant</th>
                    <th className="px-3 py-2 text-right font-medium">Retail</th>
                    <th className="px-3 py-2 text-right font-medium">Tier 1</th>
                    <th className="px-3 py-2 text-right font-medium">Tier 2</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((row) => (
                    <tr
                      key={row.variantId}
                      style={{
                        borderTop: '1px solid var(--forest-mid)',
                        opacity: row.wholesaleActive ? 1 : 0.5,
                      }}
                    >
                      <td className="px-3 py-1 text-center">
                        <input
                          type="checkbox"
                          checked={row.wholesaleActive}
                          onChange={() => toggle(row)}
                          aria-label={`${row.productTitle} ${row.variantTitle} wholesale active`}
                        />
                      </td>
                      <td className="px-3 py-1" style={{ color: 'var(--cream)' }}>{row.productTitle}</td>
                      <td className="px-3 py-1" style={{ color: 'var(--text-muted)' }}>
                        {row.variantTitle === 'Default Title' ? '—' : row.variantTitle}
                      </td>
                      {cell(row, 'retail', fmt(row.retail), false)}
                      {cell(row, 't1', fmt(row.tier1), !row.wholesaleActive)}
                      {cell(row, 't2', fmt(row.tier2), !row.wholesaleActive)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {rows !== null && (
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {visible.length} of {rows.length} rows · greyed rows aren&apos;t wholesale-active — toggle to enable tier pricing ·
              blank tier cell = customer pays retail
            </p>
          )}
        </>
      )}

      {tab === 'recipients' && (
        <div className="space-y-4">
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Auto-mirrored from Shopify B2B: customers whose Company Location is
            assigned to the Tier 1 or Tier 2 catalog. To add or remove a recipient,
            edit the customer&apos;s Company assignment in Shopify Admin. Opt-outs
            (marketingState ≠ subscribed) are hidden.
          </p>
          {recipientsError && (
            <div
              className="rounded-md px-4 py-3 text-sm"
              style={{
                background: 'rgba(176,96,96,0.12)',
                color: '#b06060',
                border: '1px solid rgba(176,96,96,0.25)',
              }}
            >
              <div className="mb-1 font-medium">Couldn&apos;t load recipients from Shopify</div>
              <div className="text-xs" style={{ color: '#c88888' }}>
                {recipientsError}
              </div>
              <div className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                Most common cause: the LoPro app is missing the{' '}
                <code style={{ color: 'var(--sage)' }}>read_companies</code> admin
                scope, or the store has no B2B Companies configured yet. Grant the
                scope in Shopify Admin → Apps → LoPro → API scopes, then{' '}
                <button
                  type="button"
                  className="underline"
                  onClick={() => {
                    setRecipients(null);
                    loadRecipients();
                  }}
                >
                  retry
                </button>
                .
              </div>
            </div>
          )}
          {recipients === null ? (
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading customers…</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-6">
                {tierList('t1')}
                {tierList('t2')}
              </div>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Suppressed (opted out of email) — {suppressedCount} hidden
              </p>
            </>
          )}
        </div>
      )}

      {draft && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.6)' }}
          onClick={() => setDraft(null)}
        >
          <div
            className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-lg p-5"
            style={{ background: 'var(--forest-darkest)', border: '1px solid var(--forest-mid)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-semibold" style={{ color: 'var(--cream)' }}>
                {draft.tier === 't1' ? 'Tier 1' : 'Tier 2'} pricelist · {draft.itemCount} items · {draft.bcc.length} recipients
              </h2>
              <button type="button" onClick={() => setDraft(null)} style={{ color: 'var(--sage)' }}>✕</button>
            </div>
            <div className="mb-3 flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-md px-3 py-1.5 text-sm font-medium"
                style={{ background: 'var(--gold)', color: '#082a1b' }}
                onClick={() => navigator.clipboard.writeText(draft.bcc.join(', '))}
              >
                Copy BCC list
              </button>
              <button
                type="button"
                className="rounded-md px-3 py-1.5 text-sm font-medium"
                style={{ background: 'var(--gold)', color: '#082a1b' }}
                onClick={() => navigator.clipboard.writeText(draft.subject)}
              >
                Copy subject
              </button>
              <button
                type="button"
                className="rounded-md px-3 py-1.5 text-sm font-medium"
                style={{ background: 'var(--gold)', color: '#082a1b' }}
                onClick={() => {
                  const blob = new Blob([draft.htmlBody], { type: 'text/html' });
                  navigator.clipboard.write([
                    new ClipboardItem({ 'text/html': blob, 'text/plain': new Blob([draft.textBody], { type: 'text/plain' }) }),
                  ]);
                }}
              >
                Copy email body
              </button>
              <button
                type="button"
                className="rounded-md px-3 py-1.5 text-sm font-medium"
                style={{ background: 'var(--sage)', color: '#082a1b' }}
                onClick={() => navigator.clipboard.writeText(draft.textBody)}
              >
                Copy plain text
              </button>
            </div>
            <p className="mb-2 text-xs" style={{ color: 'var(--text-muted)' }}>
              Paste the body into a new email, paste recipients into <strong>BCC</strong> (never To/CC), review, send.
            </p>
            <div
              className="rounded-md bg-white p-3"
              // Trusted content: generated server-side by lib/pricelist-email.ts with escaped titles.
              dangerouslySetInnerHTML={{ __html: draft.htmlBody }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

'use client';

// Wholesale Pricing Manager — spreadsheet-fast grid + auto-populated recipients + pricelists.
// Optimistic edits with per-cell sync badges; commits are debounced 500ms and
// hit /api/wholesale/* which enforce the wholesale_manager/admin role.
//
// v7.4 (2026-07-07): variant-level checkbox + read-only Recipients tab.
// v7.5 (2026-07-07): pricelist modal shows Copy plain text button; draft
//   includes both htmlBody and textBody (backend renders symmetric Retail /
//   Your price / Save% columns in both formats).
// v7.7.4 (2026-07-08):
//   - Desktop grid gets explicit <colgroup> column widths + table-layout:
//     fixed so wider headers (Retail, Lot Cost) no longer push Tier 2 off
//     the visible area. Item column flexes to fill remaining width.
//   - Pricelist Copy buttons now (1) fall back to document.execCommand('copy')
//     when navigator.clipboard is unavailable, and (2) show a success/error
//     toast so a click always produces visible feedback (previously silent).
//
// v7.7.3 (2026-07-08):
//   - Each row shows a small ↗ icon-link next to the Wholesale? checkbox that
//     opens the Shopify Admin variant edit page in a new tab (Daniel's shortcut
//     for editing product fields we don't surface here + checking inventory
//     history). URL is generated server-side (see lib/wholesale.ts) so the
//     handle stays in one place. Also added to the CSV export as trailing
//     `shopify_admin_url` column.
//
// v7.7 (2026-07-08):
//   - Lot Cost column between Retail and Tier 1 (from Shopify inventoryItem.unitCost).
//     Included in CSV export.
// v7.6 (2026-07-08):
//   - Recipients tab surfaces API errors instead of hanging on "Loading customers…"
//     (backend now returns 200 with an `error` field on Shopify failure).
//   - Pricelist generate button surfaces errors instead of silently doing
//     nothing on a 502.
//   - Export CSV button (item · variant · retail · tier1 · tier2 · wholesale_active)
//     triggers a client-side download via <a download> — no server round-trip,
//     no popup-blocked window.open.
//
// v7.7.5 (2026-07-08):
//   - Recipients tab now shows Tier 1 + Tier 2 account balances (one row per
//     wholesale Company, deep-linked to Shopify Admin) above the recipient
//     lists. Companies with $0 outstanding are hidden by default behind a
//     "show 0-balance (N)" toggle so the section stays focused on money owed.
//   - Tab state is now synced to the URL (?tab=pricing|recipients) via
//     `useSearchParams` + `router.replace`, so the Recipients view is
//     bookmarkable and survives page reloads (previously always snapped back
//     to Pricing on refresh).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

type Tier = 't1' | 't2';

interface GridRow {
  productId: string;
  productTitle: string;
  variantId: string;
  variantTitle: string;
  retail: string;
  lotCost: string | null;
  tier1: string | null;
  tier2: string | null;
  wholesaleActive: boolean;
  adminUrl: string;
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

// v7.7.5: outstanding balance summary for the Recipients tab.
interface TierBalance {
  companyId: string;
  companyName: string;
  balance: string;
  adminUrl: string;
}

interface PricelistDraft {
  subject: string;
  htmlBody: string;
  textBody: string;
  bcc: string[];
  itemCount: number;
}

type CellField = 'retail' | 't1' | 't2';
type SyncState = 'idle' | 'syncing' | 'synced' | 'error';

const DEBOUNCE_MS = 500;
const PRICE_RE = /^\d+(\.\d{1,2})?$/;

const fmt = (v: string | null) => (v === null || v === '' ? '' : Number(v).toFixed(2));

// v7.7.5: US-locale money for balances ("$1,234.56"). Kept out of `fmt` above
// so the pricing-grid inputs stay unformatted (users edit raw decimals).
const money = (v: string) =>
  Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

type TabId = 'pricing' | 'recipients';

export default function WholesaleClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // v7.7.5: initial tab from URL. `useSearchParams` returns null during
  // static prerender in some Next configs; fall back to 'pricing'.
  const urlTab = (searchParams?.get('tab') ?? '') as TabId | '';
  const initialTab: TabId = urlTab === 'recipients' ? 'recipients' : 'pricing';
  const [tab, setTab] = useState<TabId>(initialTab);
  const [rows, setRows] = useState<GridRow[] | null>(null);
  const [recipients, setRecipients] = useState<Recipient[] | null>(null);
  const [tierBalances, setTierBalances] = useState<{ t1: TierBalance[]; t2: TierBalance[] } | null>(null);
  const [suppressedCount, setSuppressedCount] = useState<number>(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [recipientsError, setRecipientsError] = useState<string | null>(null);
  const [sync, setSync] = useState<Record<string, SyncState>>({});
  const [filter, setFilter] = useState<'active' | 'all'>('active');
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState<(PricelistDraft & { tier: Tier }) | null>(null);
  const [generating, setGenerating] = useState<Tier | null>(null);
  // v7.7.5: show/hide $0 balance rows in the Recipients-tab balance section.
  const [showZeroT1, setShowZeroT1] = useState(false);
  const [showZeroT2, setShowZeroT2] = useState(false);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // v7.7.5: keep the URL in sync when the tab changes so the view is
  // bookmarkable + refresh-stable. `router.replace` (not push) avoids
  // polluting the browser back-stack for what's essentially a UI toggle.
  const changeTab = useCallback(
    (next: TabId) => {
      setTab(next);
      const params = new URLSearchParams(searchParams?.toString() ?? '');
      if (next === 'pricing') params.delete('tab');
      else params.set('tab', next);
      const qs = params.toString();
      router.replace(qs ? `?${qs}` : '?', { scroll: false });
    },
    [router, searchParams],
  );

  const showToast = useCallback(
    (message: string, type: 'success' | 'error' = 'success') => {
      setToast({ message, type });
      if (toastTimer.current) clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => setToast(null), 2000);
    },
    [],
  );

  const copyToClipboard = useCallback(
    async (text: string, label: string) => {
      try {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(text);
        } else {
          const ta = document.createElement('textarea');
          ta.value = text;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
        }
        showToast(`✓ Copied ${label}`, 'success');
      } catch (err) {
        console.error('Copy failed:', err);
        showToast(`Failed to copy ${label} — try selecting the text manually`, 'error');
      }
    },
    [showToast],
  );


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
      setRecipients(data.recipients ?? []);
      setSuppressedCount(data.suppressedCount ?? 0);
      // v7.7.5: balances arrive on the same payload. Default to empty
      // arrays so the UI renders cleanly if the server didn't compute them
      // (e.g. old cached response mid-deploy).
      setTierBalances(data.tierBalances ?? { t1: [], t2: [] });
      if (data.error) setRecipientsError(data.error);
      else if (!res.ok) setRecipientsError(`Failed to load (HTTP ${res.status})`);
    } catch (e) {
      setRecipients([]);
      setTierBalances({ t1: [], t2: [] });
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
      if (field === 'retail' && value === '') return;

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

  const exportCsv = useCallback(() => {
    if (!rows || rows.length === 0) return;
    const header = ['item', 'variant', 'retail', 'lot_cost', 'tier1', 'tier2', 'wholesale_active', 'shopify_admin_url'];
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const lines = [
      header.join(','),
      ...rows.map((r) =>
        [
          esc(r.productTitle),
          esc(r.variantTitle === 'Default Title' ? '' : r.variantTitle),
          r.retail,
          r.lotCost ?? '',
          r.tier1 ?? '',
          r.tier2 ?? '',
          r.wholesaleActive ? 'true' : 'false',
          esc(r.adminUrl),
        ].join(',')
      ),
    ];
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

  const tabButton = (id: TabId, label: string) => (
    <button
      type="button"
      onClick={() => changeTab(id)}
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

  // v7.7.5: per-tier balance section. Non-zero rows shown by default; a
  // toggle reveals $0 companies (useful for audit / "who owes us anything").
  const balanceSection = (tier: Tier) => {
    const label = tier === 't1' ? 'Tier 1' : 'Tier 2';
    const list = tierBalances?.[tier] ?? [];
    const showZero = tier === 't1' ? showZeroT1 : showZeroT2;
    const setShowZero = tier === 't1' ? setShowZeroT1 : setShowZeroT2;
    const nonZero = list.filter((b) => Number(b.balance) > 0);
    const zeroCount = list.length - nonZero.length;
    const visibleRows = showZero ? list : nonZero;
    const total = list.reduce((sum, b) => sum + Number(b.balance), 0);

    return (
      <div className="flex-1 min-w-[320px]">
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold" style={{ color: 'var(--cream)' }}>
            {label} Account Balances
          </h3>
          <span className="text-xs" style={{ color: 'var(--sage)' }}>
            Total {money(String(total))}
          </span>
        </div>
        <div
          className="rounded-md"
          style={{ border: '1px solid var(--forest-mid)', background: 'var(--forest-darkest)' }}
        >
          {visibleRows.length === 0 ? (
            <p className="p-3 text-xs" style={{ color: 'var(--text-muted)' }}>
              No {label} companies with an outstanding balance.
            </p>
          ) : (
            <ul>
              {visibleRows.map((b, i) => {
                const isZero = Number(b.balance) === 0;
                return (
                  <li
                    key={b.companyId}
                    className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                    style={{
                      borderTop: i === 0 ? 'none' : '1px solid var(--forest-mid)',
                      opacity: isZero ? 0.6 : 1,
                    }}
                  >
                    <span style={{ color: 'var(--cream)' }}>{b.companyName}</span>
                    <span className="flex items-center gap-2">
                      <span
                        style={{
                          color: isZero ? 'var(--text-muted)' : 'var(--cream)',
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        {money(b.balance)}
                      </span>
                      <a
                        href={b.adminUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={`Open ${b.companyName} in Shopify Admin`}
                        aria-label={`Open ${b.companyName} in Shopify Admin`}
                        className="text-sm leading-none"
                        style={{ color: 'var(--sage)', textDecoration: 'none', opacity: 0.7 }}
                        onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
                        onMouseLeave={(e) => (e.currentTarget.style.opacity = '0.7')}
                      >
                        ↗
                      </a>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        {zeroCount > 0 && (
          <button
            type="button"
            className="mt-1 text-xs underline"
            style={{ color: 'var(--text-muted)' }}
            onClick={() => setShowZero(!showZero)}
          >
            {showZero ? `hide 0-balance (${zeroCount})` : `show 0-balance (${zeroCount})`}
          </button>
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
                title="Download all items as CSV (item, variant, retail, lot_cost, tier1, tier2, wholesale_active, shopify_admin_url)"
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
              <table
                className="w-full text-sm"
                style={{ borderCollapse: 'collapse', tableLayout: 'fixed' }}
              >
                <colgroup>
                  <col style={{ width: '96px' }} />
                  <col />
                  <col style={{ width: '100px' }} />
                  <col style={{ width: '96px' }} />
                  <col style={{ width: '96px' }} />
                  <col style={{ width: '96px' }} />
                  <col style={{ width: '96px' }} />
                </colgroup>
                <thead>
                  <tr style={{ background: 'var(--forest-darkest)', color: 'var(--sage)' }}>
                    <th className="px-3 py-2 text-center font-medium">Wholesale?</th>
                    <th className="px-3 py-2 text-left font-medium">Item</th>
                    <th className="px-3 py-2 text-left font-medium">Variant</th>
                    <th className="px-3 py-2 text-right font-medium">Retail</th>
                    <th className="px-3 py-2 text-right font-medium" title="Cost per item from Shopify variant inventoryItem.unitCost">Lot Cost</th>
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
                        <div className="inline-flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={row.wholesaleActive}
                            onChange={() => toggle(row)}
                            aria-label={`${row.productTitle} ${row.variantTitle} wholesale active`}
                          />
                          <a
                            href={row.adminUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Open in Shopify Admin"
                            aria-label={`Open ${row.productTitle} in Shopify Admin`}
                            className="text-sm leading-none"
                            style={{
                              color: 'var(--sage)',
                              textDecoration: 'none',
                              opacity: 0.7,
                            }}
                            onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
                            onMouseLeave={(e) => (e.currentTarget.style.opacity = '0.7')}
                          >
                            ↗
                          </a>
                        </div>
                      </td>
                      <td className="px-3 py-1" style={{ color: 'var(--cream)' }}>{row.productTitle}</td>
                      <td className="px-3 py-1" style={{ color: 'var(--text-muted)' }}>
                        {row.variantTitle === 'Default Title' ? '—' : row.variantTitle}
                      </td>
                      {cell(row, 'retail', fmt(row.retail), false)}
                      <td className="whitespace-nowrap px-2 py-1 text-right" style={{ color: 'var(--text-muted)' }}>{row.lotCost !== null ? '$' + Number(row.lotCost).toFixed(2) : '—'}</td>
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
        <div className="space-y-6">
          {tierBalances && (
            <section className="space-y-3">
              <div>
                <h2
                  className="text-sm font-semibold uppercase tracking-wide"
                  style={{ color: 'var(--sage)' }}
                >
                  Account Balances
                </h2>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  Outstanding balance across each wholesale company&apos;s unpaid orders
                  (pending / partially paid / unpaid). Sourced live from Shopify.
                </p>
              </div>
              <div className="flex flex-wrap gap-6">
                {balanceSection('t1')}
                {balanceSection('t2')}
              </div>
            </section>
          )}

          <div className="space-y-3">
            <h2
              className="text-sm font-semibold uppercase tracking-wide"
              style={{ color: 'var(--sage)' }}
            >
              Recipients
            </h2>
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
                onClick={() => copyToClipboard(draft.bcc.join(', '), 'BCC list')}
              >
                Copy BCC list
              </button>
              <button
                type="button"
                className="rounded-md px-3 py-1.5 text-sm font-medium"
                style={{ background: 'var(--gold)', color: '#082a1b' }}
                onClick={() => copyToClipboard(draft.subject, 'subject')}
              >
                Copy subject
              </button>
              <button
                type="button"
                className="rounded-md px-3 py-1.5 text-sm font-medium"
                style={{ background: 'var(--gold)', color: '#082a1b' }}
                onClick={async () => {
                  try {
                    if (
                      navigator.clipboard &&
                      typeof ClipboardItem !== 'undefined' &&
                      window.isSecureContext
                    ) {
                      const item = new ClipboardItem({
                        'text/html': new Blob([draft.htmlBody], { type: 'text/html' }),
                        'text/plain': new Blob([draft.textBody], { type: 'text/plain' }),
                      });
                      await navigator.clipboard.write([item]);
                      showToast('✓ Copied email body', 'success');
                    } else {
                      await copyToClipboard(draft.textBody, 'email body');
                    }
                  } catch (err) {
                    console.error('Copy email body failed:', err);
                    await copyToClipboard(draft.textBody, 'email body');
                  }
                }}
              >
                Copy email body
              </button>
              <button
                type="button"
                className="rounded-md px-3 py-1.5 text-sm font-medium"
                style={{ background: 'var(--sage)', color: '#082a1b' }}
                onClick={() => copyToClipboard(draft.textBody, 'plain text')}
              >
                Copy plain text
              </button>
            </div>
            <p className="mb-2 text-xs" style={{ color: 'var(--text-muted)' }}>
              Paste the body into a new email, paste recipients into <strong>BCC</strong> (never To/CC), review, send.
            </p>
            <div
              className="rounded-md bg-white p-3"
              dangerouslySetInnerHTML={{ __html: draft.htmlBody }}
            />
          </div>
        </div>
      )}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed right-4 top-4 z-50 rounded-md px-4 py-2 text-sm font-medium shadow-lg"
          style={{
            background: toast.type === 'success' ? 'var(--sage)' : '#7f1d1d',
            color: toast.type === 'success' ? '#082a1b' : '#fff',
          }}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}

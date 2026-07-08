'use client';

// Wholesale Pricing Manager — spreadsheet-fast grid + recipients + pricelists.
// Optimistic edits with per-cell sync badges; commits are debounced 500ms and
// hit /api/wholesale/* which enforce the wholesale_manager/admin role.

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
  t1: boolean;
  t2: boolean;
}

interface PricelistDraft {
  subject: string;
  htmlBody: string;
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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sync, setSync] = useState<Record<string, SyncState>>({});
  const [filter, setFilter] = useState<'active' | 'all'>('active');
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState<(PricelistDraft & { tier: Tier }) | null>(null);
  const [generating, setGenerating] = useState<Tier | null>(null);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const loadGrid = useCallback(async () => {
    setLoadError(null);
    const res = await fetch('/api/wholesale/grid');
    const data = await res.json();
    if (!res.ok) setLoadError(data.error ?? 'Failed to load');
    else setRows(data.rows);
  }, []);

  const loadRecipients = useCallback(async () => {
    const res = await fetch('/api/wholesale/recipients');
    const data = await res.json();
    if (res.ok) setRecipients(data.recipients);
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

  const toggle = useCallback(
    async (row: GridRow) => {
      const next = !row.wholesaleActive;
      const variantIds = rows!.filter((r) => r.productId === row.productId).map((r) => r.variantId);
      setRows((rs) =>
        rs!.map((r) => (r.productId === row.productId ? { ...r, wholesaleActive: next } : r))
      );
      const res = await fetch('/api/wholesale/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: row.productId, variantIds, active: next }),
      });
      if (!res.ok) {
        setRows((rs) =>
          rs!.map((r) => (r.productId === row.productId ? { ...r, wholesaleActive: !next } : r))
        );
      } else if (!next) {
        // cleared tier prices server-side; reflect locally
        setRows((rs) =>
          rs!.map((r) => (r.productId === row.productId ? { ...r, tier1: null, tier2: null } : r))
        );
      }
    },
    [rows]
  );

  const toggleRecipient = useCallback(async (rec: Recipient, tier: Tier) => {
    const member = tier === 't1' ? !rec.t1 : !rec.t2;
    setRecipients((rs) =>
      rs!.map((r) =>
        r.customerId === rec.customerId ? { ...r, [tier]: member } : r
      )
    );
    const res = await fetch('/api/wholesale/recipients', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customerId: rec.customerId, tier, member }),
    });
    if (!res.ok) {
      setRecipients((rs) =>
        rs!.map((r) =>
          r.customerId === rec.customerId ? { ...r, [tier]: !member } : r
        )
      );
    }
  }, []);

  const generate = useCallback(async (tier: Tier) => {
    setGenerating(tier);
    const res = await fetch(`/api/wholesale/pricelist?tier=${tier}`);
    const data = await res.json();
    setGenerating(null);
    if (res.ok) setDraft({ ...data, tier });
  }, []);

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
                          aria-label={`${row.productTitle} wholesale active`}
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
        <div className="space-y-3">
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Who receives each pricelist email. Tags (`wholesale-list-t1` / `-t2`) live on the
            Shopify customer record and can also be edited in Shopify admin.
          </p>
          {recipients === null ? (
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading customers…</p>
          ) : (
            <div className="overflow-x-auto rounded-lg" style={{ border: '1px solid var(--forest-mid)' }}>
              <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'var(--forest-darkest)', color: 'var(--sage)' }}>
                    <th className="px-3 py-2 text-left font-medium">Customer</th>
                    <th className="px-3 py-2 text-left font-medium">Email</th>
                    <th className="px-3 py-2 text-center font-medium">Tier 1 list</th>
                    <th className="px-3 py-2 text-center font-medium">Tier 2 list</th>
                  </tr>
                </thead>
                <tbody>
                  {recipients.map((rec) => (
                    <tr key={rec.customerId} style={{ borderTop: '1px solid var(--forest-mid)' }}>
                      <td className="px-3 py-1.5" style={{ color: 'var(--cream)' }}>{rec.displayName}</td>
                      <td className="px-3 py-1.5" style={{ color: 'var(--text-muted)' }}>{rec.email}</td>
                      <td className="px-3 py-1.5 text-center">
                        <input type="checkbox" checked={rec.t1} onChange={() => toggleRecipient(rec, 't1')} />
                      </td>
                      <td className="px-3 py-1.5 text-center">
                        <input type="checkbox" checked={rec.t2} onChange={() => toggleRecipient(rec, 't2')} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
                    new ClipboardItem({ 'text/html': blob, 'text/plain': new Blob([draft.htmlBody], { type: 'text/plain' }) }),
                  ]);
                }}
              >
                Copy email body
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

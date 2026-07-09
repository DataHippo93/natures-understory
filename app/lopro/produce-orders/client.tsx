"use client";

// Produce Orders index — list recent orders grouped by vendor, plus a
// "new order" button that jumps to /new. Mirrors wholesale-pricing tone.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

interface OrderRow {
  id: string;
  vendor_id: string;
  vendor_name: string;
  status: 'draft' | 'ready' | 'sent' | 'received' | string;
  target_delivery_date: string | null;
  target_dos: number | null;
  subtotal_cents: number;
  min_cents: number | null;
  min_hit: boolean | null;
  rvfm_piggyback: boolean;
  supplier_email_sent: boolean;
  thrive_po_id: string | null;
  created_at: string;
  updated_at: string;
  sent_at: string | null;
}

const money = (cents: number | null | undefined) => {
  if (cents == null) return '—';
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
};

const fmtDate = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

const statusChip = (status: string): { bg: string; label: string } => {
  switch (status) {
    case 'draft':    return { bg: 'var(--text-muted)',        label: 'Draft' };
    case 'ready':    return { bg: 'var(--gold)',       label: 'Ready' };
    case 'sent':     return { bg: 'var(--forest-mid)',  label: 'Sent' };
    case 'received': return { bg: 'var(--sage)',   label: 'Received' };
    default:         return { bg: 'var(--text-muted)',       label: status };
  }
};

export default function ProduceOrdersClient() {
  const router = useRouter();
  const [orders, setOrders] = useState<OrderRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'active' | 'all'>('active');

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/produce-orders');
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
      } else {
        setOrders(data.orders ?? []);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'load failed');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const visible = useMemo(() => {
    if (!orders) return [];
    if (filter === 'all') return orders;
    return orders.filter((o) => o.status !== 'received');
  }, [orders, filter]);

  const grouped = useMemo(() => {
    const byVendor = new Map<string, OrderRow[]>();
    for (const o of visible) {
      const key = o.vendor_name;
      if (!byVendor.has(key)) byVendor.set(key, []);
      byVendor.get(key)!.push(o);
    }
    // Sort vendors alphabetically; within each, most recent first (server already ordered by created_at desc).
    return [...byVendor.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [visible]);

  return (
    <div style={{ padding: '16px', maxWidth: 1100, margin: '0 auto' }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-josefin)', fontSize: 28, margin: 0, color: 'var(--cream)' }}>Produce Orders</h1>
          <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: 13 }}>
            Assemble Albert&apos;s / Kent&apos;s / Birdsfoot / RVFM orders. Draft → review → send.
          </p>
        </div>
        <button
          onClick={() => router.push('/lopro/produce-orders/new')}
          style={{
            background: 'var(--gold)',
            color: 'var(--forest-dark)',
            border: 'none',
            borderRadius: 8,
            padding: '10px 18px',
            fontSize: 14,
            fontWeight: 600,
            fontFamily: 'var(--font-montserrat)',
            cursor: 'pointer',
          }}
        >
          + New Order
        </button>
      </header>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button
          onClick={() => setFilter('active')}
          style={{
            background: filter === 'active' ? 'var(--forest-mid)' : 'transparent',
            color: 'var(--cream)',
            border: '1px solid var(--forest-mid)',
            borderRadius: 6,
            padding: '6px 12px',
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          Active
        </button>
        <button
          onClick={() => setFilter('all')}
          style={{
            background: filter === 'all' ? 'var(--forest-mid)' : 'transparent',
            color: 'var(--cream)',
            border: '1px solid var(--forest-mid)',
            borderRadius: 6,
            padding: '6px 12px',
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          All
        </button>
      </div>

      {error && (
        <div style={{ background: '#4a1010', color: '#ffb0b0', padding: 12, borderRadius: 8, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {orders === null && !error && (
        <div style={{ color: 'var(--text-muted)' }}>Loading orders…</div>
      )}

      {orders !== null && grouped.length === 0 && (
        <div style={{ background: 'var(--forest-mid)', color: 'var(--text-muted)', padding: 24, borderRadius: 8, textAlign: 'center' }}>
          No orders yet. Tap <strong>+ New Order</strong> to draft one.
        </div>
      )}

      {grouped.map(([vendor, list]) => (
        <section key={vendor} style={{ marginBottom: 24 }}>
          <h2 style={{ fontFamily: 'var(--font-josefin)', fontSize: 18, color: 'var(--gold)', margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: 0.5 }}>
            {vendor}
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
            {list.map((o) => {
              const chip = statusChip(o.status);
              return (
                <a
                  key={o.id}
                  href={`/lopro/produce-orders/${o.id}`}
                  style={{
                    display: 'block',
                    background: 'var(--forest-mid)',
                    border: '1px solid var(--forest-light)',
                    borderRadius: 10,
                    padding: 12,
                    textDecoration: 'none',
                    color: 'var(--cream)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <span style={{ background: chip.bg, color: 'var(--forest-dark)', fontSize: 11, padding: '2px 8px', borderRadius: 4, fontWeight: 600 }}>
                      {chip.label}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      For {fmtDate(o.target_delivery_date)}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                    <span style={{ fontSize: 20, fontWeight: 600 }}>{money(o.subtotal_cents)}</span>
                    {o.min_cents != null && (
                      <span style={{ fontSize: 11, color: o.min_hit ? 'var(--good)' : 'var(--text-muted)' }}>
                        min {money(o.min_cents)} {o.min_hit ? '✓' : ''}
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 8, fontSize: 11, color: 'var(--text-muted)' }}>
                    {o.supplier_email_sent && <span>📧 sent</span>}
                    {o.thrive_po_id && <span>PO ✓</span>}
                    {o.rvfm_piggyback && <span>RVFM piggyback</span>}
                    {o.target_dos != null && <span>DoS {o.target_dos}d</span>}
                  </div>
                </a>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

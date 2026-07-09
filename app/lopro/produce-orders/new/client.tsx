"use client";

// Create a produce order:
//   1. Pick vendor.
//   2. Pick target delivery date (defaults to vendor's next truck date).
//   3. Paste / type items (one per line).
//   4. Optional: check "RVFM piggyback" for Albert's.
// On submit: POST /api/produce-orders (creates draft) → POST /lines (bulk) →
// redirect to /lopro/produce-orders/<id> review page.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { parseRawText } from '@/lib/produce/parse-raw-line';

interface Vendor {
  id: string;
  display_name: string;
  order_days: string[];
  delivery_days: string[];
  delivery_offset_days: number;
  next_order_date: string | null;
  target_buffer_multiplier: number;
  categories: string[];
  manual_only: boolean;
}

// Sunday=0..Saturday=6
const WEEKDAYS = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'] as const;

const TZ = 'America/New_York';
function todayNY(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: TZ });
}
function addDaysStr(iso: string, n: number): string {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString('en-CA');
}
function weekdayOf(iso: string): string {
  return new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', timeZone: TZ }).toLowerCase();
}
function nextDeliveryDate(vendor: Vendor | null, fromISO: string): string {
  if (!vendor || vendor.delivery_days.length === 0) return fromISO;
  const set = new Set(vendor.delivery_days.map((d) => d.toLowerCase()));
  for (let i = 0; i < 14; i++) {
    const d = addDaysStr(fromISO, i);
    if (set.has(weekdayOf(d))) return d;
  }
  return fromISO;
}

export default function NewOrderClient() {
  const router = useRouter();
  const [vendors, setVendors] = useState<Vendor[] | null>(null);
  const [vendorId, setVendorId] = useState<string>('');
  const [deliveryDate, setDeliveryDate] = useState<string>(todayNY());
  const [targetDos, setTargetDos] = useState<string>('5.0');
  const [rvfmPiggyback, setRvfmPiggyback] = useState(false);
  const [rawText, setRawText] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/produce-orders/vendors');
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
        setVendors(data.vendors ?? []);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'failed to load vendors');
      }
    })();
  }, []);

  const currentVendor = useMemo(() => vendors?.find((v) => v.id === vendorId) ?? null, [vendors, vendorId]);

  // Auto-tune target delivery date + DoS to vendor.
  useEffect(() => {
    if (!currentVendor) return;
    const nextDel = nextDeliveryDate(currentVendor, todayNY());
    setDeliveryDate(nextDel);
    const weekday = weekdayOf(todayNY());
    // Albert's Mon => 5.5, Albert's Thu => 5.0 (hardcoded example targets).
    const isAlberts = currentVendor.display_name.toLowerCase().includes('albert');
    if (isAlberts) {
      setTargetDos(weekday === 'monday' ? '5.5' : '5.0');
    } else {
      // Default: gap-to-next-truck * buffer_multiplier, approximated at 4.5d.
      setTargetDos((currentVendor.target_buffer_multiplier * 3).toFixed(1));
    }
  }, [currentVendor]);

  const parsedPreview = useMemo(() => parseRawText(rawText).slice(0, 20), [rawText]);

  const submit = useCallback(async () => {
    if (!vendorId) { setError('Pick a vendor first'); return; }
    if (!deliveryDate) { setError('Pick a delivery date'); return; }
    setSubmitting(true);
    setError(null);
    try {
      const createRes = await fetch('/api/produce-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vendor_id: vendorId,
          target_delivery_date: deliveryDate,
          target_dos: targetDos ? Number(targetDos) : null,
          input_raw_text: rawText || null,
          rvfm_piggyback: rvfmPiggyback,
        }),
      });
      const create = await createRes.json();
      if (!createRes.ok) throw new Error(create.error ?? `HTTP ${createRes.status}`);
      const orderId = create.id as string;

      const parsed = parseRawText(rawText);
      if (parsed.length > 0) {
        const linesRes = await fetch(`/api/produce-orders/${orderId}/lines`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            lines: parsed.map((p) => ({
              raw_line: p.raw,
              product_name: p.name,
              qty: p.qty,
              unit_cost_cents: p.unit_cost_cents,
              pack: p.pack,
              decision: 'ORDER',
            })),
          }),
        });
        const lines = await linesRes.json();
        if (!linesRes.ok) throw new Error(lines.error ?? `lines HTTP ${linesRes.status}`);
      }
      router.push(`/lopro/produce-orders/${orderId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'submit failed');
      setSubmitting(false);
    }
  }, [vendorId, deliveryDate, targetDos, rawText, rvfmPiggyback, router]);

  const isAlberts = !!currentVendor?.display_name.toLowerCase().includes('albert');

  return (
    <div style={{ padding: 16, maxWidth: 720, margin: '0 auto' }}>
      <header style={{ marginBottom: 20 }}>
        <a href="/lopro/produce-orders" style={{ color: 'var(--sand)', textDecoration: 'none', fontSize: 13 }}>← All orders</a>
        <h1 style={{ fontFamily: 'var(--font-josefin)', fontSize: 26, margin: '6px 0 0', color: 'var(--cream)' }}>New produce order</h1>
      </header>

      {error && (
        <div style={{ background: '#4a1010', color: '#ffb0b0', padding: 12, borderRadius: 8, marginBottom: 16 }}>
          {error}
        </div>
      )}

      <div style={{ display: 'grid', gap: 14 }}>
        <label>
          <div style={{ fontSize: 12, color: 'var(--sand)', marginBottom: 4 }}>Vendor</div>
          <select
            value={vendorId}
            onChange={(e) => setVendorId(e.target.value)}
            style={{ width: '100%', padding: 10, background: 'var(--forest-mid)', color: 'var(--cream)', border: '1px solid var(--forest-light)', borderRadius: 6, fontSize: 14 }}
          >
            <option value="">— Pick vendor —</option>
            {(vendors ?? []).map((v) => (
              <option key={v.id} value={v.id}>{v.display_name}</option>
            ))}
          </select>
        </label>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <label>
            <div style={{ fontSize: 12, color: 'var(--sand)', marginBottom: 4 }}>Target delivery</div>
            <input
              type="date"
              value={deliveryDate}
              onChange={(e) => setDeliveryDate(e.target.value)}
              style={{ width: '100%', padding: 10, background: 'var(--forest-mid)', color: 'var(--cream)', border: '1px solid var(--forest-light)', borderRadius: 6, fontSize: 14 }}
            />
          </label>
          <label>
            <div style={{ fontSize: 12, color: 'var(--sand)', marginBottom: 4 }}>Target DoS (days)</div>
            <input
              type="number"
              step="0.1"
              value={targetDos}
              onChange={(e) => setTargetDos(e.target.value)}
              style={{ width: '100%', padding: 10, background: 'var(--forest-mid)', color: 'var(--cream)', border: '1px solid var(--forest-light)', borderRadius: 6, fontSize: 14 }}
            />
          </label>
        </div>

        {isAlberts && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--sand)' }}>
            <input type="checkbox" checked={rvfmPiggyback} onChange={(e) => setRvfmPiggyback(e.target.checked)} />
            RVFM piggyback (separate invoice, same truck)
          </label>
        )}

        <label>
          <div style={{ fontSize: 12, color: 'var(--sand)', marginBottom: 4 }}>Items (one per line)</div>
          <textarea
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            placeholder={`e.g.\n3 shiitake bulk case @ 24.50\n2 cilantro (30ct)\nromaine 6\nginger smallest case`}
            rows={10}
            style={{ width: '100%', padding: 12, background: 'var(--forest-mid)', color: 'var(--cream)', border: '1px solid var(--forest-light)', borderRadius: 6, fontSize: 14, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}
          />
        </label>

        {parsedPreview.length > 0 && (
          <div style={{ background: 'var(--forest-mid)', border: '1px solid var(--forest-light)', borderRadius: 6, padding: 10 }}>
            <div style={{ fontSize: 11, color: 'var(--sand)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>Preview parse</div>
            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ color: 'var(--sand)' }}>
                  <th style={{ textAlign: 'left', padding: '4px 6px' }}>Qty</th>
                  <th style={{ textAlign: 'left', padding: '4px 6px' }}>Item</th>
                  <th style={{ textAlign: 'left', padding: '4px 6px' }}>Pack</th>
                  <th style={{ textAlign: 'right', padding: '4px 6px' }}>Cost</th>
                </tr>
              </thead>
              <tbody>
                {parsedPreview.map((p, i) => (
                  <tr key={i} style={{ borderTop: '1px solid var(--forest-light)' }}>
                    <td style={{ padding: '4px 6px' }}>{p.qty}</td>
                    <td style={{ padding: '4px 6px' }}>{p.name || <em style={{ color: 'var(--sand)' }}>(empty)</em>}</td>
                    <td style={{ padding: '4px 6px', color: 'var(--sand)' }}>{p.pack ?? ''}</td>
                    <td style={{ padding: '4px 6px', textAlign: 'right' }}>{p.unit_cost_cents == null ? '' : `$${(p.unit_cost_cents / 100).toFixed(2)}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <button
          onClick={submit}
          disabled={submitting || !vendorId}
          style={{
            background: submitting || !vendorId ? 'var(--slate)' : 'var(--maple)',
            color: 'var(--forest-dark)',
            border: 'none',
            borderRadius: 8,
            padding: '12px 20px',
            fontSize: 15,
            fontWeight: 600,
            cursor: submitting || !vendorId ? 'not-allowed' : 'pointer',
          }}
        >
          {submitting ? 'Creating…' : 'Create order'}
        </button>
      </div>
    </div>
  );
}

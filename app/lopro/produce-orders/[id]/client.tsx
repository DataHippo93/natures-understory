"use client";

// Review page — line table with editable qty / cost / decision, running
// subtotal + $1k min gauge, Preview supplier email modal, Send-to-inbox
// button, Create Thrive PO button.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

interface Line {
  id: string;
  line_no: number;
  raw_line: string;
  product_name: string;
  variant: string | null;
  matched_sku: string | null;
  qty: number;
  pack: string | null;
  units_per_case: number | null;
  unit_cost_cents: number | null;
  line_cents: number | null;
  current_oh: number | null;
  velocity_30d: number | null;
  days_of_supply: number | null;
  reason: string | null;
  audience_note_supplier: string[];
  audience_note_internal: string[];
  audience_note_both: string[];
  bid: boolean;
  bid_ask_cents: number | null;
  decision: 'ORDER' | 'SKIP' | 'BID' | string;
  rule_deviation: string | null;
  recent_burn: boolean;
  is_organic: boolean | null;
}

interface Vendor {
  display_name: string;
  contact_email: string | null;
  contact_name: string | null;
  order_days: string[];
  delivery_days: string[];
  target_buffer_multiplier: string | number;
  categories: string[];
}

interface Order {
  id: string;
  vendor_id: string;
  status: string;
  target_delivery_date: string | null;
  target_dos: number | string | null;
  input_raw_text: string | null;
  subtotal_cents: number;
  min_cents: number | null;
  min_hit: boolean | null;
  rvfm_piggyback: boolean;
  supplier_email_resend_id: string | null;
  supplier_email_subject: string | null;
  supplier_email_body: string | null;
  thrive_po_id: string | null;
  created_at: string;
  sent_at: string | null;
  produce_vendors: Vendor;
}

const money = (cents: number | null | undefined) => {
  if (cents == null) return '—';
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
};

const dollarsInput = (cents: number | null | undefined) => {
  if (cents == null) return '';
  return (cents / 100).toFixed(2);
};

const parseDollars = (s: string): number | null => {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t.replace(/^\$/, ''));
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
};

export default function ReviewClient({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [order, setOrder] = useState<Order | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [preview, setPreview] = useState<{ subject: string; textBody: string; htmlBody: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [creatingPo, setCreatingPo] = useState(false);
  const [toast, setToast] = useState<{ msg: string; kind: 'success' | 'error' } | null>(null);

  const showToast = useCallback((msg: string, kind: 'success' | 'error' = 'success') => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 2500);
  }, []);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/produce-orders/${orderId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setOrder(data.order);
      setLines(data.lines ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'load failed');
    }
  }, [orderId]);

  useEffect(() => { load(); }, [load]);

  const patchLine = useCallback(async (lineId: string, patch: Record<string, unknown>) => {
    setSaving((s) => ({ ...s, [lineId]: true }));
    // Optimistic update
    setLines((rows) => rows.map((r) => r.id === lineId ? { ...r, ...patch } as Line : r));
    try {
      const res = await fetch(`/api/produce-orders/${orderId}/lines`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ line_id: lineId, ...patch }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      // Reload to refresh subtotal.
      load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'save failed', 'error');
      load(); // revert optimistic update
    } finally {
      setSaving((s) => ({ ...s, [lineId]: false }));
    }
  }, [orderId, load, showToast]);

  const deleteLine = useCallback(async (lineId: string) => {
    setLines((rows) => rows.filter((r) => r.id !== lineId));
    try {
      const res = await fetch(`/api/produce-orders/${orderId}/lines?line=${encodeURIComponent(lineId)}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'delete failed', 'error');
      load();
    }
  }, [orderId, load, showToast]);

  const addBlankLine = useCallback(async () => {
    if (!order) return;
    // Append a blank line to the existing list via bulk POST.
    const next = [...lines, {
      id: 'temp',
      line_no: lines.length,
      raw_line: '',
      product_name: '',
      variant: null,
      matched_sku: null,
      qty: 1,
      pack: null,
      units_per_case: null,
      unit_cost_cents: null,
      line_cents: null,
      current_oh: null, velocity_30d: null, days_of_supply: null, reason: null,
      audience_note_supplier: [], audience_note_internal: [], audience_note_both: [],
      bid: false, bid_ask_cents: null, decision: 'ORDER' as const, rule_deviation: null,
      recent_burn: false, is_organic: null,
    }];
    try {
      const res = await fetch(`/api/produce-orders/${orderId}/lines`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lines: next.map((l) => ({
            raw_line: l.raw_line, product_name: l.product_name, qty: l.qty,
            unit_cost_cents: l.unit_cost_cents, pack: l.pack, decision: l.decision,
          })),
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'add failed', 'error');
    }
  }, [order, orderId, lines, load, showToast]);

  const openPreview = useCallback(async () => {
    setPreviewOpen(true);
    setPreviewLoading(true);
    try {
      const res = await fetch(`/api/produce-orders/${orderId}/preview-email`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setPreview(data);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'preview failed', 'error');
      setPreviewOpen(false);
    } finally {
      setPreviewLoading(false);
    }
  }, [orderId, showToast]);

  const sendDraft = useCallback(async () => {
    setSending(true);
    try {
      const res = await fetch(`/api/produce-orders/${orderId}/send-email`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      showToast(`Draft sent to your inbox (Resend id: ${data.resend_id ?? '?'})`, 'success');
      load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'send failed', 'error');
    } finally {
      setSending(false);
    }
  }, [orderId, load, showToast]);

  const createThrivePo = useCallback(async () => {
    setCreatingPo(true);
    try {
      const res = await fetch(`/api/produce-orders/${orderId}/thrive-po`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      showToast(`Thrive PO created: ${data.thrive_po_id ?? '?'}`, 'success');
      load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'PO create failed', 'error');
    } finally {
      setCreatingPo(false);
    }
  }, [orderId, load, showToast]);

  const copy = useCallback(async (text: string, label: string) => {
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
      showToast(`Copied ${label}`, 'success');
    } catch {
      showToast('Copy failed', 'error');
    }
  }, [showToast]);

  const subtotal = order?.subtotal_cents ?? 0;
  const minCents = order?.min_cents ?? 100000;
  const gap = Math.max(0, minCents - subtotal);
  const pct = Math.min(100, Math.round((subtotal / (minCents || 1)) * 100));

  if (error) return (
    <div style={{ padding: 16 }}>
      <div style={{ background: '#4a1010', color: '#ffb0b0', padding: 12, borderRadius: 8 }}>{error}</div>
    </div>
  );
  if (!order) return <div style={{ padding: 16, color: 'var(--text-muted)' }}>Loading…</div>;

  return (
    <div style={{ padding: 16, maxWidth: 1100, margin: '0 auto', paddingBottom: 120 }}>
      <header style={{ marginBottom: 16 }}>
        <a href="/lopro/produce-orders" style={{ color: 'var(--text-muted)', textDecoration: 'none', fontSize: 13 }}>← All orders</a>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginTop: 6 }}>
          <div>
            <h1 style={{ fontFamily: 'var(--font-josefin)', fontSize: 24, margin: 0, color: 'var(--cream)' }}>
              {order.produce_vendors.display_name} — {order.target_delivery_date ?? 'no date'}
            </h1>
            <div style={{ marginTop: 4, fontSize: 12, color: 'var(--text-muted)' }}>
              Status: <strong style={{ color: 'var(--gold)' }}>{order.status}</strong>
              {order.target_dos != null && <> · Target DoS <strong>{Number(order.target_dos).toFixed(1)}d</strong></>}
              {order.rvfm_piggyback && <> · RVFM piggyback</>}
            </div>
          </div>
        </div>
      </header>

      {/* Subtotal + min gauge */}
      <div style={{ background: 'var(--forest-mid)', border: '1px solid var(--forest-light)', borderRadius: 10, padding: 12, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ fontSize: 24, fontWeight: 700, color: 'var(--cream)' }}>{money(subtotal)}</span>
          <span style={{ fontSize: 12, color: gap === 0 ? 'var(--good)' : 'var(--text-muted)' }}>
            {gap === 0 ? `✓ over ${money(minCents)} min` : `${money(gap)} to ${money(minCents)} min`}
          </span>
        </div>
        <div style={{ background: 'var(--forest-dark)', height: 6, borderRadius: 3, overflow: 'hidden' }}>
          <div style={{ background: gap === 0 ? 'var(--good)' : 'var(--gold)', height: '100%', width: `${pct}%`, transition: 'width 200ms' }} />
        </div>
      </div>

      {/* Line table */}
      <div style={{ overflowX: 'auto', background: 'var(--forest-mid)', border: '1px solid var(--forest-light)', borderRadius: 10, padding: 10 }}>
        <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ color: 'var(--text-muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              <th style={{ textAlign: 'left', padding: '6px 8px', minWidth: 200 }}>Item</th>
              <th style={{ textAlign: 'right', padding: '6px 6px', width: 60 }}>Qty</th>
              <th style={{ textAlign: 'left', padding: '6px 6px', width: 80 }}>Pack</th>
              <th style={{ textAlign: 'right', padding: '6px 6px', width: 80 }}>Unit $</th>
              <th style={{ textAlign: 'right', padding: '6px 6px', width: 80 }}>Line</th>
              <th style={{ textAlign: 'center', padding: '6px 6px', width: 110 }}>Decision</th>
              <th style={{ textAlign: 'left', padding: '6px 6px', minWidth: 200 }}>Reason / Notes</th>
              <th style={{ padding: '6px 6px', width: 30 }} />
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const isSkip = l.decision === 'SKIP';
              return (
                <tr key={l.id} style={{ borderTop: '1px solid var(--forest-light)', opacity: isSkip ? 0.5 : 1 }}>
                  <td style={{ padding: '6px 8px' }}>
                    <input
                      type="text"
                      value={l.product_name}
                      onChange={(e) => setLines((rs) => rs.map((r) => r.id === l.id ? { ...r, product_name: e.target.value } : r))}
                      onBlur={(e) => patchLine(l.id, { product_name: e.target.value })}
                      style={{ width: '100%', background: 'transparent', border: 'none', color: 'var(--cream)', padding: '4px 2px', fontSize: 13 }}
                    />
                    {l.reason && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{l.reason}</div>}
                    {l.rule_deviation && <div style={{ fontSize: 11, color: 'var(--gold)', marginTop: 2 }}>⚠ {l.rule_deviation}</div>}
                    {l.recent_burn && <div style={{ fontSize: 11, color: '#ff8080', marginTop: 2 }}>🔥 recent burn</div>}
                  </td>
                  <td style={{ padding: '6px 6px' }}>
                    <input
                      type="number"
                      step="0.5"
                      value={l.qty}
                      onChange={(e) => setLines((rs) => rs.map((r) => r.id === l.id ? { ...r, qty: Number(e.target.value) } : r))}
                      onBlur={(e) => patchLine(l.id, { qty: Number(e.target.value) })}
                      style={{ width: '100%', background: 'var(--forest-dark)', border: '1px solid var(--forest-light)', color: 'var(--cream)', padding: '4px', fontSize: 13, textAlign: 'right', borderRadius: 4 }}
                    />
                  </td>
                  <td style={{ padding: '6px 6px' }}>
                    <input
                      type="text"
                      value={l.pack ?? ''}
                      onChange={(e) => setLines((rs) => rs.map((r) => r.id === l.id ? { ...r, pack: e.target.value } : r))}
                      onBlur={(e) => patchLine(l.id, { pack: e.target.value || null })}
                      style={{ width: '100%', background: 'var(--forest-dark)', border: '1px solid var(--forest-light)', color: 'var(--cream)', padding: '4px', fontSize: 12, borderRadius: 4 }}
                    />
                  </td>
                  <td style={{ padding: '6px 6px' }}>
                    <input
                      type="text"
                      value={dollarsInput(l.unit_cost_cents)}
                      onChange={(e) => setLines((rs) => rs.map((r) => r.id === l.id ? { ...r, unit_cost_cents: parseDollars(e.target.value) } : r))}
                      onBlur={(e) => patchLine(l.id, { unit_cost_cents: parseDollars(e.target.value) })}
                      placeholder="0.00"
                      style={{ width: '100%', background: 'var(--forest-dark)', border: '1px solid var(--forest-light)', color: 'var(--cream)', padding: '4px', fontSize: 13, textAlign: 'right', borderRadius: 4 }}
                    />
                  </td>
                  <td style={{ padding: '6px 6px', textAlign: 'right', color: 'var(--cream)', fontVariantNumeric: 'tabular-nums' }}>
                    {money(l.line_cents)}
                  </td>
                  <td style={{ padding: '6px 6px', textAlign: 'center' }}>
                    <select
                      value={l.decision}
                      onChange={(e) => patchLine(l.id, { decision: e.target.value })}
                      style={{ background: 'var(--forest-dark)', color: 'var(--cream)', border: '1px solid var(--forest-light)', borderRadius: 4, padding: '4px', fontSize: 12 }}
                    >
                      <option value="ORDER">ORDER</option>
                      <option value="SKIP">SKIP</option>
                      <option value="BID">BID</option>
                    </select>
                  </td>
                  <td style={{ padding: '6px 6px' }}>
                    <textarea
                      value={(l.audience_note_supplier ?? []).join('\n')}
                      onChange={(e) => setLines((rs) => rs.map((r) => r.id === l.id ? { ...r, audience_note_supplier: e.target.value.split('\n').filter(Boolean) } : r))}
                      onBlur={(e) => patchLine(l.id, { audience_note_supplier: e.target.value.split('\n').filter(Boolean) })}
                      placeholder="supplier note"
                      rows={1}
                      style={{ width: '100%', background: 'var(--forest-dark)', border: '1px solid var(--forest-light)', color: 'var(--cream)', padding: '4px', fontSize: 12, borderRadius: 4, resize: 'vertical' }}
                    />
                  </td>
                  <td style={{ padding: '6px 6px' }}>
                    <button
                      onClick={() => deleteLine(l.id)}
                      title="Delete line"
                      style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 16 }}
                    >×</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {lines.length === 0 && (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>No lines yet.</div>
        )}
        <div style={{ marginTop: 10 }}>
          <button
            onClick={addBlankLine}
            style={{ background: 'var(--forest-dark)', color: 'var(--cream)', border: '1px solid var(--forest-light)', borderRadius: 6, padding: '6px 12px', fontSize: 12, cursor: 'pointer' }}
          >
            + Add line
          </button>
        </div>
      </div>

      {/* Sticky action bar */}
      <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, background: 'var(--forest-dark)', borderTop: '1px solid var(--forest-light)', padding: 12, display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
        <button
          onClick={openPreview}
          style={{ background: 'var(--forest-mid)', color: 'var(--cream)', border: '1px solid var(--forest-light)', borderRadius: 8, padding: '10px 16px', fontSize: 13, cursor: 'pointer' }}
        >
          Preview supplier email
        </button>
        <button
          onClick={sendDraft}
          disabled={sending}
          style={{ background: 'var(--gold)', color: 'var(--forest-dark)', border: 'none', borderRadius: 8, padding: '10px 16px', fontSize: 13, fontWeight: 600, cursor: sending ? 'not-allowed' : 'pointer' }}
        >
          {sending ? 'Sending…' : 'Send draft to my inbox'}
        </button>
        <button
          onClick={createThrivePo}
          disabled={creatingPo}
          style={{ background: 'var(--sage)', color: 'var(--cream)', border: '1px solid var(--forest-light)', borderRadius: 8, padding: '10px 16px', fontSize: 13, cursor: creatingPo ? 'not-allowed' : 'pointer' }}
        >
          {creatingPo ? 'Creating…' : 'Create Thrive PO'}
        </button>
      </div>

      {/* Preview modal */}
      {previewOpen && (
        <div
          onClick={() => setPreviewOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 100 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: 'var(--forest-dark)', border: '1px solid var(--forest-light)', borderRadius: 10, maxWidth: 900, width: '100%', maxHeight: '85vh', overflow: 'auto', padding: 16 }}
          >
            {previewLoading || !preview ? (
              <div style={{ color: 'var(--text-muted)' }}>Composing…</div>
            ) : (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10, gap: 10, flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Subject</div>
                    <div style={{ fontSize: 16, color: 'var(--cream)' }}>{preview.subject}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => copy(preview.subject, 'subject')} style={{ background: 'var(--forest-mid)', color: 'var(--cream)', border: '1px solid var(--forest-light)', borderRadius: 6, padding: '6px 10px', fontSize: 12, cursor: 'pointer' }}>Copy subject</button>
                    <button onClick={() => copy(preview.textBody, 'plain text')} style={{ background: 'var(--forest-mid)', color: 'var(--cream)', border: '1px solid var(--forest-light)', borderRadius: 6, padding: '6px 10px', fontSize: 12, cursor: 'pointer' }}>Copy plain</button>
                    <button onClick={() => copy(preview.htmlBody, 'html')} style={{ background: 'var(--forest-mid)', color: 'var(--cream)', border: '1px solid var(--forest-light)', borderRadius: 6, padding: '6px 10px', fontSize: 12, cursor: 'pointer' }}>Copy html</button>
                  </div>
                </div>
                <div
                  style={{ background: 'var(--cream)', color: '#222', padding: 16, borderRadius: 6 }}
                  dangerouslySetInnerHTML={{ __html: preview.htmlBody }}
                />
              </>
            )}
            <div style={{ marginTop: 12, textAlign: 'right' }}>
              <button onClick={() => setPreviewOpen(false)} style={{ background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--forest-light)', borderRadius: 6, padding: '6px 12px', fontSize: 12, cursor: 'pointer' }}>Close</button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div style={{ position: 'fixed', bottom: 80, left: '50%', transform: 'translateX(-50%)', background: toast.kind === 'success' ? 'var(--sage)' : '#5a1a1a', color: 'var(--cream)', padding: '10px 16px', borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.3)', zIndex: 200, fontSize: 13 }}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
